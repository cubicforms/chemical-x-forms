import { getCurrentInstance, getCurrentScope, onScopeDispose, provide, toRaw, useId } from 'vue'
import { buildFormApi } from '../core/build-form-api'
import { createFormStore, type FormStore } from '../core/create-form-store'
import {
  ANONYMOUS_FORM_KEY_PREFIX,
  DEFAULT_PERSISTENCE_DEBOUNCE_MS,
  PERSISTENCE_KEY_PREFIX,
  RESERVED_KEY_PREFIX,
} from '../core/defaults'
import { __DEV__ } from '../core/dev'
import { captureUserCallSite } from '../core/dev-stack-trace'
import { ReservedFormKeyError } from '../core/errors'
import type { FieldStateView } from '../core/field-state-api'
import { getComputedSchema } from '../core/get-computed-schema'
import { createHistoryModule, type HistoryModule } from '../core/history'
import {
  buildPersistedPayload,
  cleanupOrphanKeys,
  createDebouncedWriter,
  filterErrorsByPaths,
  getStorageAdapter,
  mergeSparseHydration,
  normalizePersistConfig,
  PERSISTENCE_MODULE_KEY,
  pluckPaths,
  readPersistedPayload,
  resolveStorageKeyBase,
  sweepAllOrphansAcrossStandardStores,
  sweepNonConfiguredStandardStoresForOrphans,
  type PersistenceModule,
} from '../core/persistence'
import { canonicalizePath, type Path, type PathKey } from '../core/paths'
import { deleteAtPath, getAtPath, setAtPath, isPlainRecord } from '../core/path-walker'
import { kFormContext, useRegistry } from '../core/registry'
import type {
  AbstractSchema,
  ChemicalXFormsDefaults,
  FormKey,
  PersistConfigOptions,
  UseAbstractFormReturnType,
  UseFormConfiguration,
  ValidationError,
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
 * - Looks up (or creates) the FormStore<F> for the configured key. If the
 *   registry has a pending hydration entry for the key, threads it into
 *   createFormStore so the client side starts from the server's snapshot.
 * - Builds register / getFieldState / validate / handleSubmit from that
 *   FormStore via the Phase 1b factories.
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
  const key = resolveFormKey(configuration.key)

  // Resolve the schema (accepts either an AbstractSchema or a factory).
  // Preserve both generics — dropping `GetValueFormType` here would make
  // `state.schema.getSchemasAtPath(...)` return `AbstractSchema<_, Form>[]`
  // for consumers whose schema intentionally produces a different runtime
  // shape (e.g. zod's `.transform(...)` narrowing).
  const resolvedSchema = getComputedSchema(key, configuration.schema)

  // One FormStore per (app, formKey). Multiple useForm calls with the same
  // key resolve to the same instance — matches the pre-rewrite "shared
  // store" semantic that forms with the same key were intended to share.
  const registry = useRegistry()

  // Merge app-level defaults from the registry over per-form options.
  // Per-form values always win for scalars; `fieldValidation` is
  // shallow-merged at the field level so consumers can set
  // `debounceMs` globally and override `on` per-form. Every downstream
  // read uses `merged` so the merge happens exactly once.
  const merged = mergeWithDefaults(registry.defaults, configuration)

  const existing = registry.forms.get(key) as FormStore<Form, GetValueFormType> | undefined
  if (__DEV__ && existing !== undefined) {
    // Shared-key semantics are a feature when consumers OPT in to them
    // (two `useForm({ key: 'x' })` calls that genuinely want the same
    // store). They're a silent-collision footgun when two unrelated
    // parts of an app happen to agree on a key. Fingerprinting the
    // schema turns collision into a diagnosable warning: if the
    // second call's schema has a different structural fingerprint
    // than the first's, the forms almost certainly shouldn't be
    // sharing. The second call's schema is then silently dropped in
    // favour of the first's — matching what already happens (only
    // the first caller's config wires the FormStore).
    warnOnSchemaFingerprintMismatch(key, existing.schema, resolvedSchema)
  }
  const state: FormStore<Form, GetValueFormType> =
    existing ?? buildFreshState<Form, GetValueFormType>(key, resolvedSchema, merged, registry)

  // Ref-count this consumer. When the component's effect scope tears down,
  // release the count; the registry evicts the FormStore once the last
  // consumer disposes. Guarded on `getCurrentScope()` so callers without an
  // effect-scope context (defensive — setup() always provides one) don't
  // leak a pinned consumer. See registry.trackConsumer for the counter.
  if (getCurrentScope() !== undefined) {
    const releaseConsumer = registry.trackConsumer(key)
    onScopeDispose(releaseConsumer)
  }

  // Wire persistence (opt-in) — only on fresh state creation, skipped
  // on SSR. `existing` means a prior useForm() already mounted and
  // wired persistence; we don't double-subscribe. The handle is cached
  // on `state.modules` so `buildFormApi` can plug `form.persist` /
  // `form.clearPersistedDraft` into the consumer-facing API. The
  // disposer is registered on the FormStore (not on this consumer's
  // scope) so persistence survives any single consumer unmounting — it
  // tears down only when the last consumer releases and the registry
  // evicts the state.
  //
  // The shorthand input (`persist: 'local'`, `persist: customAdapter`)
  // is normalised to the resolved options bag once at this boundary —
  // everything below operates on the resolved shape.
  if (existing === undefined && !registry.isSSR) {
    if (merged.persist !== undefined) {
      const resolvedPersist = normalizePersistConfig(merged.persist)
      const persistenceBase = resolveStorageKeyBase(resolvedPersist, state.formKey)
      // Cross-store orphan cleanup: any standard backend not matching
      // the configured one gets every cx-managed key under the base
      // wiped (legacy pre-fingerprint AND stale fingerprints alike).
      // Ensures stale drafts can't survive in stores the dev migrated
      // AWAY from. Fire-and-forget; backend unavailability is silent.
      void sweepNonConfiguredStandardStoresForOrphans(resolvedPersist.storage, persistenceBase)
      const persistenceModule = wirePersistence(state, resolvedPersist)
      state.modules.set(PERSISTENCE_MODULE_KEY, persistenceModule)
      state.registerCleanup(() => persistenceModule.dispose())
    } else {
      // No `persist:` configured. The form might have HAD persistence
      // in a prior deployment that the dev has since removed. Sweep
      // every cx-managed key under the default base from every
      // standard backend so removing the option actually removes the
      // on-disk artifact across all fingerprints that ever ran.
      void sweepAllOrphansAcrossStandardStores(`${PERSISTENCE_KEY_PREFIX}${state.formKey}`)
    }
  }

  // Wire history (opt-in). Fresh-state-only — the module subscribes
  // to FormStore events, so subscribing twice would double-push
  // snapshots. Cache the module on the FormStore so subsequent
  // `useForm` / `useFormContext` calls for the same key retrieve the
  // SAME instance, keeping `canUndo` / `canRedo` / `historySize` /
  // `undo` / `redo` consistent across mount order.
  if (existing === undefined && merged.history !== undefined) {
    const historyModule = createHistoryModule(state, merged.history)
    state.modules.set(HISTORY_MODULE_KEY, historyModule)
    state.registerCleanup(() => historyModule.dispose())
  }

  // Provide the FormStore to descendants via `kFormContext` so
  // `useFormContext()` can resolve it without prop-threading.
  //
  // ONLY anonymous `useForm()` calls fill the ambient slot. Keyed forms
  // are explicitly addressable via `useFormContext<F>(key)` and don't
  // pollute the ambient context — keeping the two resolution modes
  // semantically distinct. A descendant of a keyed-only parent that
  // calls `useFormContext<F>()` (no key) gets the "no ambient form"
  // throw, which is the right error: the form has a name; address it.
  //
  // Ambient mode is still "last-provide wins" among siblings: if two
  // anonymous `useForm()` calls run in the same component, the second
  // overwrites the first and descendants only see the second. We record
  // the per-instance history of ANONYMOUS provides here (silently) so
  // that a descendant's `useFormContext<F>()` call can walk up, detect
  // the collision, and warn lazily. Recording is skipped on SSR so the
  // client-side warn fires once, not once-per-render-pass.
  if (configuration.key === undefined) {
    recordAmbientProvide(registry.isSSR)
    provide(kFormContext, state as FormStore<GenericForm>)
  }

  const apiOptions: Parameters<typeof buildFormApi<Form, GetValueFormType>>[1] = {}
  if (merged.onInvalidSubmit !== undefined) {
    apiOptions.onInvalidSubmit = merged.onInvalidSubmit
  }
  const history = state.modules.get(HISTORY_MODULE_KEY) as HistoryModule | undefined
  if (history !== undefined) {
    apiOptions.history = history
  }
  return buildFormApi<Form, GetValueFormType>(state, apiOptions)
}

