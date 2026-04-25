import { reactive, ref, type Ref } from 'vue'
import type {
  AbstractSchema,
  FieldValidationConfig,
  FieldValidationMode,
  FormKey,
  DefaultValuesResponse,
  ValidationError,
  ValidationMode,
} from '../types/types-api'
import type { DeepPartial, GenericForm } from '../types/types-core'
import { diffAndApply } from './diff-apply'
import { canonicalizePath, type Path, type PathKey, type Segment } from './paths'
import { getAtPath, setAtPath } from './path-walker'

/**
 * Per-form closure state — the single store owned by each `useForm` call.
 * Replaces five separate `useState`-backed composables from the pre-rewrite
 * code (form, summary, element, field-state, meta-tracker, error), and in
 * doing so fixes the cross-form DOM state collision that stemmed from those
 * stores being keyed only by `path` instead of `(formKey, path)`.
 *
 * This is NOT a singleton. Each call to `useForm` creates its own FormStore
 * instance and holds onto it via closure. The registry (Phase 2) provides
 * SSR hydration; otherwise the state is per-component-per-form.
 */

/** Per-path field status. Replaced wholesale (not mutated in place) on every change. */
export type FieldRecord = {
  readonly path: Path
  readonly updatedAt: string | null
  readonly isConnected: boolean
  readonly focused: boolean | null
  readonly blurred: boolean | null
  readonly touched: boolean | null
}

/** Per-path DOM element tracking. Client-only. */
export type ElementRecord = {
  readonly elements: Set<HTMLElement>
}

/**
 * Per-path record stored in `originals`. Pairing `segments` with the tracked
 * value means `isDirty` and `resetField`'s container loop don't have to
 * `JSON.parse(pathKey)` on every iteration — the canonical Path is already
 * sitting next to the value it belongs to. PathKey still keys the Map (the
 * stable string is the only collision-free identifier), but downstream
 * iteration reads `segments` directly.
 */
export type OriginalsRecord = {
  readonly segments: Path
  readonly value: unknown
}

