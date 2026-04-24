import { getCurrentScope, onScopeDispose, provide, toRaw } from 'vue'
import { buildFormApi } from '../core/build-form-api'
import { createFormState, type FormState } from '../core/create-form-state'
import type { FieldStateView } from '../core/field-state-api'
import { getComputedSchema } from '../core/get-computed-schema'
import { createHistoryModule, type HistoryModule } from '../core/history'
import {
  buildPersistedPayload,
  createDebouncedWriter,
  getStorageAdapter,
  readPersistedPayload,
  resolveStorageKey,
} from '../core/persistence'
import { kFormContext, useRegistry } from '../core/registry'
import type {
  AbstractSchema,
  FormKey,
  PersistConfig,
  UseAbstractFormReturnType,
  UseFormConfiguration,
} from '../types/types-api'
import type { DeepPartial, GenericForm } from '../types/types-core'

/**
 * useForm's abstract entry point. The Zod-typed `useForm` sitting at
 * ../composables/use-form.ts delegates here after wrapping its Zod schema
 * with `zodAdapter` — the result is an `AbstractSchema<Form, GetValueFormType>`
 * instance indistinguishable from a hand-rolled adapter.
 *
 * Wiring:
 * - Fetches the current Vue app's ChemicalXRegistry via useRegistry().
 * - Looks up (or creates) the FormState<F> for the configured key. If the
 *   registry has a pending hydration entry for the key, threads it into
 *   createFormState so the client side starts from the server's snapshot.
 * - Builds register / getFieldState / validate / handleSubmit /
 *   setFieldErrorsFromApi from that FormState via the Phase 1b factories.
 *
 * The old pre-rewrite implementation stitched together five separate Nuxt
 * useState composables and a cache in register.ts. This file collapses all
 * of that into one registry-backed closure.
 */

export function useAbstractForm<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<Form>
  >
): UseAbstractFormReturnType<Form, GetValueFormType> {
  const key = requireFormKey(configuration.key)

  // Resolve the schema (accepts either an AbstractSchema or a factory).
  const resolvedSchema = getComputedSchema(key, configuration.schema) as unknown as AbstractSchema<
    Form,
    Form
  >

  // One FormState per (app, formKey). Multiple useForm calls with the same
  // key resolve to the same instance — matches the pre-rewrite "shared
  // store" semantic that forms with the same key were intended to share.
  const registry = useRegistry()
  const existing = registry.forms.get(key) as FormState<Form> | undefined
  const state: FormState<Form> =
    existing ?? buildFreshState<Form>(key, resolvedSchema, configuration, registry)

  // Ref-count this consumer. When the component's effect scope tears down,
  // release the count; the registry evicts the FormState once the last
  // consumer disposes. Guarded on `getCurrentScope()` so callers without an
  // effect-scope context (defensive — setup() always provides one) don't
  // leak a pinned consumer. See registry.trackConsumer for the counter.
  if (getCurrentScope() !== undefined) {
    const releaseConsumer = registry.trackConsumer(key)
    onScopeDispose(releaseConsumer)
  }

  // Wire persistence (opt-in) — only on fresh state creation, skipped
  // on SSR. `existing` means a prior useForm() already mounted and
  // wired persistence; we don't double-subscribe. The disposer is
  // registered on the FormState (not on this consumer's scope) so
  // persistence survives any single consumer unmounting — it tears
  // down only when the last consumer releases and the registry evicts
  // the state.
  if (existing === undefined && configuration.persist !== undefined && !registry.isSSR) {
    const disposePersist = wirePersistence(state as FormState<Form>, configuration.persist)
    state.registerCleanup(disposePersist)
  }

  // Wire history (opt-in). Fresh-state-only — the module subscribes
  // to FormState events, so subscribing twice would double-push
  // snapshots. Cache the module on the FormState so subsequent
  // `useForm` / `useFormContext` calls for the same key retrieve the
  // SAME instance, keeping `canUndo` / `canRedo` / `historySize` /
  // `undo` / `redo` consistent across mount order.
  if (existing === undefined && configuration.history !== undefined) {
    const historyModule = createHistoryModule(state as FormState<Form>, configuration.history)
    state.modules.set(HISTORY_MODULE_KEY, historyModule)
    state.registerCleanup(() => historyModule.dispose())
  }

  // Provide the FormState to descendants via `kFormContext` so
  // `useFormContext()` can resolve it without prop-threading. The key is
  // the already-canonicalised formKey; looking up a specific form by key
  // is possible via `useFormContext(key)` even without the ambient provide.
  provide(kFormContext, state as FormState<GenericForm>)

  const apiOptions: Parameters<typeof buildFormApi<Form, GetValueFormType>>[1] = {}
  if (configuration.onInvalidSubmit !== undefined) {
    apiOptions.onInvalidSubmit = configuration.onInvalidSubmit
  }
  const history = state.modules.get(HISTORY_MODULE_KEY) as HistoryModule | undefined
  if (history !== undefined) {
    apiOptions.history = history
  }
  return buildFormApi<Form, GetValueFormType>(state, apiOptions)
}

/**
 * Shared key for the per-state history module cache. Exported would be
 * over-sharing — the only callers are this file and `useFormContext`.
 */
const HISTORY_MODULE_KEY = 'history'