/**
 * Merge app-level defaults from the registry over a per-form
 * configuration. Per-form values always win for scalars; the
 * `fieldValidation` field is shallow-merged so defaults like
 * `{ debounceMs: 100 }` carry through even when the per-form call
 * passes `{ on: 'blur' }`. See `ChemicalXFormsDefaults` for the full
 * merge contract.
 */
function mergeWithDefaults<
  Form extends GenericForm,
  GetValueFormType extends GenericForm,
  Schema extends AbstractSchema<Form, GetValueFormType>,
  Defaults extends DeepPartial<Form>,
>(
  defaults: ChemicalXFormsDefaults,
  configuration: UseFormConfiguration<Form, GetValueFormType, Schema, Defaults>
): UseFormConfiguration<Form, GetValueFormType, Schema, Defaults> {
  // exactOptionalPropertyTypes rejects explicit `undefined` on optional
  // properties (different from omitting), so conditionally spread each
  // resolved value rather than assigning undefined into the field.
  const validationMode = configuration.validationMode ?? defaults.validationMode
  const onInvalidSubmit = configuration.onInvalidSubmit ?? defaults.onInvalidSubmit
  const history = configuration.history ?? defaults.history
  const fieldValidation =
    configuration.fieldValidation === undefined && defaults.fieldValidation === undefined
      ? undefined
      : { ...defaults.fieldValidation, ...configuration.fieldValidation }
  return {
    ...configuration,
    ...(validationMode === undefined ? {} : { validationMode }),
    ...(onInvalidSubmit === undefined ? {} : { onInvalidSubmit }),
    ...(history === undefined ? {} : { history }),
    ...(fieldValidation === undefined ? {} : { fieldValidation }),
  }
}

