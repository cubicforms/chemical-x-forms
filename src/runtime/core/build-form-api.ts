import { computed, reactive, readonly, type Ref } from 'vue'
import type {
  FormErrorsSurface,
  FormMeta,
  OnInvalidSubmitPolicy,
  ReactiveValidationStatus,
  RegisterValue,
  UseFormReturnType,
  ValidationError,
  ValidationResponseWithoutValue,
} from '../types/types-api'
import type { DeepPartial, DefaultValuesShape, GenericForm } from '../types/types-core'
import { __DEV__ } from './dev'
import type { FormStore } from './create-form-store'
import { buildErrorsProxy } from './errors-proxy'
import { buildFieldArrayApi } from './field-arrays'
import { buildFieldStateProxy } from './field-state-proxy'
import type { HistoryModule } from './history'
import { getAtPath } from './path-walker'
import { canonicalizePath, type Path, type PathKey } from './paths'
import { PERSISTENCE_MODULE_KEY, type PersistenceModule } from './persistence'
import { enforceSensitiveCheck } from './persistence/sensitive-names'
import { buildProcessForm } from './process-form'
import { buildRegister } from './register-api'
import { isUnset } from './unset'
import { walkUnsetSentinels } from './unset-walker'
import { buildValuesProxy } from './values-proxy'

export type BuildFormApiOptions = {
  /** Forwarded to buildProcessForm. See `UseFormConfiguration.onInvalidSubmit`. */
  onInvalidSubmit?: OnInvalidSubmitPolicy
  /**
   * Pre-wired history module for undo/redo. When omitted, the public
   * `undo` / `redo` / `canUndo` / `canRedo` / `historySize` fields
   * are inert no-op stubs — consumers get a consistent API shape
   * without opting into the feature.
   */
  history?: HistoryModule
}

/**
 * Wrap a Set in a read-only facade. `Object.freeze(new Set(...))` does
 * NOT prevent `add` / `delete` / `clear` mutations on the underlying
 * Set — those methods bypass the frozen state. The Proxy traps the
 * mutating methods and rebinds method/getter access to the underlying
 * Set so internal-slot accesses (e.g. `size`, `has`) keep working.
 */
