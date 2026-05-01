import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import type {
  AbstractSchema,
  FieldValidationConfig,
  FieldValidationMode,
  FormKey,
  DefaultValuesResponse,
  ValidationError,
  ValidationMode,
  WriteMeta,
} from '../types/types-api'
import type { DeepPartial, GenericForm, WriteShape } from '../types/types-core'
import { DEFAULT_FIELD_VALIDATION_DEBOUNCE_MS } from './defaults'
import { diffAndApply } from './diff-apply'
import { CxErrorCode } from './error-codes'
import { canonicalizePath, type Path, type PathKey, type Segment } from './paths'
import {
  getAtPath,
  isPlainRecord,
  mergeStructural,
  setAtPath,
  setAtPathWithSchemaFill,
} from './path-walker'
import { isSlimPrimitiveValid } from './slim-primitive-gate'
import { walkUnspecified } from './unset-walker'
import {
  createPersistOptInRegistry,
  type PersistOptInRegistry,
} from './persistence/opt-in-registry'

/**
 * Per-form closure state — the single store owned by each `useForm` call.
 * Bundles the form value, the summary record, element references, field
 * state, the meta tracker, and the error stores under one keyed-by-
 * `(formKey, path)` instance so cross-form DOM state cannot collide.
 *
 * This is NOT a singleton. Each call to `useForm` creates its own FormStore
 * instance and holds onto it via closure. The registry provides SSR
 * hydration; otherwise the state is per-component-per-form.
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
  /**
   * Original Path captured at first registration. Stored alongside the
   * elements Set so the DOM-order sort cache can recover the structured
   * Path without round-tripping through `JSON.parse(pathKey)`.
   */
  readonly path: Path
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
   * Reactively-derived "No value supplied" errors. Pure function of
   * `(blankPaths, schema.isRequiredAtPath)` — no writers, no clears.
   * Membership tracks `blankPaths` automatically: typing a value into
   * a blank required numeric field removes the path from `blankPaths`
   * and the derived error vanishes; clearing the numeric input re-adds
   * the path and the error reappears. The `errors` proxy and
   * `getErrorsForPath` merge this map in alongside `schemaErrors` and
   * `userErrors`, so consumers see the "this required field is empty"
   * error the moment it's true — no `validate()` / `handleSubmit`
   * call required. Honors the founding principle that
   * `errors = f(schema, state)`.
   *
   * Most entries flow through this map for `number` / `bigint` leaves
   * (where the side-channel is needed to distinguish "user typed 0"
   * from "user supplied nothing"). String / boolean leaves only land
   * here when the consumer explicitly opted in via the `unset`
   * sentinel — see `docs/blank.md`.
   */
  readonly derivedBlankErrors: ComputedRef<ReadonlyMap<PathKey, ValidationError[]>>
  readonly originals: Map<PathKey, OriginalsRecord>
  /**
   * Reactive set of paths whose displayed state should be EMPTY even
   * though storage holds a real, schema-conformant value (the slim
   * default). It exists exclusively to record **storage / display
   * divergence** — the case where the runtime can't tell "user typed
   * 0" from "user supplied nothing" by looking at storage alone.
   *
   * The mechanism shines for `number` / `bigint`: storage holds the
   * slim default (`0` / `0n`) but the DOM input shows `''`, so the
   * directive's input listener marks the path here on clear. Strings
   * and booleans don't need it — `''` storage equals `''` display,
   * `false` storage equals unchecked display — so they're never
   * auto-marked. Consumers can still mark any primitive leaf
   * explicitly via the `unset` sentinel (`defaultValues: { x: unset }`,
   * `setValue('x', unset)`, `reset({ x: unset })`); the mark is then
   * a documented signal of consumer intent rather than runtime
   * inference.
   *
   * Reads (`displayValue` computed, `fields.<path>.blank`,
   * `derivedBlankErrors` computed) track via Vue 3.5's reactive Set
   * handlers. Writes happen inside `setValueAtPath` (gate-hook
   * bookkeeping: `blank: true` meta adds the path; any other write
   * removes it) and `reset`.
   *
   * Storage NEVER reflects this set — calculations and reads against
   * `form.value` see the slim default. The set is purely a UI/intent
   * channel that `derivedBlankErrors` consults to surface
   * "No value supplied" errors for required schemas.
   *
   * See `docs/blank.md` for the conceptual model.
   */
  readonly blankPaths: Set<PathKey>
  /**
   * Snapshot of `blankPaths` captured at construction (and
   * re-captured on `reset(args)`). Used by dirty calculation: a path
   * whose membership differs from the snapshot is dirty even if
   * storage matches the original. Eagerly populated to avoid a "dirty
   * on first read" race after construction.
   */
  readonly originalBlankPaths: Set<PathKey>
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
  /**
   * Replace the form value wholesale. Optional `meta` is forwarded to
   * every `onFormChange` listener so they can decide whether THIS write
   * is one they care about — most importantly, the persistence layer
   * only writes when `meta?.persist === true`. Internal callers that
   * don't pass meta default to no-persist.
   */
  applyFormReplacement(next: F, meta?: WriteMeta): void
  /**
   * Set a single path's value. `meta` is forwarded to listeners via
   * `applyFormReplacement` (see above). The directive's input handler
   * computes `meta.persist` from the per-element opt-in registry; other
   * internal call sites pass `meta.persist = hasAnyOptInForPath(path)`.
   * Public `form.setValue` passes no meta.
   *
   * Returns `false` when the slim-primitive gate rejects the write
   * (the value's primitive shape doesn't match the schema's slim
   * shape at the path). The store is unchanged in that case.
   */
  setValueAtPath(path: Path, value: unknown, meta?: WriteMeta): boolean
  getValueAtPath(path: Path): unknown

  // --- reset ---
  reset(nextDefaultValues?: DeepPartial<WriteShape<F>>): void
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

  // --- DOM ---
  /**
   * Register `element` as a binding for `path`, tagged with the calling
   * `useForm()` instance's `formInstanceId`. The ID is the disambiguator
   * used by `getFirstErrorElement` to scope focus / scroll to elements
   * THIS form instance owns — important when two `useForm()` calls share
   * a `key` (e.g. sidebar + main rendering the same form), since both
   * write into one shared element store.
   */
  registerElement(path: Path, element: HTMLElement, formInstanceId: string): boolean
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
   * element scoped to `formInstanceId` — the target that
   * `focusFirstError` / `scrollToFirstError` act on. "First" is
   * VISUAL-first (DOM-tree order via `compareDocumentPosition`), not
   * schema-declaration order, so a field rendered above another in the
   * template focuses first regardless of which one the schema declared
   * earlier. CSS `order:` flexbox/grid reordering is NOT respected
   * (DOM-tree order wins) — documented as a tradeoff against forcing
   * sync layout on every comparison.
   *
   * The `formInstanceId` filter scopes focus to elements registered
   * through THIS form instance. When two `useForm({ key })` calls share
   * a key, both register into the same element store; without the
   * filter, the sidebar form's submit could focus the main form's
   * input. With it, each `useForm()` callsite focuses only its own
   * elements.
   *
   * Returns `null` when every errored path has no currently-attached
   * element registered to this instance (fields behind `v-if="false"`,
   * unmounted components, or a hidden `display:none` parent). Callers
   * get the choice of no-op or a dev-only warning.
   */
  getFirstErrorElement(formInstanceId: string): { path: Path; element: HTMLElement } | null

  /**
   * Cancel every in-flight field-level validation run — clears timers
   * for debounced 'change' runs that haven't fired, aborts controllers
   * for runs whose async parse is in flight. Called by `handleSubmit`
   * at entry (submit validation is authoritative) and by `reset()`.
   */
  cancelFieldValidation(): void

  /**
   * Kick off (or schedule) a field-level validation run for `path`. Pass
   * `path = []` to cover the whole form; `applySchemaErrorsForSubtree`
   * then wipes every `schemaErrors` entry and replaces them with the
   * adapter's full async response. Used by persistence's post-hydration
   * revalidation and by the construction-time async-refine seed.
   *
   * `immediate: true` skips the debounce window — the runtime kicks off
   * the adapter call on the next microtask. Internal callsites use this
   * for one-shot triggers; the per-keystroke writers pass `false` to
   * coalesce rapid mutations under the configured debounceMs.
   */
  scheduleFieldValidation(path: Path, immediate: boolean): void

  /**
   * Subscribe to every `applyFormReplacement`. Fires synchronously
   * after `form.value` has been swapped to `next` and all field /
   * originals bookkeeping has run. Used by persistence + undo/redo
   * to hook the single mutation funnel. The optional `meta` carries
   * the originating call site's intent — the persistence subscription
   * filters on `meta?.persist === true`; subscribers that don't care
   * about meta can ignore the parameter. Returns an unsubscribe
   * function.
   */
  onFormChange(listener: (next: F, meta?: WriteMeta) => void): () => void

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
   * Register an async drain function. Called by the registry before
   * `dispose()` so async background work — chiefly the persistence
   * layer's debounced storage writes — has a chance to settle without
   * losing the last keystroke. Each registered function is awaited in
   * parallel; failures are swallowed to keep eviction reliable.
   */
  registerDrain(fn: () => Promise<void>): void

  /**
   * Drain async work registered via `registerDrain`. Resolves once
   * every registered drain has settled (in parallel). Safe to call
   * repeatedly — registered drains decide their own idempotency.
   */
  awaitPendingWrites(): Promise<void>

  /**
   * Cache for per-state modules (history, persistence) that must
   * outlive any single consumer. Subsequent `useForm` / `injectForm`
   * calls for the same key read from this map so the public API shape
   * is identical regardless of mount order. Keyed by a string identifier
   * owned by the caller (e.g. `'history'`).
   */
  readonly modules: Map<string, unknown>

  /**
   * Per-element persistence opt-in tracker. Empty by default; the
   * `v-register` directive populates entries on `mount` for each binding
   * that passed `register('foo', { persist: true })` and clears them on
   * `beforeUnmount`. Two SFCs sharing a key share this registry — opt-ins
   * are per-DOM-element, not per-component. Internal to the persistence
   * subsystem; not part of the consumer API surface.
   */
  readonly persistOptIns: PersistOptInRegistry

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
  /**
   * Schema-driven errors snapshot. Replayed into `schemaErrors` at
   * construction; takes precedence over the construction-time seed.
   */
  readonly schemaErrors: ReadonlyArray<readonly [string, unknown]>
  /**
   * User-injected errors snapshot. Replayed into `userErrors` at
   * construction. Allows server-side `setFieldErrors` /
   * `addFieldErrors` calls (typically fed from `parseApiErrors`) to
   * round-trip through hydration.
   */
  readonly userErrors: ReadonlyArray<readonly [string, unknown]>
  readonly fields: ReadonlyArray<readonly [string, unknown]>
  /**
   * Path keys that were in the form's `blankPaths` set at
   * SSR time. Replayed into the reactive Set on the client so the
   * "displayed empty" state survives the round-trip. Optional —
   * pre-v3 envelopes don't carry it; missing means "no transient-
   * empty paths".
   */
  readonly blankPaths?: ReadonlyArray<string>
}