/**
 * Shared key for the per-state history module cache. Exported would be
 * over-sharing — the only callers are this file and `useFormContext`.
 */
const HISTORY_MODULE_KEY = 'history'

function buildFreshState<F extends GenericForm, G extends GenericForm = F>(
  key: FormKey,
  schema: AbstractSchema<F, G>,
  configuration: UseFormConfiguration<F, G, AbstractSchema<F, G>, DeepPartial<F>>,
  registry: ReturnType<typeof useRegistry>
): FormStore<F, G> {
  const pending = registry.pendingHydration.get(key)
  if (pending !== undefined) registry.pendingHydration.delete(key)
  const state = createFormStore<F, G>({
    formKey: key,
    schema,
    defaultValues: configuration.defaultValues,
    validationMode: configuration.validationMode,
    hydration: pending,
    fieldValidation: configuration.fieldValidation,
    isSSR: registry.isSSR,
  })
  // Storage type is FormStore<GenericForm>; the lookup above narrows
  // back to the caller's (F, G) via the `existing as FormStore<Form,
  // GetValueFormType>` cast. The registry Map is intentionally
  // generic-erased — the alternative (parameterising the Map) would
  // force every internal caller to carry both generics.
  ;(registry.forms as Map<FormKey, FormStore<GenericForm>>).set(
    key,
    state as unknown as FormStore<GenericForm>
  )
  return state
}