function readonlySetSnapshot<T>(source: Iterable<T>): ReadonlySet<T> {
  const snapshot = new Set(source)
  return new Proxy(snapshot, {
    get(target, prop) {
      if (prop === 'add' || prop === 'delete' || prop === 'clear') {
        return () => {
          throw new TypeError(`Cannot mutate readonly Set: '${String(prop)}' is not allowed.`)
        }
      }
      // Bind the result to `target` so Set's internal-slot accessors
      // (`size`, `has`, `forEach`, the iterator protocol) receive the
      // underlying Set as `this` instead of the Proxy.
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as ReadonlySet<T>
}

/**
 * Build the public form API from a FormStore. Extracted from
 * `useAbstractForm` so that both the top-level form entry (which creates
 * a fresh state) and `injectForm` (which resolves state from an
 * ambient provide/inject) produce identical API shapes without
 * duplicating the wiring.
 *
 * `buildFormApi` does not interact with the registry, consumer ref-counts,
 * or the current Vue instance — those concerns belong to the caller. This
 * function is pure over (FormStore, options) → api.
 */
export function buildFormApi<Form extends GenericForm, GetValueFormType extends GenericForm = Form>(
  state: FormStore<Form>,
  formInstanceId: string,
  options: BuildFormApiOptions = {}
): UseFormReturnType<Form, GetValueFormType> {
  const register = buildRegister(state, formInstanceId) as (
    path: string | Path
  ) => RegisterValue<unknown>
  // Don't set `onInvalidSubmit: undefined` — exactOptionalPropertyTypes
  // treats an explicit-undefined value differently from an omitted
  // property. Only pass the key when the consumer opted in.
  const processOptions =
    options.onInvalidSubmit !== undefined ? { onInvalidSubmit: options.onInvalidSubmit } : {}
  const {
    validate: validateBuilt,
    validateAsync: validateAsyncBuilt,
    handleSubmit,
  } = buildProcessForm(state, formInstanceId, processOptions)

  const validate = (pathInput?: string) =>
    validateBuilt(pathInput) as Ref<ReactiveValidationStatus<Form>>

  const validateAsync = (pathInput?: string) =>
    validateAsyncBuilt(pathInput) as Promise<ValidationResponseWithoutValue<Form>>

  // --- toRef escape hatch — Readonly<Ref<...>> for the rare case
  // a consumer needs ref-shaped interop (external composables that
  // expect a Vue ref, watchers reading a single path). Writes still
  // funnel through `setValue`, never via the ref.
  function pathToRef(pathInput: string): Readonly<Ref<unknown>> {
    const segments = canonicalizePath(pathInput).segments
    return computed(() => getAtPath(state.form.value, segments)) as Readonly<Ref<unknown>>
  }

  function setValueImpl(pathOrValue: unknown, maybeValue?: unknown): boolean {
    if (arguments.length === 1) {
      // Whole-form: prev is the live form (already structurally
      // complete under the runtime invariant). The consumer's RETURN
      // value passes through mergeStructural so any gaps the consumer
      // introduced (partial replacement) are filled from defaults.
      const next =
        typeof pathOrValue === 'function'
          ? (pathOrValue as (prev: unknown) => unknown)(state.form.value)
          : pathOrValue
      // Whole-form `unset` sentinels (consumer wrote `setValue(unset)`
      // or returned `unset` for some leaf in a function form) flow
      // through the walker — every leaf gets translated, the cleaned
      // value lands in storage, and the discovered paths are added to
      // `blankPaths` via direct setValueAtPath calls (the
      // gate hook handles the bookkeeping).
      const walked = walkUnsetSentinels(
        next,
        state.schema as unknown as Parameters<typeof walkUnsetSentinels>[1]
      )
      const ok = state.setValueAtPath([], walked.cleanedValues)
      if (!ok) return false
      // Mark each blank path. `setValueAtPath` was just called
      // with cleaned values, so the gate hook's implicit-unmark would
      // have removed any prior blank entries for the paths
      // we just touched — re-add them now.
      for (const pathKey of walked.paths) {
        const segments = JSON.parse(pathKey) as Path
        state.setValueAtPath(segments, state.schema.getDefaultAtPath(segments), {
          blank: true,
        })
      }
      return true
    }
    const segments = canonicalizePath(pathOrValue as string | Path).segments
    // `unset` at a specific path: resolve the slim default and route
    // through `setValueAtPath` with `blank: true`. Storage
    // gets the well-typed default; the path is marked for the
    // displayValue / required-empty machinery.
    if (isUnset(maybeValue)) {
      return state.setValueAtPath(segments, state.schema.getDefaultAtPath(segments), {
        blank: true,
      })
    }
    // Path-form callback: when the slot at `segments` is unpopulated,
    // hand the consumer the schema's default at that path instead of
    // `undefined` so `(prev) => prev.first.toUpperCase()` is safe.
    // For populated slots, prev is the live value (consumer's intent
    // is to update existing data, not reset to defaults).
    let resolvedValue: unknown
    if (typeof maybeValue === 'function') {
      const current = state.getValueAtPath(segments)
      const prev = current === undefined ? state.schema.getDefaultAtPath(segments) : current
      resolvedValue = (maybeValue as (prev: unknown) => unknown)(prev)
      // Callback returned `unset` — translate the same way as the
      // direct case above.
      if (isUnset(resolvedValue)) {
        return state.setValueAtPath(segments, state.schema.getDefaultAtPath(segments), {
          blank: true,
        })
      }
    } else {
      resolvedValue = maybeValue
    }
    return state.setValueAtPath(segments, resolvedValue)
  }

  // --- Error store API — leaf-aware drillable callable Proxy ---
  // `form.errors` merges three reactive sources at every leaf path:
  //   1. `schemaErrors` — refinement-class errors written by the
  //      validation pipeline (`scheduleFieldValidation`, `handleSubmit`,
  //      construction-time seed, hydration).
  //   2. `derivedBlankErrors` — the reactively-derived "No value supplied"
  //      class. Pure function of `(blankPaths, schema.isRequiredAtPath)`,
  //      no writers.
  //   3. `userErrors` — API-injected errors written by `setFieldErrors*`
  //      / `parseApiErrors`-fed entries.
  //
  // Iteration order at each leaf is schema → derived-blank → user, so
  // consumers reading `errors.email` see the structural / synthesised
  // errors first and any user-injected entries appended after. Mirrored
  // in `state.getErrorsForPath` and the per-field accessor.
  //
  // Active-path filter: errors whose `err.path` is no longer reachable
  // through the live form value (e.g. the inactive variant of a
  // discriminated union after a switch) are hidden from `form.errors`.
  // The store-side entries STAY — per-field accessors and the
  // `form.meta.errors` aggregate still expose them, so a programmatic
  // consumer reading errors at a specific path can see what's known
  // about it even when the path isn't currently in the active schema.
  //
  // Container paths are descend-only (no terminal). The "give me every
  // error" need is served by `form.meta.errors` (flat ValidationError[]).
  const errorsProxy = buildErrorsProxy(state)

  function setFieldErrors(errors: ValidationError[]): void {
    state.setAllUserErrors(errors)
  }

  function addFieldErrors(errors: ValidationError[]): void {
    state.addUserErrors(errors)
  }

  function clearFieldErrors(path?: string | (string | number)[]): void {
    // Pragmatic semantic: "make the errors at this path go away" —
    // clears both the schema-owned and user-owned stores. With always-on
    // validation the schema half re-populates on the next mutation if
    // the value is still invalid, so the inconsistency is short-lived
    // and confined to "before the next keystroke / submit." See
    // docs/migration/0.11-to-0.12.md for the rationale.
    if (path === undefined) {
      state.clearSchemaErrors()
      state.clearUserErrors()
      return
    }
    const segments = canonicalizePath(path as string | Path).segments
    state.clearSchemaErrors(segments)
    state.clearUserErrors(segments)
  }

  // --- Form-level aggregates ---
  // Each entry in `state.originals` stores its canonical `segments`
  // alongside the recorded `value`, so this loop skips `JSON.parse` per
  // iteration. See phase 5.1 notes.
  const isDirty = computed<boolean>(() => {
    for (const [, { segments, value: original }] of state.originals) {
      if (!Object.is(getAtPath(state.form.value, segments), original)) return true
    }
    // Storage matches but blank membership might have
    // changed (user cleared a field whose default was non-empty, or
    // typed into a field that was construction-time-empty). Compare
    // the live reactive set against the construction-time snapshot.
    if (state.blankPaths.size !== state.originalBlankPaths.size) return true
    for (const key of state.blankPaths) {
      if (!state.originalBlankPaths.has(key)) return true
    }
    return false
  })

  const isValid = computed<boolean>(
    () =>
      state.schemaErrors.size === 0 &&
      state.userErrors.size === 0 &&
      state.derivedBlankErrors.value.size === 0
  )

  // --- Submission lifecycle ---
  const isSubmitting = computed<boolean>(() => state.isSubmitting.value)
  const submitCount = computed<number>(() => state.submitCount.value)
  const submitError = computed<unknown>(() => state.submitError.value)

  // --- Validation lifecycle ---
  const isValidating = computed<boolean>(() => state.activeValidations.value > 0)

  // --- History (undo/redo) ---
  // When the consumer doesn't configure history, fall back to inert
  // stubs so the public API shape stays consistent whether or not
  // the feature is enabled.
  const history = options.history
  const undo = history?.undo ?? (() => false)
  const redo = history?.redo ?? (() => false)
  const canUndo = history?.canUndo ?? computed(() => false)
  const canRedo = history?.canRedo ?? computed(() => false)
  const historySize = history?.historySize ?? computed(() => 0)

  // --- Form-level meta aggregate ---
  // `metaErrors` flattens the three reactive error stores into a single
  // ValidationError[]. Unlike `form.errors.<path>` (per-leaf, active-
  // path filtered), this aggregate is UNFILTERED — inactive-variant
  // errors stay in. Consumers who want only addressable errors filter
  // the array themselves.
  //
  // Order is determined by the SET of errors currently present, not by
  // the temporal sequence of validations. Each path is bucketed at its
  // schema-declaration ordinal (`state.ensurePathOrdinal`); buckets sort
  // by ordinal and flatten in order. Within one ordinal slot the
  // per-store iteration order survives — schema → blank → user — so a
  // path with both a schema error and a userErrors entry surfaces both
  // at the same slot in their existing relative order. Resurrected
  // errors return to the slot they originally occupied: clearing
  // `email` then re-breaking it puts `email` back ahead of `password`,
  // not at the end of the aggregate.
  const metaErrors = computed<readonly ValidationError[]>(() => {
    const buckets = new Map<number, ValidationError[]>()
    const collect = (errs: ReadonlyMap<PathKey, ValidationError[]>): void => {
      for (const [pathKey, list] of errs) {
        if (list.length === 0) continue
        const ordinal = state.ensurePathOrdinal(pathKey)
        const existing = buckets.get(ordinal)
        if (existing === undefined) buckets.set(ordinal, [...list])
        else existing.push(...list)
      }
    }
    collect(state.schemaErrors)
    collect(state.derivedBlankErrors.value)
    collect(state.userErrors)
    if (buckets.size === 0) return []
    return [...buckets.entries()].sort(([a], [b]) => a - b).flatMap(([, errs]) => errs)
  })

  // --- Form-level meta bundle ---
  // Vue auto-unwraps refs that are top-level on a setup return, but not
  // refs nested in a return *object* — those render as their wrapper
  // (always truthy) and silently break bindings like `:disabled`. We
  // work around it by placing the scalars + computed array inside
  // `reactive()`, which unwraps ref values on property access at any
  // depth; `readonly()` layers a runtime write-guard on top.
  //
  // Named `formMeta` locally to avoid shadowing the `state: FormStore<F>`
  // param this function receives; exposed as `meta` on the public return.
  const formMeta = readonly(
    reactive({
      isDirty,
      isValid,
      isSubmitting,
      isValidating,
      submitCount,
      submitError,
      canUndo,
      canRedo,
      historySize,
      errors: metaErrors,
      // Per-`useForm()`-call identity. Stable for one mount; new on
      // re-mount; orthogonal to `form.key` (which is the user-supplied
      // shared identifier). Useful for devtools panels disambiguating
      // shared-key instances, telemetry hooks tagging events with
      // "which mount", and E2E tests stamping `data-form-id`.
      instanceId: formInstanceId,
    })
  ) as FormMeta

  // --- Persistence handle (cached on FormStore by useAbstractForm
  // when persist: is configured). The persist + clearPersistedDraft
  // APIs below close over this; reset / resetField also poke it. ---
  const persistence = state.modules.get(PERSISTENCE_MODULE_KEY) as PersistenceModule | undefined

  // --- Reset ---
  // Reset semantics are "fresh start across every layer" — drafts are
  // transient, so a reset that left stale storage behind would surprise
  // on next mount (form would re-hydrate the discarded draft). The
  // opt-in registry is NOT touched: directives are still mounted and
  // the next user keystroke on an opted-in input re-populates the
  // entry naturally.
  const reset = (nextDefaultValues?: DeepPartial<DefaultValuesShape<Form>>): void => {
    if (nextDefaultValues === undefined) {
      state.reset()
    } else {
      // Walk the consumer's overrides for `unset` symbols, replacing
      // them with the schema's slim defaults and capturing the marked
      // paths. The cleaned values land in form storage via state.reset;
      // the marked paths get added back via direct setValueAtPath
      // calls AFTER the reset so the FormStore's own reset (which
      // clears the blank set in the args branch) doesn't
      // wipe them.
      const walked = walkUnsetSentinels(
        nextDefaultValues,
        state.schema as unknown as Parameters<typeof walkUnsetSentinels>[1]
      )
      // After the walker, `cleanedValues` has had every `unset` symbol
      // replaced with the schema's slim default — the result is
      // structurally compatible with `WriteShape<Form>`, so the cast
      // here is safe.
      state.reset(walked.cleanedValues as DeepPartial<unknown> as Parameters<typeof state.reset>[0])
      for (const pathKey of walked.paths) {
        const segments = JSON.parse(pathKey) as Path
        state.setValueAtPath(segments, state.schema.getDefaultAtPath(segments), {
          blank: true,
        })
        // Mirror the new baseline into originalBlankPaths so the
        // post-reset state is the dirty=false reference.
        state.originalBlankPaths.add(pathKey as PathKey)
      }
    }
    if (persistence !== undefined) {
      // Fire-and-forget — reset is sync from the consumer's POV; the
      // wipe lands a moment later. Errors are absorbed by the adapter
      // contract (best-effort).
      void persistence.clearPersistedDraft().catch(() => undefined)
    }
  }

  const resetField = (pathInput: string): void => {
    const segments = canonicalizePath(pathInput).segments
    state.resetField(segments)
    if (persistence !== undefined) {
      void persistence.clearPersistedDraft(segments).catch(() => undefined)
    }
  }

  // --- Persistence (imperative APIs) ---

  const persist = async (
    pathInput: string | Path,
    options?: { acknowledgeSensitive?: boolean }
  ): Promise<void> => {
    const segments = canonicalizePath(pathInput).segments
    enforceSensitiveCheck(segments, options?.acknowledgeSensitive === true)
    if (persistence === undefined) return // persist: not configured → silent no-op
    await persistence.writePathImmediately(segments)
  }

  const clearPersistedDraft = async (pathInput?: string | Path): Promise<void> => {
    if (persistence === undefined) return
    if (pathInput === undefined) {
      await persistence.clearPersistedDraft()
      return
    }
    const segments = canonicalizePath(pathInput).segments
    await persistence.clearPersistedDraft(segments)
  }

  // --- Focus / scroll to first error ---
  // Both helpers scope to `formInstanceId` so two `useForm()` callsites
  // sharing a `key` (e.g. sidebar + main mounting the same form) only
  // focus / scroll within their own registered elements.
  const focusFirstError = (options?: { preventScroll?: boolean }): boolean => {
    const target = state.getFirstErrorElement(formInstanceId)
    if (target === null) return false
    target.element.focus(options)
    return true
  }

  const scrollToFirstError = (options?: ScrollIntoViewOptions): boolean => {
    const target = state.getFirstErrorElement(formInstanceId)
    if (target === null) return false
    target.element.scrollIntoView(options)
    return true
  }

  // --- Field arrays ---
  const fieldArrays = buildFieldArrayApi(state)

  // --- Bulk blank introspection ---
  // Read-only view of the form's blank path set. Vue 3.5
  // tracks `.has()` / `for..of` / size accesses on a reactive Set,
  // so the computed below is a lazy, dependency-tracked passthrough.
  // Wrapped in a Proxy that traps mutating methods so consumers can't
  // pollute the snapshot they receive (`Object.freeze` does NOT make
  // a Set readonly — `add` / `delete` / `clear` still work on frozen
  // Sets). Writes still go through `setValue(_, unset)` /
  // `markBlank()` / the directive's input listener.
  const blankPathsView = computed<ReadonlySet<string>>(() => {
    return readonlySetSnapshot(state.blankPaths)
  })

  // --- Pinia-style reactive readonly proxy over the form's value ---
  // `valuesProxyComputed.value` is a deeply-readonly Vue proxy. The
  // computed wrapping ensures `state.form.value` reassignments (the
  // `applyFormReplacement` path used by `reset()` and whole-form
  // `setValue`) invalidate the inner readonly proxy and produce a
  // fresh one keyed to the new target. The callable proxy itself is
  // identity-stable — consumers caching `form.values` get a stable
  // reference whose underlying data tracks the live form value.
  const valuesProxy = buildValuesProxy(state.form)

  // --- Pinia-style reactive per-field state proxy ---
  // Allocated once per buildFormApi call (one per consumer). Each Proxy
  // node memoizes its descendants and the per-path FieldStateView
  // computed it reads through, so repeated access to the same path
  // (`form.fields.email` twice) returns the same object — useful
  // for downstream `===` checks and Vue's render diff.
  const fieldStateProxy = buildFieldStateProxy(state)

  return {
    handleSubmit,
    // `values` is the callable readonly Proxy. Each `get` trap reads
    // through `inner.value` (a `computed(() => readonly(form.value))`)
    // so reactivity tracking propagates at the call site. Identity-
    // stable across whole-form swaps (the inner readonly proxy
    // re-keys; the outer callable proxy stays the same instance).
    values: valuesProxy as unknown as UseFormReturnType<Form, GetValueFormType>['values'],
    fields: fieldStateProxy as unknown as UseFormReturnType<Form, GetValueFormType>['fields'],
    setValue: setValueImpl as UseFormReturnType<Form, GetValueFormType>['setValue'],
    validate: validate as UseFormReturnType<Form, GetValueFormType>['validate'],
    validateAsync: validateAsync as UseFormReturnType<Form, GetValueFormType>['validateAsync'],
    register: register as UseFormReturnType<Form, GetValueFormType>['register'],
    key: state.formKey,
    errors: errorsProxy as unknown as FormErrorsSurface<Form>,
    toRef: pathToRef as UseFormReturnType<Form, GetValueFormType>['toRef'],
    setFieldErrors,
    addFieldErrors,
    clearFieldErrors,
    meta: formMeta,
    reset: reset as UseFormReturnType<Form, GetValueFormType>['reset'],
    resetField: resetField as UseFormReturnType<Form, GetValueFormType>['resetField'],
    persist: persist as UseFormReturnType<Form, GetValueFormType>['persist'],
    clearPersistedDraft: clearPersistedDraft as UseFormReturnType<
      Form,
      GetValueFormType
    >['clearPersistedDraft'],
    focusFirstError,
    scrollToFirstError,
    undo,
    redo,
    append: fieldArrays.append as UseFormReturnType<Form, GetValueFormType>['append'],
    prepend: fieldArrays.prepend as UseFormReturnType<Form, GetValueFormType>['prepend'],
    insert: fieldArrays.insert as UseFormReturnType<Form, GetValueFormType>['insert'],
    remove: fieldArrays.remove as UseFormReturnType<Form, GetValueFormType>['remove'],
    swap: fieldArrays.swap as UseFormReturnType<Form, GetValueFormType>['swap'],
    move: fieldArrays.move as UseFormReturnType<Form, GetValueFormType>['move'],
    replace: fieldArrays.replace as UseFormReturnType<Form, GetValueFormType>['replace'],
    blankPaths: blankPathsView,
  }
}