export type CreateFormStoreOptions<F extends GenericForm, G extends GenericForm = F> = {
  readonly formKey: FormKey
  readonly schema: AbstractSchema<F, G>
  readonly defaultValues?: DeepPartial<WriteShape<F>> | undefined
  readonly validationMode?: ValidationMode | undefined
  readonly hydration?: FormStoreHydration | undefined
  readonly fieldValidation?: FieldValidationConfig | undefined
  readonly isSSR?: boolean | undefined
  /**
   * Path keys to seed the `blankPaths` set with at construction.
   * Only consulted when `hydration` is undefined — hydration data is
   * authoritative when present (its own `blankPaths` field
   * takes precedence). Used by `useAbstractForm`'s `unset`-symbol pre-
   * pass (commit 7 wires the producer); commit 2 plumbs the channel
   * through with no callers yet.
   */
  readonly initialBlankPaths?: ReadonlyArray<string> | undefined
  /**
   * Whether to remember per-variant typed state across discriminated-
   * union switches. Default `true`. See `UseFormConfiguration.rememberVariants`
   * for full semantics.
   */
  readonly rememberVariants?: boolean | undefined
}

/**
 * `true` when the JSON-encoded PathKey identifies a path strictly
 * nested under `parentPath` — i.e. shares every parent segment and
 * has at least one more. Used by the union-variant reshape to clear
 * blank-bookkeeping for paths that no longer exist in the new
 * variant's effective shape.
 */