/**
 * Module-local counter for the "no Vue instance in scope" fallback
 * (tests, raw composable calls outside setup). Collisions with
 * user-supplied keys are avoided by the reserved `__cx:anon:` prefix
 * (consumer keys starting with `__cx:` are rejected at construction).
 * Inside
 * setup — the common path — `useId()` produces a tree-position-stable
 * id that matches across SSR hydration, so two mounts of the same
 * component tree resolve to the same anonymous key and hydration
 * works without user bookkeeping.
 */
let anonCounter = 0

/**
 * One entry per ANONYMOUS `useForm()` call that landed in a
 * component's ambient provide slot. Keyed forms aren't recorded —
 * they don't fill the ambient slot in the first place. `source` is
 * the best-effort user call site (first non-cx frame off
 * `new Error().stack`) — printed in the collision warning so the
 * author can navigate to each offending call site.
 */
export type AmbientProvideEntry = {
  readonly source: string | undefined
}

/**
 * Tracks which Vue component instances have already run
 * `provide(kFormContext, ...)` via `useAbstractForm`. Dev-only —
 * `null` in production so the WeakMap allocation tree-shakes out.
 * A `WeakMap` keyed by the instance object lets Vue GC each
 * component's entry when it unmounts without us tracking
 * lifecycle.
 *
 * Exported so `useFormContext<F>()` (no key) can walk the parent
 * chain and emit a collision warning only when a descendant
 * actually consumes the ambient slot — eager warning in
 * `useForm()` misfired on components that call useForm multiple
 * times intentionally but have no keyless consumer.
 */
export const ambientProvideHistory: WeakMap<object, AmbientProvideEntry[]> | null = __DEV__
  ? new WeakMap<object, AmbientProvideEntry[]>()
  : null

function recordAmbientProvide(isSSR: boolean): void {
  if (!__DEV__ || isSSR || ambientProvideHistory === null) return
  const instance = getCurrentInstance()
  if (instance === null) return
  const instanceKey = instance as unknown as object
  // Caller already gated on `configuration.key === undefined`, so every
  // recorded entry corresponds to an anonymous useForm() call. No need
  // to carry a key — synthetic `__cx:anon:<id>` keys aren't addressable
  // by the author and would only add noise to the warning.
  const entry: AmbientProvideEntry = {
    source: captureUserCallSite(),
  }
  const existing = ambientProvideHistory.get(instanceKey)
  if (existing === undefined) {
    ambientProvideHistory.set(instanceKey, [entry])
    return
  }
  existing.push(entry)
}

/**
 * Normalise `configuration.key` into a concrete FormKey. Explicit keys
 * pass through after a reserved-namespace check (anything starting
 * with `__cx:` is rejected with `ReservedFormKeyError`); empty /
 * nullish keys are treated as anonymous and allocated a unique id
 * under the `__cx:anon:` prefix. The reserved-prefix reject + the
 * synthetic-prefix reservation together guarantee zero collision
 * between consumer-chosen keys and library-allocated synthetic ones.
 *
 * Anonymous semantics: each `useForm({ schema })` call without a key
 * resolves to a distinct FormStore. Descendant components reach it via
 * ambient `useFormContext<F>()`; cross-component lookup by key is not
 * possible (and not meaningful — the key is synthetic). Callers that
 * need shared state, distant lookup, persistence defaults, or a
 * recognisable DevTools label should pass an explicit `key`.
 */