export type FormStore<F extends GenericForm, G extends GenericForm = F> = {
  readonly formKey: FormKey
  readonly form: Ref<F>
  readonly fields: Map<PathKey, FieldRecord>
  readonly elements: Map<PathKey, ElementRecord>
  /**
   * Schema-driven errors. Written ONLY by the schema validation pipeline:
   * `scheduleFieldValidation`, `handleSubmit`, the construction-time seed,
   * history restore, and hydration. Cleared by `reset` / `resetField` and by
   * a successful submit. `setFieldErrors*` APIs do NOT touch this Map.
   */
  readonly schemaErrors: Map<PathKey, ValidationError[]>
  /**
   * User-injected errors. Written ONLY by the `setFieldErrors*` API surfaces
   * (and history / hydration replay). Survives schema revalidation and
   * successful submits — the consumer owns its lifetime explicitly.
   */
  readonly userErrors: Map<PathKey, ValidationError[]>
  /**
   * Compat alias for `schemaErrors` — same Map reference, same writes.
   * Removed once the validation refactor lands fully (see migration guide
   * 0.11 → 0.12).
   */
  readonly errors: Map<PathKey, ValidationError[]>
  readonly originals: Map<PathKey, OriginalsRecord>
  readonly schema: AbstractSchema<F, G>

  /**
   * Server-side flag, plumbed in from `registry.isSSR`. The
   * `register()`-returned `markConnectedOptimistically()` reads this
   * before flipping `isConnected: true`; on the client it's a no-op so
   * the eventual directive lifecycle remains the source of truth.
   */
  readonly isSSR: boolean

  // --- submission lifecycle ---
  // Driven by buildProcessForm's handleSubmit wrapper. See use-abstract-form.ts
  // for the public readonly surface. Mutations happen in exactly one place
  // (the submit handler) so there's no "source of truth" ambiguity — these
  // refs live on FormStore so a `reset()` can clear them too.
  //
  // `activeSubmissions` is the source of truth for "is anything in flight".
  // `isSubmitting` mirrors `activeSubmissions > 0` and is what consumers
  // read; tracking the counter separately means overlapping submissions
  // don't prematurely flip isSubmitting to false when the first completes.
  readonly isSubmitting: Ref<boolean>
  readonly activeSubmissions: Ref<number>
  readonly submitCount: Ref<number>
  readonly submitError: Ref<unknown>
  /**
   * Incremented by every `reset()` call. The submit wrapper captures
   * this at entry and skips writing `submitError` from a catch that
   * fires *after* a reset — otherwise a reset-during-submit would
   * visibly clear `submitError` and then have it reappear when the
   * in-flight promise rejects.
   */
  readonly submissionGeneration: Ref<number>
  /**
   * Counts in-flight validation calls across every `validate()` ref and
   * every `validateAsync(...)` / `handleSubmit` pre-check. `isValidating`
   * on the public API mirrors `activeValidations.value > 0`. Tracked
   * separately from submissions because a validate-while-submitting
   * (e.g. a debounced field check overlapping a submit) needs to show
   * the union of both surfaces.
   */
  readonly activeValidations: Ref<number>

  // --- form mutations ---
  applyFormReplacement(next: F): void
  setValueAtPath(path: Path, value: unknown): void
  getValueAtPath(path: Path): unknown

  // --- reset ---
  reset(nextDefaultValues?: DeepPartial<F>): void
  resetField(path: Path): void

  // --- errors ---
  // Schema-driven writers. Used by the validation pipeline + handleSubmit.
  setSchemaErrorsForPath(path: Path, errors: ValidationError[]): void
  setAllSchemaErrors(errors: readonly ValidationError[]): void
  clearSchemaErrors(path?: Path): void

  // User-driven writers. Used by build-form-api's setFieldErrors* surfaces.
  setAllUserErrors(errors: readonly ValidationError[]): void
  addUserErrors(errors: readonly ValidationError[]): void
  clearUserErrors(path?: Path): void

  /**
   * Merged read — returns `[...schemaErrors[path], ...userErrors[path]]`.
   * Schema errors come first (structural validation before business logic),
   * matching the iteration order for `getFirstErrorElement` and the
   * top-level `fieldErrors` view.
   */
  getErrorsForPath(path: Path): ValidationError[]

  // Compat shims — removed in 0.12. Each routes to the schema-store
  // equivalent so build-form-api keeps working through step 1; step 2
  // rewires its callers (setFieldErrors / addFieldErrors / clearFieldErrors)
  // to the user-store writers above.
  setErrorsForPath(path: Path, errors: ValidationError[]): void
  setAllErrors(errors: readonly ValidationError[]): void
  addErrors(errors: readonly ValidationError[]): void
  clearErrors(path?: Path): void

  // --- DOM ---
  registerElement(path: Path, element: HTMLElement): boolean
  deregisterElement(path: Path, element: HTMLElement): number
  markFocused(path: Path, focused: boolean): void
  markTouched(path: Path): void
  /**
   * SSR-only optimistic mark: flip `isConnected: true` on the field
   * record without an actual DOM element. Called by the `vRegisterHint`
   * compile-time transform via `RegisterValue.markConnectedOptimistically()`
   * for every element rendered with `v-register`. Idempotent + no-op on
   * the client (the directive's `created` hook is the authoritative
   * source there).
   */
  markConnectedOptimistically(path: Path): void

  // --- derived ---
  /**
   * Leaf-only pristine check. `originals` is populated via
   * `diffAndApply`'s `added` patches, which fire only on primitive
   * leaves — a container path (e.g. `['profile']`) that isn't in
   * `originals` returns `true` here even when a descendant is dirty.
   * Callers that need container semantics should either loop over
   * leaves or walk `originals` manually. The public `getFieldState`
   * surface is typed to accept leaf paths only, so in practice this
   * isn't exposed to consumers.
   */
  isPristineAtPath(path: Path): boolean
  getFieldRecord(path: Path): FieldRecord | undefined
  getOriginalAtPath(path: Path): unknown
  /**
   * Returns the first errored field's first connected, visible DOM
   * element — the target that `focusFirstError` / `scrollToFirstError`
   * act on. Iteration order matches `errors`' insertion order (Map
   * preserves it), so the "first" error is whichever the schema reported
   * first during validation.
   *
   * Returns `null` when every errored path has no currently-attached
   * element (fields behind `v-if="false"`, unmounted components, or a
   * hidden `display:none` parent). Callers get the choice of no-op or a
   * dev-only warning.
   */
  getFirstErrorElement(): { path: Path; element: HTMLElement } | null

  /**
   * Cancel every in-flight field-level validation run — clears timers
   * for debounced 'change' runs that haven't fired, aborts controllers
   * for runs whose async parse is in flight. Called by `handleSubmit`
   * at entry (submit validation is authoritative) and by `reset()`.
   */
  cancelFieldValidation(): void

  /**
   * Subscribe to every `applyFormReplacement`. Fires synchronously
   * after `form.value` has been swapped to `next` and all field /
   * originals bookkeeping has run. Used by persistence + undo/redo
   * to hook the single mutation funnel. Returns an unsubscribe
   * function.
   */
  onFormChange(listener: (next: F) => void): () => void

  /**
   * Subscribe to successful submissions. Fires after the consumer's
   * `onSubmit` callback has resolved — not on validation failure,
   * not on callback throw. Used by persistence's `clearOnSubmitSuccess`
   * to drop the stored payload once the form is safely through the
   * server round-trip. Returns an unsubscribe function.
   */
  onSubmitSuccess(listener: () => void): () => void

  /**
   * Subscribe to `reset()` calls. Fires AFTER reset has replaced
   * the form and cleared errors + lifecycle, so listeners see the
   * fresh post-reset state. Used by the history module to drop the
   * undo/redo stack on reset. Returns an unsubscribe function.
   */
  onReset(listener: () => void): () => void

  /**
   * Internal: notify submit-success subscribers. Called by
   * `handleSubmit` in `process-form.ts` once the user callback has
   * resolved. Consumers shouldn't call this directly.
   */
  emitSubmitSuccess(): void

  /**
   * Register a teardown function whose lifetime is bound to the
   * FormStore itself (not a consumer's Vue effect scope). Called by
   * `dispose()` when the last consumer unmounts. Used by persistence /
   * history wiring so their subscribers aren't detached prematurely
   * when only the first consumer unmounts but others remain.
   */
  registerCleanup(fn: () => void): void

  /**
   * Cache for per-state modules (history, persistence) that must
   * outlive any single consumer. Subsequent `useForm` / `useFormContext`
   * calls for the same key read from this map so the public API shape
   * is identical regardless of mount order. Keyed by a string identifier
   * owned by the caller (e.g. `'history'`).
   */
  readonly modules: Map<string, unknown>

  /**
   * Tear down non-reactive resources owned by this FormStore. Invoked
   * by the registry when the last consumer unmounts. Cancels pending
   * field-validation timers, drops every subscriber, and fires each
   * cleanup hook registered via `registerCleanup`.
   */
  dispose(): void
}