function isPathKeyUnder(existingKey: PathKey, parentPath: Path): boolean {
  let parsed: Segment[]
  try {
    parsed = JSON.parse(existingKey) as Segment[]
  } catch {
    return false
  }
  if (parsed.length <= parentPath.length) return false
  for (let i = 0; i < parentPath.length; i++) {
    if (parsed[i] !== parentPath[i]) return false
  }
  return true
}

export function createFormStore<F extends GenericForm, G extends GenericForm = F>(
  options: CreateFormStoreOptions<F, G>
): FormStore<F, G> {
  const { formKey, schema, defaultValues, validationMode = 'strict', hydration } = options
  const isSSR = options.isSSR === true
  const rememberVariants: boolean = options.rememberVariants !== false
  const fieldValidationMode: FieldValidationMode = options.fieldValidation?.on ?? 'change'
  const fieldValidationDebounceMs: number =
    options.fieldValidation?.debounceMs ?? DEFAULT_FIELD_VALIDATION_DEBOUNCE_MS

  type FieldValidationEntry = {
    controller: AbortController
    timer: ReturnType<typeof setTimeout> | null
  }
  const fieldValidationState = new Map<PathKey, FieldValidationEntry>()

  // Plain Sets (not reactive) — these fire imperative callbacks; no
  // template should ever depend on "how many listeners are attached".
  const formChangeListeners = new Set<(next: F, meta?: WriteMeta) => void>()
  const submitSuccessListeners = new Set<() => void>()
  const resetListeners = new Set<() => void>()

  // Per-element persistence opt-ins. Constructed up-front so the
  // directive can populate entries before the persistence module wires
  // its subscription (mount order between the directive and
  // wirePersistence isn't guaranteed).
  const persistOptIns = createPersistOptInRegistry()

  // State-scoped teardown hooks. Persistence / history / any other
  // per-state module registers its disposer here so the cleanup is
  // bound to the FormStore's own lifetime (`dispose()` call at
  // registry-eviction) and not the first consumer's effect scope.
  const cleanupHooks: (() => void)[] = []
  const modules = new Map<string, unknown>()

  // Schema is ALWAYS consulted: we need the schema-derived originals even
  // when hydrating, so pristine/dirty computation survives SSR round-trip.
  // The form's actual starting value, though, prefers hydration data.
  //
  // Run consumer-supplied `defaultValues` through `mergeStructural` first
  // so partial constraints against tuple shapes (e.g. `coords: [42]` for
  // `z.tuple([_, _, _])`) get padded with position defaults BEFORE the
  // adapter's validate-then-fix loop sees them. Without this, the
  // adapter's wholesale-replace fix-up would lose the consumer's data.
  const completedConstraints =
    defaultValues === undefined
      ? undefined
      : (mergeStructural(schema, [], defaultValues) as DeepPartial<WriteShape<F>>)
  const schemaResponse: DefaultValuesResponse<F> = schema.getDefaultValues({
    useDefaultSchemaValues: true,
    constraints: completedConstraints,
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

  // Per-element form-instance tag. WeakMap so detached elements GC
  // freely — `deregisterElement` does an explicit `.delete()` defensively
  // (in case the element is still strongly referenced elsewhere), but
  // the WeakMap keeps cleanup correct even when the consumer drops the
  // element without going through deregister.
  //
  // Read by `getFirstErrorElement` to scope focus/scroll targets to the
  // calling `useForm()` instance — load-bearing when two forms share a
  // `key` and both register into the same `elements` Map.
  const elementToFormInstance = new WeakMap<HTMLElement, string>()

  // Lazy DOM-order sort cache. Holds every registered element flattened
  // across paths, sorted by `compareDocumentPosition` (DOM-tree order).
  // Invalidated to `null` on any register/deregister; rebuilt on next
  // `getFirstErrorElement` read. The cache amortises the sort across
  // multiple submit failures between mutations — a 100-field form with
  // 5 failed submits and no DOM changes pays one O(n log n) sort, not
  // five.
  //
  // Note: `compareDocumentPosition` is DOM-tree order, NOT visual order.
  // CSS `order:` flexbox/grid reorders visually but not in tree, so a
  // child with `order: -1` will sort AFTER its tree-earlier siblings.
  // Real visual order would need `getBoundingClientRect`, which forces
  // sync layout per comparison and breaks under `display: none`. Tree-
  // order is the right tradeoff for a hot path; the 99% case (semantic
  // source-order rendering) works correctly.
  let sortedRegistrationsCache: Array<{ path: Path; element: HTMLElement }> | null = null
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

  // Originals are captured at init and on first appearance of a path; never
  // re-assigned. Not reactive — the set is append-only per form's lifetime.
  // Value is a {segments, value} record so consumers iterating this Map
  // (isDirty, resetField's container loop) don't need to `JSON.parse(key)`
  // to recover the canonical Path.
  const originals = new Map<PathKey, OriginalsRecord>()

  // Blank bookkeeping. The reactive Set tracks paths whose
  // displayed state should be EMPTY even though storage holds a real
  // slim default; the originals snapshot mirrors construction-time
  // membership so dirty calculation can detect the user's clear /
  // un-clear actions. Hydration takes precedence over `initialBlankPaths`
  // (the SSR snapshot wins when present), matching how the hydrated
  // `form` value overrides the schema's getDefaultValues result.
  const initialTransientList: ReadonlyArray<string> =
    hydration?.blankPaths ?? options.initialBlankPaths ?? []
  const blankPaths = reactive(new Set<PathKey>()) as Set<PathKey>
  const originalBlankPaths = new Set<PathKey>()
  for (const raw of initialTransientList) {
    blankPaths.add(raw as PathKey)
    originalBlankPaths.add(raw as PathKey)
  }

  // Per-form variant memory. On a discriminated-union switch the
  // outgoing variant's subtree (deep-cloned) and its blank-path
  // bookkeeping are stashed here keyed by `(unionPath, oldDiscValue)`;
  // on switch-in the entry for the incoming discriminator is
  // restored. Memory is in-memory only (never persisted, never on
  // form.value), and is cleared on `reset()` / whole-form replace /
  // `resetField` of an ancestor of the union path. Disabled when
  // `rememberVariants === false`.
  type VariantSnapshot = {
    readonly value: unknown
    readonly blankPaths: ReadonlyArray<PathKey>
  }
  const variantMemory = new Map<PathKey, Map<unknown, VariantSnapshot>>()

  // Reactively-derived blank-required errors. Recomputes whenever
  // `blankPaths` mutates (Vue 3.5 reactive Set handlers track size + has).
  // The schema's `isRequiredAtPath` is referentially stable for a given
  // form (schema is fixed at construction), so it doesn't need to be a
  // dep — only the membership of `blankPaths` drives invalidation.
  const derivedBlankErrors = computed<ReadonlyMap<PathKey, ValidationError[]>>(() => {
    const result = new Map<PathKey, ValidationError[]>()
    if (blankPaths.size === 0) return result
    for (const pathKey of blankPaths) {
      const segments = JSON.parse(pathKey) as Segment[]
      if (!schema.isRequiredAtPath(segments)) continue
      result.set(pathKey, [
        {
          message: 'No value supplied',
          path: [...segments],
          formKey,
          code: CxErrorCode.NoValueSupplied,
        },
      ])
    }
    return result
  })

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
    // Hydration takes precedence over the construction-time seed
    // below: the server already authored whatever error state the
    // client should mirror, including (deliberately) the empty case.
    // Each store replays from its own snapshot so the source-segregation
    // invariant is preserved across SSR round-trip.
    for (const [rawKey, errs] of hydration.schemaErrors) {
      schemaErrors.set(rawKey as PathKey, errs as ValidationError[])
    }
    for (const [rawKey, errs] of hydration.userErrors) {
      userErrors.set(rawKey as PathKey, errs as ValidationError[])
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
    // No hydration — seed schemaErrors from the construction-time
    // validation result IF the schema rejected the defaults AND the
    // form was constructed in strict mode. Lax mode treats default
    // values as "best-effort," so populating errors there would
    // surprise consumers who explicitly opted out of strict checks.
    if (validationMode === 'strict' && !schemaResponse.success) {
      setAllSchemaErrors(schemaResponse.errors)
    }
    // Async refines can't fire from `getDefaultValues` — that contract
    // is sync (`safeParse` throws on async, the adapter degrades to
    // success). When the schema actually carries an async refine, ask
    // the adapter once and queue an immediate full-form async pass so
    // the construction-time refine errors land on the next microtask
    // instead of waiting for a user mutation. The check is gated to
    // strict mode and to schemas that genuinely contain an async
    // refine, so sync schemas (the common case) keep their fully-sync
    // construction-time error pipeline.
    if (validationMode === 'strict' && schema.hasAsyncRefines()) {
      scheduleFieldValidation([], true /* immediate */)
    }
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

  function applyFormReplacement(next: F, meta?: WriteMeta): void {
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
    // can't block the others. `meta` propagates the call-site's
    // intent (e.g. persist: true) to subscribers that filter on it.
    for (const listener of formChangeListeners) {
      try {
        listener(next, meta)
      } catch (err) {
        console.error('[@chemical-x/forms] onFormChange threw:', err)
      }
    }
  }

  function setValueAtPath(path: Path, value: unknown, meta?: WriteMeta): boolean {
    // Slim-primitive write gate: every leaf in the value must match
    // the schema's slim primitive set at its sub-path. Refinement-level
    // constraints (.email/.min/enum membership/etc.) are NOT enforced
    // here — they're a validation concern. See ./slim-primitive-gate.ts.
    if (!isSlimPrimitiveValid(schema, form, path, value)) {
      return false
    }

    // Discriminated-union variant transitions. Writing a discriminator
    // — whether as a leaf write to the discriminator key or as a
    // wholesale write of the union value carrying a different
    // discriminator — changes the schema's effective shape at the
    // union's location. Old-variant keys (e.g. `address` on the email
    // branch) become foreign once `channel: 'sms'` lands; new-variant
    // required keys need their slim defaults populated so the
    // errors-as-state pipeline sees the new shape. Two flavours, both
    // routed through `reshapeUnionVariant`:
    //
    //   Case A — leaf write to the discriminator key
    //   (`setValue('notify.channel', 'sms')`). Parent path is the
    //   union; the new value names a variant directly.
    //
    //   Case B — wholesale write of the union itself
    //   (`setValue('notify', { channel: 'sms', number: '...' })`).
    //   Path is the union; the consumer's value carries the
    //   discriminator. Layer the consumer's value on top of the
    //   matched variant default so consumer-supplied keys win.
    if (meta?.skipDiscriminatorReshape !== true) {
      // Case A: discriminator-key write.
      if (path.length > 0) {
        const last = path[path.length - 1]
        if (typeof last === 'string') {
          const parentPath = path.slice(0, -1)
          const parentDU = schema.getUnionDiscriminatorAtPath(parentPath)
          if (parentDU?.discriminatorKey === last) {
            const oldValue = getAtPath(form.value, path)
            if (!Object.is(oldValue, value)) {
              const variantDefault = parentDU.getVariantDefault(value)
              if (variantDefault !== undefined) {
                return reshapeUnionVariant(
                  parentPath,
                  oldValue,
                  value,
                  variantDefault,
                  undefined,
                  meta
                )
              }
            }
          }
        }
      }
      // Case B: whole-union write.
      if (isPlainRecord(value)) {
        const selfDU = schema.getUnionDiscriminatorAtPath(path)
        if (selfDU !== undefined) {
          const valueRecord = value as Record<string, unknown>
          const discValue = valueRecord[selfDU.discriminatorKey]
          if (discValue !== undefined) {
            const variantDefault = selfDU.getVariantDefault(discValue)
            if (variantDefault !== undefined && isPlainRecord(variantDefault)) {
              const currentUnionValue = getAtPath(form.value, path)
              const oldDiscValue = isPlainRecord(currentUnionValue)
                ? (currentUnionValue as Record<string, unknown>)[selfDU.discriminatorKey]
                : undefined
              return reshapeUnionVariant(
                path,
                oldDiscValue,
                discValue,
                variantDefault,
                valueRecord,
                meta
              )
            }
          }
        }
      }
    }

    // Blank bookkeeping. `blank: true` adds the path
    // to the set (the call site declares "this write represents an
    // empty intent"); any other write removes it (the user typed a
    // real value or programmatically reassigned). The mark/unmark sit
    // BEFORE the identity short-circuit so transitions that don't
    // change storage value (e.g. typing 0 over slim-default 0) still
    // update the visual / blank state correctly.
    const pathKey = canonicalizePath(path).key
    if (meta?.blank === true) {
      blankPaths.add(pathKey)
    } else if (blankPaths.has(pathKey)) {
      blankPaths.delete(pathKey)
    }

    // Structural-completeness invariant: every write must leave the
    // form satisfying the slim schema. Two ingress points to fill:
    //   1. The target value (consumer may have passed a partial; the
    //      schema's element default fills missing keys / array
    //      elements via mergeStructural).
    //   2. Intermediate gaps along the path (missing object property,
    //      array length below target index — setAtPathWithSchemaFill
    //      asks the schema for defaults at each gap site).
    // The common case (write to existing slot with a complete value)
    // hits no schema lookups: mergeStructural short-circuits on
    // ref-equal sub-trees, and the fill walker only queries the
    // schema at gap sites.
    const completedValue = mergeStructural(schema, path, value)
    // Identity short-circuit: if the path's current value already
    // matches what we'd write, skip the replacement. Without this,
    // every keystroke that produces an unchanged trimmed/cast value
    // (e.g. typing a trailing space into a `.trim` input — trim → ""
    // → form already at "") would still replace `form.value` with a
    // new object identity, triggering Vue to re-render the input and
    // patch the `:value` binding (which compares against the live
    // DOM `el.value`, not the previous vnode prop). The patch
    // overwrites the user's transient whitespace and the spacebar
    // appears broken.
    const currentValue = getAtPath(form.value, path)
    if (Object.is(currentValue, completedValue)) {
      return true
    }
    const nextForm = setAtPathWithSchemaFill(form.value, schema, path, completedValue) as F
    applyFormReplacement(nextForm, meta)
    if (fieldValidationMode === 'change') {
      scheduleFieldValidation(path, false /* debounced */)
    }
    return true
  }

  /**
   * Replace the union's parent storage with the activated variant's
   * value, atomically. Two flavours fold into one machine:
   *
   *   - `oldDiscValue !== newDiscValue` is a TRUE switch. The
   *     outgoing variant's subtree (deep-cloned) and its blank-path
   *     bookkeeping under `parentPath` snapshot into `variantMemory`
   *     keyed by the union's PathKey. Then memory is consulted for
   *     `newDiscValue`: a hit restores the prior typed state; a miss
   *     falls back to `variantDefault` (the adapter's slim default
   *     for the matching `z.object`).
   *   - `oldDiscValue === newDiscValue` is NOT a switch — the
   *     reshape was entered via Case B with a partial whole-union
   *     write. Skip memory I/O entirely (memory is for switches),
   *     just merge `consumerOverrides` on top of `variantDefault`.
   *
   * `consumerOverrides` carries Case B's whole-union value (e.g.
   * `setValue('notify', { channel: 'email', address: 'x' })`).
   * Merge order: memory baseline (or `variantDefault`) first,
   * consumer overrides on top — so a memory-restored `address`
   * survives a partial write that doesn't override it. Case A
   * passes `undefined` for `consumerOverrides`.
   *
   * Direct write — the resolved value IS structurally complete
   * (from the adapter's `deriveDefault` or a matching prior
   * snapshot). Routing through `mergeStructural` would re-add
   * foreign keys from the FIRST variant (the union's
   * `getDefaultAtPath` falls back to the first option), which is
   * exactly what the reshape is meant to clear.
   */
  function reshapeUnionVariant(
    parentPath: Path,
    oldDiscValue: unknown,
    newDiscValue: unknown,
    variantDefault: unknown,
    consumerOverrides: Record<string, unknown> | undefined,
    meta?: WriteMeta
  ): boolean {
    const sameDisc = Object.is(oldDiscValue, newDiscValue)
    const parentKey = canonicalizePath(parentPath).key

    // Snapshot OUTGOING. Deep-clone the value: `getAtPath(form.value,
    // parentPath)` returns a Vue reactive proxy into the live tree
    // (form is `ref(initialData)`); after the upcoming `form.value =
    // nextForm` overwrites the union path, the proxy still points to
    // the orphaned raw target. JSON-cycle through the proxy reads to
    // produce a plain-object copy detached from reactivity — form
    // values are JSON-serializable by construction (slim primitive
    // write gate enforces this). `structuredClone` does NOT work
    // here: it rejects Vue's Proxy with `DataCloneError`. Skip when
    // `oldDiscValue` is undefined (initial state had no
    // discriminator) — nothing meaningful to remember.
    let baseline: unknown = variantDefault
    let restoredBlanks: PathKey[] | undefined
    if (rememberVariants && !sameDisc) {
      if (oldDiscValue !== undefined) {
        const currentValue: unknown = JSON.parse(JSON.stringify(getAtPath(form.value, parentPath)))
        const outgoingBlanks: PathKey[] = []
        for (const k of blankPaths) {
          if (isPathKeyUnder(k, parentPath)) outgoingBlanks.push(k)
        }
        let memoryForUnion = variantMemory.get(parentKey)
        if (memoryForUnion === undefined) {
          memoryForUnion = new Map<unknown, VariantSnapshot>()
          variantMemory.set(parentKey, memoryForUnion)
        }
        memoryForUnion.set(oldDiscValue, {
          value: currentValue,
          blankPaths: outgoingBlanks,
        })
      }
      // Look up INCOMING. Stored value is already a deep clone — safe
      // to use directly without re-cloning.
      const memoryForUnion = variantMemory.get(parentKey)
      const restored = memoryForUnion?.get(newDiscValue)
      if (restored !== undefined) {
        baseline = restored.value
        restoredBlanks = [...restored.blankPaths]
      }
    }

    // Layer consumer overrides on top of the baseline (Case B).
    // For Case A (`consumerOverrides === undefined`), the baseline
    // is the final value.
    const finalValue: unknown =
      consumerOverrides !== undefined
        ? { ...(baseline as Record<string, unknown>), ...consumerOverrides }
        : baseline

    // Drop blank-path bookkeeping under `parentPath` — those paths
    // belong to the OLD variant's leaves and don't exist in the new
    // effective shape.
    for (const existingKey of [...blankPaths]) {
      if (isPathKeyUnder(existingKey, parentPath)) {
        blankPaths.delete(existingKey)
      }
    }
    // New blanks: restored from memory (preserves the user's prior
    // explicit blanks + numeric auto-marks together) or recomputed
    // from the resolved `finalValue` (mount-time rule: storage /
    // display divergence for `number` / `bigint` numeric leaves).
    let newBlankPaths: PathKey[]
    if (restoredBlanks !== undefined) {
      newBlankPaths = restoredBlanks
    } else {
      newBlankPaths = []
      walkUnspecified(finalValue, [...parentPath], newBlankPaths)
    }

    const currentValue = getAtPath(form.value, parentPath)
    if (Object.is(currentValue, finalValue)) {
      // Apply the auto-marks even on no-op (the bookkeeping must
      // catch up even when storage identity matches by coincidence).
      for (const k of newBlankPaths) blankPaths.add(k)
      return true
    }
    const nextForm =
      parentPath.length === 0
        ? (finalValue as F)
        : (setAtPath(form.value, parentPath, finalValue) as F)
    // Sync-validate AHEAD of the form mutation when the schema
    // permits it. Both writes (schemaErrors + form.value) then land
    // in the same Vue reactive batch, so a single render emits the
    // fully-consistent post-reshape state. Without this, the render
    // queued by `applyFormReplacement` runs BEFORE the async
    // validation lands — the active-path filter hides the OLD
    // variant's schemaErrors (their leaves vanished from form.value)
    // and the NEW variant's haven't been written yet, producing a
    // visible `{}` flicker between the two meaningful states.
    //
    // We pass `{ sync: true }` to opt into the adapter's sync arm.
    // The adapter MAY still return a Promise (async refinements,
    // async transforms / pipes — schemas where sync isn't possible);
    // we detect that with `instanceof Promise` and fall through to
    // the existing debounced async pipeline in that case.
    let appliedSync = false
    if (fieldValidationMode === 'change') {
      const syncOrPromise = schema.validateAtPath(finalValue, parentPath, { sync: true })
      if (!(syncOrPromise instanceof Promise)) {
        const reStamped = syncOrPromise.success
          ? []
          : syncOrPromise.errors.map((err) => ({
              ...err,
              path: [...parentPath, ...(err.path as Segment[])],
            }))
        applySchemaErrorsForSubtree(parentPath, reStamped)
        // Cancel any in-flight async validation at this path so a
        // late-arriving result can't clobber the sync write.
        const { key: parentKey } = canonicalizePath(parentPath)
        const prevValidation = fieldValidationState.get(parentKey)
        if (prevValidation !== undefined) {
          if (prevValidation.timer !== null) clearTimeout(prevValidation.timer)
          prevValidation.controller.abort()
          fieldValidationState.delete(parentKey)
        }
        appliedSync = true
      }
    }
    applyFormReplacement(nextForm, meta)
    for (const k of newBlankPaths) blankPaths.add(k)
    if (fieldValidationMode === 'change' && !appliedSync) {
      scheduleFieldValidation(parentPath, false /* debounced */)
    }
    return true
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
          // with the absolute field path so the schemaErrors store and
          // `form.errors.<dotted path>` reads agree on the canonical
          // key.
          const reStamped = response.success
            ? []
            : response.errors.map((err) => ({
                ...err,
                path: [...path, ...(err.path as Segment[])],
              }))
          // Apply at the LEAF level: when the scheduled path is a
          // container (e.g. `['notify']` after a DU reshape), the
          // adapter returns multiple issues at distinct leaf paths.
          // Storing them all under the scheduled key would (a) hide
          // them from the canonical-key lookup `form.errors.notify.X`
          // and (b) survive across variant switches as ghost entries
          // because `setSchemaErrorsForPath(parent, [])` only clears
          // the parent's own key, not the descendants written by a
          // previous run.
          applySchemaErrorsForSubtree(path, reStamped)
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

  function onFormChange(listener: (next: F, meta?: WriteMeta) => void): () => void {
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

  const drainHooks: (() => Promise<void>)[] = []

  function registerDrain(fn: () => Promise<void>): void {
    drainHooks.push(fn)
  }

  async function awaitPendingWrites(): Promise<void> {
    if (drainHooks.length === 0) return
    // Run drains in parallel — each owns its own retry / failure
    // semantics; we just need to know when all have settled.
    await Promise.allSettled(drainHooks.map((fn) => fn()))
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
    drainHooks.length = 0
    modules.clear()
    cancelFieldValidation()
    formChangeListeners.clear()
    submitSuccessListeners.clear()
    resetListeners.clear()
    // Drop opt-ins so a directive that survives FormStore eviction
    // (it shouldn't, but defensive) doesn't keep the registry alive
    // through stale path entries on a disposed store.
    persistOptIns.clear()
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

  /**
   * Replace the schemaErrors subtree rooted at `path` with `entries`,
   * keying each entry by its OWN absolute path rather than `path`.
   * Used by `scheduleFieldValidation` so a re-validation of a
   * container (e.g. a DU parent after reshape) lands every leaf-keyed
   * issue at its canonical store key — `form.errors.<path>` reads
   * hit, and stale entries from a previous variant don't survive.
   *
   * The clear sweep removes the scheduled path itself AND every
   * strict descendant currently in the store. Without the sweep, an
   * email-variant `notify.address` entry would persist after switching
   * to sms (the new run only writes `notify.number`), letting a
   * ghost error leak through `form.meta.errors`.
   *
   * Skipped optimisation: re-using existing arrays when the leaf-key
   * group is identical to the current entry. We always write a fresh
   * array so Vue's reactive Map.set fires every consumer; profile
   * before adding equality short-circuits — most validations land at
   * leaves where the array is one-deep, so the savings are marginal.
   */
  function applySchemaErrorsForSubtree(path: Path, entries: ValidationError[]): void {
    const { key: parentKey } = canonicalizePath(path)
    schemaErrors.delete(parentKey)
    for (const existingKey of [...schemaErrors.keys()]) {
      if (isPathKeyUnder(existingKey, path)) schemaErrors.delete(existingKey)
    }
    if (entries.length === 0) return
    // Group by each error's own canonical leaf path. Multiple issues
    // at the same path (e.g. two refinements failing the same leaf)
    // merge into one array — preserves adapter ordering.
    const grouped = new Map<PathKey, ValidationError[]>()
    for (const err of entries) {
      const { key } = canonicalizePath(err.path as Path)
      const list = grouped.get(key)
      if (list === undefined) grouped.set(key, [err])
      else list.push(err)
    }
    for (const [leafKey, group] of grouped) {
      schemaErrors.set(leafKey, group)
    }
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
    const schemaForKey = schemaErrors.get(key)
    const userForKey = userErrors.get(key)
    const blankForKey = derivedBlankErrors.value.get(key)
    if (schemaForKey === undefined && userForKey === undefined && blankForKey === undefined) {
      return []
    }
    const result: ValidationError[] = []
    if (schemaForKey !== undefined) result.push(...schemaForKey)
    if (blankForKey !== undefined) result.push(...blankForKey)
    if (userForKey !== undefined) result.push(...userForKey)
    return result
  }

  // --- DOM ---

  function registerElement(path: Path, element: HTMLElement, formInstanceId: string): boolean {
    const { key } = canonicalizePath(path)
    const record = elements.get(key)
    if (record === undefined) {
      elements.set(key, { path, elements: new Set([element]) })
    } else {
      if (record.elements.has(element)) return false
      record.elements.add(element)
    }
    elementToFormInstance.set(element, formInstanceId)
    sortedRegistrationsCache = null
    touchFieldRecord(key, path, { isConnected: true })
    return true
  }

  function deregisterElement(path: Path, element: HTMLElement): number {
    const { key } = canonicalizePath(path)
    const record = elements.get(key)
    if (record === undefined) return 0
    const removed = record.elements.delete(element)
    if (removed) {
      elementToFormInstance.delete(element)
      sortedRegistrationsCache = null
    }
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
      // `touched` flips to true on blur and stays true thereafter; while
      // a field is currently focused we keep whatever value it held.
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

  function reset(nextDefaultValues?: DeepPartial<WriteShape<F>>): void {
    // Fall back to construction-time `defaultValues` when the caller
    // doesn't provide a fresh override. Otherwise `reset()` produces
    // schema-only defaults — losing the consumer's initial state from
    // `useForm({ defaultValues: ... })`. The structural-completeness
    // invariant covers post-write correctness; preserving construction
    // defaults across reset is a separate semantic the consumer expects.
    const next = schema.getDefaultValues({
      useDefaultSchemaValues: true,
      constraints: nextDefaultValues ?? defaultValues,
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
    // Blank: with `nextDefaultValues` provided, both sets
    // adopt the new baseline (commit 7 plugs the `unset`-symbol walker
    // into this branch — for now the new defaults can't carry unset
    // symbols at the type level, so the post-reset baseline is empty).
    // With no args, restore `blankPaths` from the snapshot so
    // construction-time membership returns; originalBlankPaths is
    // preserved (the snapshot encodes the consumer's last declared
    // baseline, which `reset()` should honour).
    if (nextDefaultValues !== undefined) {
      blankPaths.clear()
      originalBlankPaths.clear()
    } else {
      blankPaths.clear()
      for (const key of originalBlankPaths) {
        blankPaths.add(key)
      }
    }
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
    // Variant memory is UX state — a fresh start drops the per-variant
    // typed-data cache too. Without this, a post-reset switch would
    // surface stale variant values from before the reset.
    variantMemory.clear()
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

    // Variant memory: drop any union memory whose path equals or sits
    // under `targetSegments`. Memory under the reset subtree is
    // semantically "user's prior typed state at a discriminator that
    // no longer corresponds to anything live"; preserving it would
    // surface stale variants on a future switch. Memory ABOVE the
    // reset subtree (e.g. union at ['notify'] for resetField('notify.address'))
    // is intentionally preserved — the snapshot self-corrects on the
    // next switch-out.
    for (const memKey of [...variantMemory.keys()]) {
      let memSegments: Segment[]
      try {
        memSegments = JSON.parse(memKey) as Segment[]
      } catch {
        continue
      }
      if (isPathPrefix(targetSegments, memSegments)) {
        variantMemory.delete(memKey)
      }
    }

    // Leaf shortcut: direct originals hit means one setValueAtPath does it.
    const leafEntry = originals.get(targetKey)
    if (leafEntry !== undefined) {
      const wrote = setValueAtPath(targetSegments, leafEntry.value)
      if (!wrote) {
        // Originals come from the construction-time pipeline, which
        // guarantees primitive-correctness. A rejected reset write
        // signals an invariant violation upstream.
        console.error(
          `[@chemical-x/forms] resetField: leaf write rejected for path '${targetKey}' — ` +
            `originals contain a value that doesn't satisfy the slim primitive shape. ` +
            `This is a bug in the construction pipeline.`
        )
      }
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

    const wroteSubtree = setValueAtPath(targetSegments, subtree)
    if (!wroteSubtree) {
      console.error(
        `[@chemical-x/forms] resetField: subtree write rejected at path '${targetKey}' — ` +
          `originals contain values that don't satisfy the slim primitive shape. ` +
          `This is a bug in the construction pipeline.`
      )
    }

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
    // Storage match is necessary but not sufficient: a primitive leaf
    // toggled between "displayed empty" (blank + slim default)
    // and "explicitly the slim default" carries the same storage value
    // but differs visually. Compare both surfaces against the originals
    // snapshot so the blank contract dirties when membership
    // diverges.
    if (blankPaths.has(key) !== originalBlankPaths.has(key)) return false
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

  function getFirstErrorElement(
    formInstanceId: string
  ): { path: Path; element: HTMLElement } | null {
    // Single-pass DOM-order walk over every registered element. The
    // sort cache is rebuilt lazily on the first read after a register/
    // deregister; subsequent calls amortise to O(n) until the next
    // mutation.
    sortedRegistrationsCache ??= rebuildSortedRegistrations()

    for (const entry of sortedRegistrationsCache) {
      // Scope to this form instance — when two `useForm()` calls share
      // a key, both write into `elements`; this filter keeps each
      // form's submit from focusing the other's input.
      if (elementToFormInstance.get(entry.element) !== formInstanceId) continue

      // `el.isConnected` covers "component was unmounted, element
      // removed from DOM" cases that lag the FieldRecord.isConnected
      // flag. `el.offsetParent === null` catches `display:none` and
      // its ancestor chain — the browser won't focus or scroll to a
      // hidden element anyway, so we keep walking.
      if (!entry.element.isConnected) continue
      if (entry.element.offsetParent === null) continue

      const { key } = canonicalizePath(entry.path)
      const hasSchemaErr = (schemaErrors.get(key)?.length ?? 0) > 0
      const hasUserErr = (userErrors.get(key)?.length ?? 0) > 0
      if (!hasSchemaErr && !hasUserErr) continue

      return { path: entry.path, element: entry.element }
    }
    return null
  }

  function rebuildSortedRegistrations(): Array<{ path: Path; element: HTMLElement }> {
    const flat: Array<{ path: Path; element: HTMLElement }> = []
    for (const [, record] of elements) {
      for (const el of record.elements) flat.push({ path: record.path, element: el })
    }
    // `compareDocumentPosition` returns a bitmask. The
    // `DOCUMENT_POSITION_FOLLOWING` bit (0x04) is set when the argument
    // node FOLLOWS the receiver in document order, which means the
    // receiver comes first → return -1 to keep `a` before `b`.
    flat.sort((a, b) =>
      a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    )
    return flat
  }

  return {
    formKey,
    form,
    fields,
    elements,
    schemaErrors,
    userErrors,
    derivedBlankErrors,
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
    scheduleFieldValidation,
    onFormChange,
    onSubmitSuccess,
    onReset,
    emitSubmitSuccess,
    registerCleanup,
    registerDrain,
    awaitPendingWrites,
    modules,
    persistOptIns,
    blankPaths,
    originalBlankPaths,
    dispose,
  }
}

export type { Path, PathKey, Segment }