function resolveFormKey(key: FormKey | undefined): FormKey {
  if (key !== undefined && key !== null && key !== '') {
    // Reject any consumer-supplied key in the reserved `__cx:`
    // namespace. Without this, a consumer key like `__cx:anon:0`
    // could silently collide with the synthetic anonymous-key
    // allocation below — both would land on the same FormStore in
    // the registry, and the dev-mode schema-fingerprint warning
    // only catches collisions when schemas differ. Throwing here
    // makes the collision impossible by construction.
    if (key.startsWith(RESERVED_KEY_PREFIX)) {
      throw new ReservedFormKeyError(key)
    }
    return key
  }
  // In setup context, `useId()` threads through Vue's SSR id-allocator
  // so server-rendered and client-hydrated trees agree on the same
  // synthetic key.
  if (getCurrentInstance() !== null) {
    return `${ANONYMOUS_FORM_KEY_PREFIX}${useId()}`
  }
  // Outside setup (tests, ad-hoc composable use) there's no Vue
  // instance to draw from; fall back to a module-local counter.
  return `${ANONYMOUS_FORM_KEY_PREFIX}${anonCounter++}`
}

/**
 * Dev-only: warn when a second `useForm` lands on the same key with
 * a structurally-different schema. Two schemas compute their own
 * fingerprints; we compare the strings and flag mismatches. An
 * adapter-thrown `fingerprint()` is caught (never crashes the form)
 * and surfaced as a `console.error` in dev — the mismatch check is
 * skipped, matching the "allow the inconsistency" failure mode. See
 * `AbstractSchema.fingerprint()` in types-api.ts for the contract.
 */
function warnOnSchemaFingerprintMismatch(
  key: FormKey,
  existing: AbstractSchema<GenericForm, GenericForm>,
  incoming: AbstractSchema<GenericForm, GenericForm>
): void {
  let existingFp: string
  let incomingFp: string
  try {
    existingFp = existing.fingerprint()
    incomingFp = incoming.fingerprint()
  } catch (error) {
    console.error(
      `[@chemical-x/forms] fingerprint() threw for key "${key}"; skipping mismatch check.`,
      error
    )
    return
  }
  if (existingFp === incomingFp) return
  console.warn(
    `[@chemical-x/forms] useForm() calls with key "${key}" use different schemas; first wins, second is ignored. Use identical schemas or unique keys.\n  existing: ${existingFp}\n  incoming: ${incomingFp}`
  )
}