/**
 * Hydration payload shape accepted by `createFormStore`. When provided, the
 * initial form value comes from here rather than from `schema.getDefaultValues`.
 * Used to replay SSR state on the client; originals are reconstructed from
 * the schema because they're not serialised.
 */
export type FormStoreHydration = {
  readonly form: unknown
  readonly errors: ReadonlyArray<readonly [string, unknown]>
  readonly fields: ReadonlyArray<readonly [string, unknown]>
}

export type CreateFormStoreOptions<F extends GenericForm, G extends GenericForm = F> = {
  readonly formKey: FormKey
  readonly schema: AbstractSchema<F, G>
  readonly defaultValues?: DeepPartial<F> | undefined
  readonly validationMode?: ValidationMode | undefined
  readonly hydration?: FormStoreHydration | undefined
  readonly fieldValidation?: FieldValidationConfig | undefined
  readonly isSSR?: boolean | undefined
}

export function createFormStore<F extends GenericForm, G extends GenericForm = F>(
  options: CreateFormStoreOptions<F, G>
): FormStore<F, G> {
  const { formKey, schema, defaultValues, validationMode = 'lax', hydration } = options
  const isSSR = options.isSSR === true
  const fieldValidationMode: FieldValidationMode = options.fieldValidation?.on ?? 'none'
  const fieldValidationDebounceMs: number = options.fieldValidation?.debounceMs ?? 200

  type FieldValidationEntry = {
    controller: AbortController
    timer: ReturnType<typeof setTimeout> | null
  }
  const fieldValidationState = new Map<PathKey, FieldValidationEntry>()

  // Plain Sets (not reactive) — these fire imperative callbacks; no
  // template should ever depend on "how many listeners are attached".
  const formChangeListeners = new Set<(next: F) => void>()
  const submitSuccessListeners = new Set<() => void>()
  const resetListeners = new Set<() => void>()

  // State-scoped teardown hooks. Persistence / history / any other
  // per-state module registers its disposer here so the cleanup is
  // bound to the FormStore's own lifetime (`dispose()` call at
  // registry-eviction) and not the first consumer's effect scope.
  const cleanupHooks: (() => void)[] = []
  const modules = new Map<string, unknown>()

  // Schema is ALWAYS consulted: we need the schema-derived originals even
  // when hydrating, so pristine/dirty computation survives SSR round-trip.
  // The form's actual starting value, though, prefers hydration data.
  const schemaResponse: DefaultValuesResponse<F> = schema.getDefaultValues({
    useDefaultSchemaValues: true,
    constraints: defaultValues,
    validationMode,
  })
  const schemaInitialData = schemaResponse.data

  const initialData: F = hydration !== undefined ? (hydration.form as F) : schemaInitialData

  const form = ref(initialData) as Ref<F>

  // Per-path state. `reactive(new Map())` uses Vue's collection handlers —
  // reads of specific keys track those keys only, so a change to one field
  // doesn't invalidate computeds watching another.
  const fields = reactive(new Map<PathKey, FieldRecord>()) as Map<PathKey, FieldRecord>
  const elements = reactive(new Map<PathKey, ElementRecord>()) as Map<PathKey, ElementRecord>
  // Errors are split by source so each writer touches exactly one slot.
  // Schema validation owns `schemaErrors`; the `setFieldErrors*` APIs own
  // `userErrors`. The two stores merge on read via `getErrorsForPath` and
  // the top-level `fieldErrors` view in build-form-api.
  const schemaErrors = reactive(new Map<PathKey, ValidationError[]>()) as Map<
    PathKey,
    ValidationError[]
  >
  const userErrors = reactive(new Map<PathKey, ValidationError[]>()) as Map<
    PathKey,
    ValidationError[]
  >
  // Compat alias: same Map reference as `schemaErrors`. Step 6 of the
  // refactor removes this from the FormStore type entirely.
  const errors = schemaErrors

  // Originals are captured at init and on first appearance of a path; never
  // re-assigned. Not reactive — the set is append-only per form's lifetime.
  // Value is a {segments, value} record so consumers iterating this Map
  // (isDirty, resetField's container loop) don't need to `JSON.parse(key)`
  // to recover the canonical Path.
  const originals = new Map<PathKey, OriginalsRecord>()

  // Submission lifecycle refs. Initial values encode "no submission has
  // happened yet": not in flight, zero attempts, no captured error.
  // `activeSubmissions` counts concurrent in-flight submissions so the
  // last completion (count → 0) is what flips `isSubmitting` to false,
  // not just the first.
  const isSubmitting = ref(false)
  const activeSubmissions = ref(0)
  const submitCount = ref(0)
  const submitError = ref<unknown>(null)
  const submissionGeneration = ref(0)
  const activeValidations = ref(0)

  // Populate originals by diffing from empty-form to schema-initial. This is
  // always the schema's shape regardless of hydration, so pristine/dirty
  // comparisons are against what the form was supposed to start as.
  const initStamp = new Date().toISOString()
  diffAndApply({}, schemaInitialData, [], (patch) => {
    if (patch.kind !== 'added') return
    const { key } = canonicalizePath(patch.path)
    originals.set(key, { segments: patch.path, value: patch.newValue })
  })

  // Populate fields from either the hydration payload (preserves exact
  // server-side timestamps and flags) or by walking initialData for leaves.
  if (hydration !== undefined) {
    for (const [rawKey, record] of hydration.fields) {
      fields.set(rawKey as PathKey, record as FieldRecord)
    }
    // Hydration's flat `errors` field maps to schemaErrors for now —
    // step 5 expands the payload to carry schemaErrors + userErrors
    // separately so hydrated user errors round-trip cleanly.
    for (const [rawKey, errs] of hydration.errors) {
      schemaErrors.set(rawKey as PathKey, errs as ValidationError[])
    }
  } else {
    diffAndApply({}, initialData, [], (patch) => {
      if (patch.kind !== 'added') return
      const { key } = canonicalizePath(patch.path)
      fields.set(key, {
        path: patch.path,
        updatedAt: initStamp,
        isConnected: false,
        focused: null,
        blurred: null,
        touched: null,
      })
    })
  }

  function touchFieldRecord(
    pathKey: PathKey,
    path: Path,
    patch: Partial<Omit<FieldRecord, 'path'>>
  ): void {
    const current = fields.get(pathKey)
    fields.set(pathKey, {
      path,
      updatedAt: patch.updatedAt ?? current?.updatedAt ?? null,
      isConnected: patch.isConnected ?? current?.isConnected ?? false,
      focused: patch.focused ?? current?.focused ?? null,
      blurred: patch.blurred ?? current?.blurred ?? null,
      touched: patch.touched ?? current?.touched ?? null,
    })
  }

  function applyFormReplacement(next: F): void {
    const prev = form.value
    if (Object.is(prev, next)) return
    form.value = next
    const now = new Date().toISOString()
    diffAndApply(prev, next, [], (patch) => {
      const { key } = canonicalizePath(patch.path)
      // Runtime-added paths (e.g. `append('posts', {...})` introducing a
      // new array index) must compare against `undefined` for `isDirty`
      // — appearing IS a mutation. Only `reset()` rebaselines the
      // originals map; this branch records absence-as-original so the
      // first appearance is correctly seen as dirty.
      if (patch.kind === 'added' && !originals.has(key)) {
        originals.set(key, { segments: patch.path, value: undefined })
      }
      touchFieldRecord(key, patch.path, { updatedAt: now })
    })
    // Notify any subscribed modules (persistence, undo/redo) — fire
    // after field bookkeeping so listeners see a fully-updated form.
    // Listener throws are isolated so one misbehaving subscriber
    // can't block the others.
    for (const listener of formChangeListeners) {
      try {
        listener(next)
      } catch (err) {
        console.error('[@chemical-x/forms] onFormChange threw:', err)
      }
    }
  }

  function setValueAtPath(path: Path, value: unknown): void {
    const nextForm = setAtPath(form.value, path, value) as F
    applyFormReplacement(nextForm)
    if (fieldValidationMode === 'change') {
      scheduleFieldValidation(path, false /* debounced */)
    }
  }

  /**
   * Schedule (or kick off immediately) a field-level validation run
   * for `path`. Per-path AbortController semantics: a new schedule
   * cancels any prior in-flight run for the same path, so rapid
   * successive writes don't pile up concurrent validations.
   *
   * The validation reads the current value at `path` from `form.value`
   * AT THE TIME THE TIMER FIRES, not at schedule time. That's the
   * correct semantics for a debounced change trigger: the user's
   * latest-keystroke value is what matters, not whichever value
   * tripped the timer scheduler N milliseconds ago.
   */
  function scheduleFieldValidation(path: Path, immediate: boolean): void {
    if (fieldValidationMode === 'none') return
    const { key } = canonicalizePath(path)
    const prev = fieldValidationState.get(key)
    if (prev !== undefined) {
      if (prev.timer !== null) clearTimeout(prev.timer)
      prev.controller.abort()
    }
    const controller = new AbortController()
    const fresh: FieldValidationEntry = { controller, timer: null }
    fieldValidationState.set(key, fresh)

    const run = () => {
      fresh.timer = null
      if (controller.signal.aborted) return
      const data = getAtPath(form.value, path)
      activeValidations.value += 1
      void Promise.resolve()
        .then(() => schema.validateAtPath(data, path))
        .then((response) => {
          if (controller.signal.aborted) return
          // The adapter emits issue paths relative to the sub-schema it
          // parsed (e.g. `[]` for a leaf string). Re-stamp each error
          // with the absolute field path so `fieldErrors[<dotted path>]`
          // lookups match the key the consumer is watching for.
          const nextErrors = response.success
            ? []
            : response.errors.map((err) => ({
                ...err,
                path: [...path, ...(err.path as Segment[])],
              }))
          setSchemaErrorsForPath(path, nextErrors)
        })
        .catch(() => {
          // Adapter contract forbids throws — swallow here so a misbehaving
          // custom adapter doesn't surface as an uncaught rejection. The
          // silent drop matches the reactive `validate()` ref's catch
          // branch for adapter-level throws (see process-form.ts).
        })
        .finally(() => {
          activeValidations.value = Math.max(0, activeValidations.value - 1)
        })
    }

    if (immediate) {
      run()
    } else {
      fresh.timer = setTimeout(run, fieldValidationDebounceMs)
    }
  }

  function cancelFieldValidation(): void {
    for (const entry of fieldValidationState.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer)
      entry.controller.abort()
    }
    fieldValidationState.clear()
  }

  function onFormChange(listener: (next: F) => void): () => void {
    formChangeListeners.add(listener)
    return () => {
      formChangeListeners.delete(listener)
    }
  }

  function onSubmitSuccess(listener: () => void): () => void {
    submitSuccessListeners.add(listener)
    return () => {
      submitSuccessListeners.delete(listener)
    }
  }

  function onReset(listener: () => void): () => void {
    resetListeners.add(listener)
    return () => {
      resetListeners.delete(listener)
    }
  }

  function emitSubmitSuccess(): void {
    for (const listener of submitSuccessListeners) {
      try {
        listener()
      } catch (err) {
        console.error('[@chemical-x/forms] onSubmitSuccess threw:', err)
      }
    }
  }

  function registerCleanup(fn: () => void): void {
    cleanupHooks.push(fn)
  }

  function dispose(): void {
    // Run state-scoped teardowns BEFORE clearing listener sets, so a
    // module that wants to flush something by emitting one last event
    // from its cleanup (unlikely but harmless) doesn't find the
    // listener set already empty. Each hook runs inside try/catch so
    // one misbehaving module can't block the others.
    for (const hook of cleanupHooks) {
      try {
        hook()
      } catch (err) {
        console.error('[@chemical-x/forms] cleanup threw:', err)
      }
    }
    cleanupHooks.length = 0
    modules.clear()
    cancelFieldValidation()
    formChangeListeners.clear()
    submitSuccessListeners.clear()
    resetListeners.clear()
  }

  function getValueAtPath(path: Path): unknown {
    return getAtPath(form.value, path)
  }

  // --- Errors ---
  // Two source-segregated stores: `schemaErrors` (validation-owned) and
  // `userErrors` (API-injected). Writers below are strict — each function
  // touches exactly one Map. The merged view is exposed via
  // `getErrorsForPath` and the top-level `fieldErrors` computed.

  /**
   * Append every entry in `entries` to its target Map at the canonical
   * path key. Existing entries at that key are preserved (merge-append),
   * which matches the documented `addFieldErrors` semantics. Allocates a
   * fresh array per target key to keep the reactive trigger surface
   * obvious — Vue's collection handlers fire on `.set`, not on in-place
   * push.
   */
  function appendErrorsTo(
    map: Map<PathKey, ValidationError[]>,
    entries: readonly ValidationError[]
  ): void {
    for (const err of entries) {
      const { key } = canonicalizePath(err.path as Path)
      const current = map.get(key)
      if (current === undefined) {
        map.set(key, [err])
      } else {
        map.set(key, [...current, err])
      }
    }
  }

  /**
   * Clear `map` and rebuild it from `entries`. Two reactive notifications
   * fire (one for `.clear`, one per `.set`), but Vue's microtask batching
   * collapses the burst so subscribers see one re-render. A diff-and-patch
   * variant is a deferred follow-up — profile first.
   */
  function replaceErrorsIn(
    map: Map<PathKey, ValidationError[]>,
    entries: readonly ValidationError[]
  ): void {
    map.clear()
    appendErrorsTo(map, entries)
  }

  function clearErrorsIn(map: Map<PathKey, ValidationError[]>, path: Path | undefined): void {
    if (path === undefined) {
      map.clear()
      return
    }
    const { key } = canonicalizePath(path)
    map.delete(key)
  }

  // --- Schema writers (validation pipeline + handleSubmit + history/hydration) ---

  function setSchemaErrorsForPath(path: Path, entries: ValidationError[]): void {
    const { key } = canonicalizePath(path)
    if (entries.length === 0) {
      schemaErrors.delete(key)
      return
    }
    schemaErrors.set(key, [...entries])
  }

  function setAllSchemaErrors(entries: readonly ValidationError[]): void {
    replaceErrorsIn(schemaErrors, entries)
  }

  function clearSchemaErrors(path?: Path): void {
    clearErrorsIn(schemaErrors, path)
  }

  // --- User writers (setFieldErrors* surfaces + history/hydration) ---

  function setAllUserErrors(entries: readonly ValidationError[]): void {
    replaceErrorsIn(userErrors, entries)
  }

  function addUserErrors(entries: readonly ValidationError[]): void {
    appendErrorsTo(userErrors, entries)
  }

  function clearUserErrors(path?: Path): void {
    clearErrorsIn(userErrors, path)
  }

  // --- Merged read ---

  function getErrorsForPath(path: Path): ValidationError[] {
    const { key } = canonicalizePath(path)
    const schema = schemaErrors.get(key)
    const user = userErrors.get(key)
    if (schema === undefined) return user === undefined ? [] : [...user]
    if (user === undefined) return [...schema]
    return [...schema, ...user]
  }

  // --- Compat shims (removed in 0.12) ---
  // Each one routes to the schema-store equivalent so existing callers
  // (build-form-api, tests) keep working through step 1. Step 2 rewires
  // setFieldErrors / addFieldErrors / clearFieldErrors / setFieldErrorsFromApi
  // directly to the user-store writers above; step 6 deletes these.

  function setErrorsForPath(path: Path, entries: ValidationError[]): void {
    setSchemaErrorsForPath(path, entries)
  }

  function setAllErrors(entries: readonly ValidationError[]): void {
    setAllSchemaErrors(entries)
  }

  function addErrors(entries: readonly ValidationError[]): void {
    appendErrorsTo(schemaErrors, entries)
  }

  function clearErrors(path?: Path): void {
    clearSchemaErrors(path)
  }

  // --- DOM ---

  function registerElement(path: Path, element: HTMLElement): boolean {
    const { key } = canonicalizePath(path)
    const record = elements.get(key)
    if (record === undefined) {
      elements.set(key, { elements: new Set([element]) })
    } else {
      if (record.elements.has(element)) return false
      record.elements.add(element)
    }
    touchFieldRecord(key, path, { isConnected: true })
    return true
  }

  function deregisterElement(path: Path, element: HTMLElement): number {
    const { key } = canonicalizePath(path)
    const record = elements.get(key)
    if (record === undefined) return 0
    record.elements.delete(element)
    const remaining = record.elements.size
    if (remaining === 0) {
      elements.delete(key)
      touchFieldRecord(key, path, { isConnected: false })
    }
    return remaining
  }

  function markConnectedOptimistically(path: Path): void {
    // Client-side: the directive's `created` / `beforeUnmount` hooks are
    // authoritative for `isConnected`, so this is a no-op there. SSR is
    // the only environment where we can't observe the DOM and need an
    // upfront hint that the field WILL be wired up after hydration.
    if (!isSSR) return
    const { key } = canonicalizePath(path)
    const current = fields.get(key)
    if (current?.isConnected === true) return
    touchFieldRecord(key, path, { isConnected: true })
  }

  function markFocused(path: Path, focused: boolean): void {
    const { key } = canonicalizePath(path)
    touchFieldRecord(key, path, {
      focused,
      blurred: !focused,
      // `touched` becomes true on blur (matches the pre-rewrite contract).
      touched: focused ? (fields.get(key)?.touched ?? null) : true,
    })
    // On blur (focused → false), `fieldValidation: { on: 'blur' }` fires
    // an immediate (no-debounce) validation for this path. Ignored for
    // change/none modes so behaviour matches the declared config.
    if (!focused && fieldValidationMode === 'blur') {
      scheduleFieldValidation(path, true /* immediate */)
    }
  }

  function markTouched(path: Path): void {
    const { key } = canonicalizePath(path)
    touchFieldRecord(key, path, { touched: true })
  }

  // --- Reset ---

  function reset(nextDefaultValues?: DeepPartial<F>): void {
    const next = schema.getDefaultValues({
      useDefaultSchemaValues: true,
      constraints: nextDefaultValues,
      validationMode,
    }).data
    // Replace form in one shot — applyFormReplacement will emit diffAndApply
    // patches and touch field records for every changed leaf.
    applyFormReplacement(next)
    // Rebuild originals from the new baseline. The set becomes the
    // post-reset pristine reference — a subsequent isDirty comparison
    // returns false until the consumer mutates again.
    originals.clear()
    diffAndApply({}, next, [], (patch) => {
      if (patch.kind !== 'added') return
      const { key } = canonicalizePath(patch.path)
      originals.set(key, { segments: patch.path, value: patch.newValue })
    })
    // Drop every recorded error — the form is a fresh surface again.
    // Both stores clear: reset is "fresh start" semantics, so user-injected
    // errors are not preserved across a reset (different from submit-success,
    // which preserves them).
    schemaErrors.clear()
    userErrors.clear()
    // Blow away touched/focused/blurred per field. isConnected stays as-is
    // (the DOM elements haven't detached — that's a separate concern from
    // form state) and updatedAt stamps to now.
    const now = new Date().toISOString()
    for (const [pathKey, record] of fields) {
      fields.set(pathKey, {
        path: record.path,
        updatedAt: now,
        isConnected: record.isConnected,
        focused: null,
        blurred: null,
        touched: null,
      })
    }
    // Clear submission lifecycle so a reset surface reports "nothing has
    // been submitted yet" rather than holding on to the prior run's
    // count. The generation counter is bumped first so any in-flight
    // submission's catch block knows its error write would land on the
    // post-reset state and skips it. `activeSubmissions` is zeroed
    // unconditionally — the finally-block's Math.max clamps the
    // decrement at zero, and `isSubmitting` stays false afterwards
    // because the clamped value never exceeds zero.
    submissionGeneration.value += 1
    isSubmitting.value = false
    activeSubmissions.value = 0
    submitCount.value = 0
    submitError.value = null
    // Drop any pending field-validation timers / in-flight runs. Writes
    // that reached the controller-aborted branch resolve to a no-op, so
    // the error store stays clean after the reset clears it above.
    cancelFieldValidation()
    // Notify subscribers (history module clears its stack, persistence
    // sees the reset via onFormChange already). Listener throws are
    // isolated so one bad subscriber can't block the others.
    for (const listener of resetListeners) {
      try {
        listener()
      } catch (err) {
        console.error('[@chemical-x/forms] onReset threw:', err)
      }
    }
  }

  function resetField(path: Path): void {
    const { key: targetKey, segments: targetSegments } = canonicalizePath(path)

    // Leaf shortcut: direct originals hit means one setValueAtPath does it.
    const leafEntry = originals.get(targetKey)
    if (leafEntry !== undefined) {
      setValueAtPath(targetSegments, leafEntry.value)
      schemaErrors.delete(targetKey)
      userErrors.delete(targetKey)
      clearFieldRecordFlags(targetKey)
      return
    }

    // Container case — reconstruct the subtree by walking originals for
    // every leaf whose path is a descendant of `targetSegments`. We assemble
    // the subtree first, then apply it in one setValueAtPath so diffAndApply
    // sees a single coherent replacement (rather than N mutations).
    //
    // The iteration reads `entry.segments` directly; the alternative
    // (JSON.parse on the Map key) both allocates and pays a parse cost per
    // entry even on cold paths.
    let subtree: unknown = undefined
    let anyMatch = false
    for (const [, entry] of originals) {
      const leafSegments = entry.segments
      if (!isPathPrefix(targetSegments, leafSegments)) continue
      if (leafSegments.length === targetSegments.length) continue // covered by the leaf shortcut above
      anyMatch = true
      const relative = leafSegments.slice(targetSegments.length)
      if (subtree === undefined) {
        // Seed root container type from the first relative segment. Numeric
        // index → array; string key → plain object. setAtPath will stay
        // consistent with that choice for the rest of the walk.
        subtree = typeof relative[0] === 'number' ? [] : {}
      }
      subtree = setAtPath(subtree, relative, entry.value)
    }
    if (!anyMatch) return // nothing tracked under this prefix; no-op

    setValueAtPath(targetSegments, subtree)

    // Clear errors and reset field-record flags for the target + every
    // descendant. Segments come from the stored records (each ValidationError
    // carries its own `path`, each FieldRecord carries `path`), so neither
    // loop has to `JSON.parse` the Map key. Both error stores walk in
    // parallel — resetField is "fresh start at this subtree" semantics, so
    // user-injected errors under the prefix go too.
    deleteErrorsUnderPrefix(schemaErrors, targetSegments)
    deleteErrorsUnderPrefix(userErrors, targetSegments)
    for (const [fieldKey, record] of Array.from(fields.entries())) {
      if (isPathPrefix(targetSegments, record.path)) clearFieldRecordFlags(fieldKey)
    }
  }

  function deleteErrorsUnderPrefix(
    map: Map<PathKey, ValidationError[]>,
    prefix: readonly Segment[]
  ): void {
    for (const [errorKey, errs] of Array.from(map.entries())) {
      const first = errs[0]
      if (first === undefined) continue
      if (isPathPrefix(prefix, first.path as readonly Segment[])) {
        map.delete(errorKey)
      }
    }
  }

  function clearFieldRecordFlags(pathKey: PathKey): void {
    const record = fields.get(pathKey)
    if (record === undefined) return
    fields.set(pathKey, {
      path: record.path,
      updatedAt: new Date().toISOString(),
      isConnected: record.isConnected,
      focused: null,
      blurred: null,
      touched: null,
    })
  }

  /**
   * True iff `prefix` is a path-prefix of `candidate`. Equal arrays count as
   * a prefix (every array is a prefix of itself). Segment equality is strict
   * `===` — `'0'` and `0` are distinct here even though canonicalizePath
   * normalises them upstream; both paths always come from the same
   * canonicalisation so the check holds.
   */
  function isPathPrefix(prefix: readonly Segment[], candidate: readonly Segment[]): boolean {
    if (prefix.length > candidate.length) return false
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] !== candidate[i]) return false
    }
    return true
  }

  // --- Derived ---

  function isPristineAtPath(path: Path): boolean {
    const { key, segments } = canonicalizePath(path)
    const entry = originals.get(key)
    if (entry === undefined) return true
    return Object.is(getAtPath(form.value, segments), entry.value)
  }

  function getFieldRecord(path: Path): FieldRecord | undefined {
    const { key } = canonicalizePath(path)
    return fields.get(key)
  }

  function getOriginalAtPath(path: Path): unknown {
    const { key } = canonicalizePath(path)
    return originals.get(key)?.value
  }

  function getFirstErrorElement(): { path: Path; element: HTMLElement } | null {
    // Walk schema errors first, then user errors. Within each Map,
    // insertion order matches the order the schema (or the consumer)
    // reported issues. Schema-first matches the "structural validation
    // first, business-logic second" UX expectation: a missing-required
    // error should focus before a custom server warning at the same path.
    const hit = firstAttachedErrorElement(schemaErrors) ?? firstAttachedErrorElement(userErrors)
    return hit
  }

  function firstAttachedErrorElement(
    map: Map<PathKey, ValidationError[]>
  ): { path: Path; element: HTMLElement } | null {
    for (const [, errs] of map) {
      const first = errs[0]
      if (first === undefined) continue // defensive — invariant says non-empty
      const { key } = canonicalizePath(first.path as readonly Segment[])
      const record = elements.get(key)
      if (record === undefined || record.elements.size === 0) continue
      for (const el of record.elements) {
        // `el.isConnected` covers the "component was unmounted, element
        // removed from DOM" case that the FieldRecord.isConnected flag
        // can lag on. `el.offsetParent === null` catches `display:none`
        // and its ancestor chain — the browser won't focus or scroll to
        // a hidden element anyway, so we keep walking.
        if (!el.isConnected) continue
        if (el.offsetParent === null) continue
        return { path: first.path as Path, element: el }
      }
    }
    return null
  }

  return {
    formKey,
    form,
    fields,
    elements,
    schemaErrors,
    userErrors,
    errors,
    originals,
    schema,
    isSSR,
    isSubmitting,
    activeSubmissions,
    submitCount,
    submitError,
    submissionGeneration,
    activeValidations,

    applyFormReplacement,
    setValueAtPath,
    getValueAtPath,

    reset,
    resetField,

    setSchemaErrorsForPath,
    setAllSchemaErrors,
    clearSchemaErrors,
    setAllUserErrors,
    addUserErrors,
    clearUserErrors,
    getErrorsForPath,

    setErrorsForPath,
    setAllErrors,
    addErrors,
    clearErrors,

    registerElement,
    deregisterElement,
    markFocused,
    markTouched,
    markConnectedOptimistically,

    isPristineAtPath,
    getFieldRecord,
    getOriginalAtPath,
    getFirstErrorElement,
    cancelFieldValidation,
    onFormChange,
    onSubmitSuccess,
    onReset,
    emitSubmitSuccess,
    registerCleanup,
    modules,
    dispose,
  }
}

export type { Path, PathKey, Segment }