function buildFreshState<F extends GenericForm>(
  key: FormKey,
  schema: AbstractSchema<F, F>,
  configuration: UseFormConfiguration<F, F, AbstractSchema<F, F>, DeepPartial<F>>,
  registry: ReturnType<typeof useRegistry>
): FormState<F> {
  const pending = registry.pendingHydration.get(key)
  if (pending !== undefined) registry.pendingHydration.delete(key)
  const state = createFormState<F>({
    formKey: key,
    schema,
    initialState: configuration.initialState,
    validationMode: configuration.validationMode,
    hydration: pending,
    fieldValidation: configuration.fieldValidation,
  })
  // Storage type is FormState<GenericForm>; the lookup above narrows back to F
  // via the `existing as FormState<Form>` cast.
  ;(registry.forms as Map<FormKey, FormState<GenericForm>>).set(
    key,
    state as unknown as FormState<GenericForm>
  )
  return state
}

function requireFormKey(key: FormKey | undefined): FormKey {
  if (key === undefined || key === null || key === '') {
    throw new Error(
      '[@chemical-x/forms] useForm requires an explicit `key` option. ' +
        'Anonymous forms share state across unrelated components; pass a unique string per form.'
    )
  }
  return key
}

/**
 * Wire persistence to a fresh FormState:
 *
 *   1. Resolve the storage adapter (dynamic-imported — `'local'` never
 *      pulls IDB code; tree-shakes cleanly).
 *   2. Async-read any persisted payload and apply it via
 *      `applyFormReplacement`. First render shows schema defaults
 *      (the "flash of default state" — documented tradeoff for
 *      async backends).
 *   3. Subscribe a debounced writer to `onFormChange`; every mutation
 *      schedules a write.
 *   4. Subscribe a `removeItem` on submit-success (when
 *      `clearOnSubmitSuccess` is not explicitly false).
 *   5. Return a disposer that flushes any pending write, cancels
 *      the debounce, and removes subscribers. Called on consumer
 *      teardown.
 */
function wirePersistence<F extends GenericForm>(
  state: FormState<F>,
  config: PersistConfig
): () => void {
  const key = resolveStorageKey(config, state.formKey)
  const debounceMs = config.debounceMs ?? 300
  const include = config.include ?? 'form'
  const version = config.version ?? 1
  const clearOnSubmitSuccess = config.clearOnSubmitSuccess ?? true

  // Single shared adapter promise — both the hydration path and the
  // write/clear paths await it. Avoids a race where an early write
  // (fast debounceMs) would see `adapter === null` and skip silently
  // because the dynamic-import hadn't resolved yet.
  const adapterPromise = getStorageAdapter(config.storage)
  let disposed = false

  const writer = createDebouncedWriter(async () => {
    if (disposed) return
    const adapter = await adapterPromise
    if (disposed) return
    // Unwrap the reactive form to a plain object before handing it to
    // the adapter — IDB's `structuredClone` can't serialise Vue
    // proxies (DATA_CLONE_ERR), and local/session stringify the
    // proxy's own-enumerable keys anyway.
    const rawForm = toRaw(state.form.value)
    const payload = buildPersistedPayload(rawForm, include, state.errors, version)
    await adapter.setItem(key, payload)
  }, debounceMs)

  const unsubscribeChange = state.onFormChange(() => {
    if (disposed) return
    writer.schedule()
  })

  const unsubscribeSuccess = clearOnSubmitSuccess
    ? state.onSubmitSuccess(() => {
        if (disposed) return
        // Flush any pending/in-flight write BEFORE removing — otherwise
        // a timer that fires between submit and removeItem re-persists
        // the now-stale state. `flush()` awaits the in-flight promise
        // if one exists; if there's only a timer, it fires it
        // immediately and awaits. After that, removeItem wins.
        void (async () => {
          await writer.flush()
          if (disposed) return
          const adapter = await adapterPromise
          if (disposed) return
          await adapter.removeItem(key)
        })()
      })
    : () => undefined

  // Async setup: resolve the adapter, then read back the persisted
  // payload. If the caller unmounts before this finishes, `disposed`
  // is true — the restore is skipped.
  void (async () => {
    const adapter = await adapterPromise
    if (disposed) return
    try {
      const raw = await adapter.getItem(key)
      const payload = readPersistedPayload<F>(raw, version)
      if (payload === null) return
      if (disposed) return
      state.applyFormReplacement(payload.data.form)
      if (payload.data.errors !== undefined && include === 'form+errors') {
        // Flatten to a ValidationError[] so setAllErrors rebuilds the
        // Map by path. Consumers who bumped `version` already had
        // their payload rejected above.
        const flat = payload.data.errors.flatMap(([, errs]) => errs)
        state.setAllErrors(flat)
      }
    } catch {
      // Adapter IO errors shouldn't surface; storage adapters are
      // "best-effort" and already log their own warnings.
    }
  })()

  return () => {
    disposed = true
    unsubscribeChange()
    unsubscribeSuccess()
    // Flush pending write so the last-typed state makes it to disk
    // before unmount. Caller shouldn't await here, but the flush
    // works as a fire-and-forget.
    void writer.flush().catch(() => undefined)
  }
}

export type { FieldStateView }