/**
 * Wire persistence to a fresh FormStore:
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
  state: FormStore<F>,
  config: PersistConfigOptions
): PersistenceModule {
  // Fingerprint the schema once and bake it into the storage key. Any
  // structural schema change (added/removed/renamed field, type swap)
  // produces a different fingerprint, so the new mount looks up a fresh
  // key — the old draft becomes an orphan, cleaned up in the same mount
  // by `cleanupOrphanKeys` below. Replaces the manual `version: number`
  // protocol that was previously the consumer's responsibility.
  const fingerprint = state.schema.fingerprint()
  const base = resolveStorageKeyBase(config, state.formKey)
  const key = `${base}:${fingerprint}`
  const debounceMs = config.debounceMs ?? DEFAULT_PERSISTENCE_DEBOUNCE_MS
  const include = config.include ?? 'form'
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
    // Sparse-payload reshape: the persisted form contains only paths
    // that were opted in via `register('foo', { persist: true })`. If
    // every opt-in has been torn down, wipe the entry rather than
    // write a hollow envelope (matches the per-element security model
    // — no opt-ins → nothing to persist).
    const optedInPaths = new Set<PathKey>(state.persistOptIns.optedInPaths())
    if (optedInPaths.size === 0) {
      await adapter.removeItem(key)
      return
    }
    // Unwrap the reactive form to a plain object before handing it to
    // the adapter — IDB's `structuredClone` can't serialise Vue
    // proxies (DATA_CLONE_ERR), and local/session stringify the
    // proxy's own-enumerable keys anyway.
    const rawForm = toRaw(state.form.value)
    const filteredForm = pluckPaths(rawForm, optedInPaths) as F
    // Build the envelope with the cx-internal envelope version baked
    // in by `buildPersistedPayload`. Consumers no longer manage `v` —
    // schema-content invalidation lives at the storage-key level via
    // the fingerprint suffix.
    const filteredSchemaErrors = filterErrorsByPaths(state.schemaErrors, optedInPaths)
    const filteredUserErrors = filterErrorsByPaths(state.userErrors, optedInPaths)
    const payload = buildPersistedPayload<F>(
      filteredForm,
      include,
      filteredSchemaErrors,
      filteredUserErrors
    )
    await adapter.setItem(key, payload)
  }, debounceMs)

  const unsubscribeChange = state.onFormChange((_next, meta) => {
    if (disposed) return
    // Per-element opt-in: only writes whose source declared `persist: true`
    // reach the storage adapter. Programmatic `form.setValue`, history
    // undo without opt-ins, devtools edits to non-opted paths, and
    // `reset()` all bypass this gate by passing no meta (or `persist:
    // false`).
    if (meta?.persist !== true) return
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
    // Orphan cleanup: delete any cx-managed key under the same base
    // whose fingerprint suffix doesn't match the current schema. Runs
    // once per mount, fire-and-forget. Bounded cost: typically 0-1
    // orphans per form.
    void cleanupOrphanKeys(adapter, base, key)
    try {
      const raw = await adapter.getItem(key)
      const payload = readPersistedPayload<F>(raw)
      if (payload === null) {
        // Truly-absent entries are a no-op. A non-null raw that didn't
        // parse is a stale payload — wrong cx envelope version, or
        // malformed shape — wipe so the next mount reads cleanly.
        if (raw !== null && raw !== undefined) {
          await adapter.removeItem(key)
        }
        return
      }
      if (disposed) return
      // Sparse-aware replacement: the persisted form may contain only
      // a subset of paths (the ones opted into persistence on the
      // previous mount). Merge over the current form (which carries
      // schema defaults at this point — wirePersistence runs before
      // any user mutation could have happened) so non-persisted paths
      // keep their schema defaults.
      const merged = mergeSparseHydration(toRaw(state.form.value) as F, payload.data.form)
      state.applyFormReplacement(merged)
      if (include === 'form+errors') {
        // Each store rebuilds independently from its persisted entries.
        // Consumers who bumped `version` already had their payload
        // rejected above.
        if (payload.data.schemaErrors !== undefined) {
          const flat = payload.data.schemaErrors.flatMap(([, errs]) => errs)
          state.setAllSchemaErrors(flat)
        }
        if (payload.data.userErrors !== undefined) {
          const flat = payload.data.userErrors.flatMap(([, errs]) => errs)
          state.setAllUserErrors(flat)
        }
      }
    } catch {
      // Adapter IO errors shouldn't surface; storage adapters are
      // "best-effort" and already log their own warnings.
    }
  })()

  // Dev-mode warning: persistence is configured but no field opted in.
  // Common confusion mode — `persist: { storage: 'local' }` is set on
  // the form but every `register()` call omits `{ persist: true }`, so
  // drafts mysteriously never save. Wait one microtask AFTER the
  // initial mount task settles so the directive's `created` hooks have
  // had a chance to populate opt-ins; then check once. One-shot —
  // re-mounts within the same FormStore lifetime don't re-warn.
  if (__DEV__) {
    void Promise.resolve().then(() => {
      if (disposed) return
      // Two microtask hops: the first lets the current setup() return
      // and Vue mount the directive subtree; the second runs after
      // Vue's own queued effects so any `register({ persist: true })`
      // has landed in the registry.
      void Promise.resolve().then(() => {
        if (disposed) return
        if (state.persistOptIns.isEmpty()) {
          console.warn(
            `[@chemical-x/forms] Persistence is configured for form ` +
              `"${state.formKey}" but no fields opted in. Each persisted ` +
              `field needs \`register('foo', { persist: true })\`, or call ` +
              `\`form.persist('foo')\` for an explicit checkpoint. ` +
              `See ./docs/recipes/persistence.md.`
          )
        }
      })
    })
  }

  /**
   * Imperative one-shot write. Read-merge-write strategy: flush any
   * pending debounced write first (so it can't overwrite our update),
   * read the existing payload, set the path's current value, optionally
   * merge in this path's errors, and write back. Preserves untouched
   * paths in storage.
   */
  async function writePathImmediately(path: Path): Promise<void> {
    if (disposed) return
    await writer.flush()
    if (disposed) return
    const adapter = await adapterPromise
    if (disposed) return
    const raw = await adapter.getItem(key)
    const existing = readPersistedPayload<F>(raw)
    const baseForm = existing?.data.form ?? ({} as F)
    const value = getAtPath(toRaw(state.form.value), path)
    const nextForm = setAtPath(baseForm, path, value) as F
    if (include === 'form') {
      await adapter.setItem(key, buildPersistedPayload<F>(nextForm, 'form', new Map(), new Map()))
      return
    }
    // include === 'form+errors': preserve the rest of the persisted
    // error map and refresh the entry for this path's canonical key.
    const { key: pathKey } = canonicalizePath(path)
    const schemaMap = new Map<string, ValidationError[]>(existing?.data.schemaErrors ?? [])
    const userMap = new Map<string, ValidationError[]>(existing?.data.userErrors ?? [])
    const currentSchema = state.schemaErrors.get(pathKey)
    const currentUser = state.userErrors.get(pathKey)
    if (currentSchema !== undefined && currentSchema.length > 0) {
      schemaMap.set(pathKey, [...currentSchema])
    } else {
      schemaMap.delete(pathKey)
    }
    if (currentUser !== undefined && currentUser.length > 0) {
      userMap.set(pathKey, [...currentUser])
    } else {
      userMap.delete(pathKey)
    }
    await adapter.setItem(
      key,
      buildPersistedPayload<F>(nextForm, 'form+errors', schemaMap, userMap)
    )
  }

  /**
   * Wipe the persisted entry. Without `path`, removes the whole key.
   * With `path`, deletes only that subpath (and any matching error
   * entries) and writes back; the entry is removed entirely if the
   * resulting form value is empty.
   */
  async function clearPersistedDraft(path?: Path): Promise<void> {
    if (disposed) return
    await writer.flush()
    if (disposed) return
    const adapter = await adapterPromise
    if (disposed) return
    if (path === undefined) {
      await adapter.removeItem(key)
      return
    }
    const raw = await adapter.getItem(key)
    const existing = readPersistedPayload<F>(raw)
    if (existing === null) return
    const nextForm = deleteAtPath(existing.data.form, path) as F
    if (isEmptyContainer(nextForm)) {
      await adapter.removeItem(key)
      return
    }
    if (include === 'form') {
      await adapter.setItem(key, buildPersistedPayload<F>(nextForm, 'form', new Map(), new Map()))
      return
    }
    const { key: pathKey } = canonicalizePath(path)
    const schemaErrors = (existing.data.schemaErrors ?? []).filter(([k]) => k !== pathKey)
    const userErrors = (existing.data.userErrors ?? []).filter(([k]) => k !== pathKey)
    const schemaMap = new Map<string, ValidationError[]>(schemaErrors.map(([k, v]) => [k, [...v]]))
    const userMap = new Map<string, ValidationError[]>(userErrors.map(([k, v]) => [k, [...v]]))
    await adapter.setItem(
      key,
      buildPersistedPayload<F>(nextForm, 'form+errors', schemaMap, userMap)
    )
  }

  function dispose(): void {
    disposed = true
    unsubscribeChange()
    unsubscribeSuccess()
    // Flush pending write so the last-typed state makes it to disk
    // before unmount. Caller shouldn't await here, but the flush
    // works as a fire-and-forget.
    void writer.flush().catch(() => undefined)
  }

  return {
    writePathImmediately,
    clearPersistedDraft,
    dispose,
  }
}

/**
 * Treat `null`, `undefined`, `[]`, and `{}` as "nothing left to keep."
 * Used by `clearPersistedDraft(path)` to decide whether to wipe the
 * entire entry instead of writing a hollow envelope back.
 */
function isEmptyContainer(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (Array.isArray(value)) return value.length === 0
  if (isPlainRecord(value)) return Object.keys(value).length === 0
  return false
}

export type { FieldStateView }
