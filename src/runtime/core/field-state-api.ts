import { computed, type ComputedRef } from 'vue'
import type { FieldState, FormMeta, ShouldShowErrors, ValidationError } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { EMPTY_RESOLVED_FIELD_META } from './field-meta'
import { humanize } from './humanize'
import { getAtPath, hasAtPath } from './path-walker'
import {
  canonicalizePath,
  FORM_ERRORS_PATH_KEY,
  isPathPrefix,
  segmentsForPathKey,
  type Path,
  type PathKey,
} from './paths'

function isUnderStubAncestor<F extends GenericForm>(state: FormStore<F>, segments: Path): boolean {
  for (let i = 0; i < segments.length; i++) {
    const ancestorPath = segments.slice(0, i)
    const du = state.schema.getUnionDiscriminatorAtPath(ancestorPath)
    if (du === undefined) continue
    const ancestorValue = getAtPath(state.form.value, ancestorPath)
    if (ancestorValue === null || typeof ancestorValue !== 'object') continue
    const discValue = (ancestorValue as Record<string, unknown>)[du.discriminatorKey]
    if (discValue === undefined) return true
    if (!du.isVariantSelected(discValue)) return true
  }
  return false
}

/**
 * Reactive field-state accessor. Combines per-field records, DOM
 * focus/blur state, validation errors, and adapter-resolved metadata
 * into a single `FieldState` object suitable for templates:
 *
 *   const emailState = getFieldState('email')
 *   emailState.value.dirty, .errors, .focused, .label, ...
 *
 * All reads go through Vue computeds so consumers get fine-grained
 * reactivity — a change to one field's focus does not invalidate
 * computeds watching another field.
 *
 * The accessor returns one shape — `FieldState<unknown>` — at every
 * path. At leaf paths, fields read from per-leaf primitives. At
 * container paths, the same fields aggregate over descendant leaves
 * (disjunction for event-presence: dirty/focused/touched/validating;
 * conjunction for absence/uniformity: pristine/valid/blank). DU
 * containers traverse only the active variant via `hasAtPath` on
 * the live form value.
 *
 * Memoised per canonical path key — repeated calls with the same
 * path return the same `ComputedRef` so consumers don't accumulate
 * duplicate Vue subscriptions.
 */
export type { FieldState }

/**
 * Internal shape of a field's reactive state minus the two derived
 * predicate-fed properties (`showErrors`, `firstError`). The
 * predicate `state.shouldShowErrors(field, formMeta)` is invoked
 * with this exact shape on the field side: the keys literally are
 * not present, so a vanilla-JS adopter (or `as`-cast caller) cannot
 * read `field.showErrors` from inside their predicate and form a
 * cycle. Pair with `FormMetaBase` for the matching guard on the
 * form-level argument.
 */
export type FieldStateBase = Omit<FieldState<unknown>, 'showErrors' | 'firstError'>

/**
 * Internal shape of the form's reactive meta minus the two derived
 * predicate-fed properties. Same defense-in-depth role as
 * `FieldStateBase` for the second predicate argument. Built in
 * `build-form-api.ts` once per form (where the history options are
 * in scope) and threaded through to the field-state computeds via
 * the `getFormMetaBase` thunk.
 */
export type FormMetaBase = Omit<FormMeta<unknown>, 'showErrors' | 'firstError'>

/**
 * Thunk shape passed to `buildFieldStateAccessor`. Each call to the
 * accessor's returned `computed` invokes this thunk to materialise
 * a fresh `FormMetaBase` snapshot — Vue's reactivity tracks every
 * `Ref.value` read inside, so the field-state computed re-evaluates
 * when (e.g.) `submitCount` changes. Stateless function, not a Ref:
 * we never need to swap predicates at runtime, and a plain function
 * keeps the dependency graph shallow.
 */
export type FormMetaBaseGetter = () => FormMetaBase

export function buildFieldStateAccessor<F extends GenericForm>(
  state: FormStore<F>,
  getFormMetaBase: FormMetaBaseGetter,
  options?: { readonly shouldShowErrors?: ShouldShowErrors }
) {
  // Per-path memoisation so `getFieldStateAt(p)` returns the same
  // `ComputedRef` reference on repeated reads with the same canonical
  // path. The Map's lifetime equals the form-store's; cleared
  // implicitly when the store is GC'd.
  const cache = new Map<PathKey, ComputedRef<FieldState<unknown>>>()
  const predicate = options?.shouldShowErrors

  return function getFieldState(pathInput: string | Path): ComputedRef<FieldState<unknown>> {
    const { segments, key } = canonicalizePath(pathInput)
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const c = computed<FieldState<unknown>>(() =>
      state.schema.isLeafAtPath(segments)
        ? buildLeafFieldState(state, segments, key, getFormMetaBase, predicate)
        : buildContainerFieldState(state, segments, key, getFormMetaBase, predicate)
    )
    cache.set(key, c)
    return c
  }
}

/**
 * Per-leaf computation of the predicate-safe base shape. Reads the
 * leaf-specific reactive sources only; does NOT compute
 * `showErrors` / `firstError` (those are layered on by
 * `buildLeafFieldState`).
 */
function buildLeafFieldStateBase<F extends GenericForm>(
  state: FormStore<F>,
  segments: Path,
  key: PathKey
): FieldStateBase {
  const record = state.fields.get(key)
  const value = state.getValueAtPath(segments)
  const original = state.originals.get(key)?.value
  const pristine = state.isPristineAtPath(segments)
  const schemaForKey = state.schemaErrors.get(key)
  const blankForKey = state.derivedBlankErrors.value.get(key)
  const userForKey = state.userErrors.get(key)
  const errors: ValidationError[] = []
  if (schemaForKey !== undefined) errors.push(...schemaForKey)
  if (blankForKey !== undefined) errors.push(...blankForKey)
  if (userForKey !== undefined) errors.push(...userForKey)
  const validating = (state.fieldValidationCounts.get(key) ?? 0) > 0
  // `valid` mirrors `meta.valid` per-path: when the sub-schema at
  // this path declares async work, gate the answer on the form-wide
  // `firstValidationDone` so the surface doesn't lie about a
  // yet-to-arrive verdict. Sync-only sub-schemas (e.g. a bare
  // `z.string()` leaf) skip the gate — there's nothing to wait on,
  // and clamping every such field to `false` at mount would defeat
  // the green-checkmark UX pattern that `field.valid` is built for.
  const gated = state.pathHasAsyncValidation(segments) && !state.firstValidationDone.value
  // Stub-state orphan gate: when a leaf is structurally absent from
  // `form.value` AND any DU ancestor is in stub state (its disc value
  // isn't a known variant), the surface MUST NOT report `valid: true`.
  // The parent is broken; pretending the descendant is fine hides
  // it from error-summary UIs. Inactive-variant siblings under a
  // VALID disc are a different case — they read as stable stubs
  // (`valid: true`, errors: []) so unconditional template bindings
  // keep working across variants.
  const isOrphan =
    segments.length > 0 &&
    !hasAtPath(state.form.value, segments) &&
    isUnderStubAncestor(state, segments)
  const valid = !gated && errors.length === 0 && !validating && !isOrphan
  const elementRecord = state.elements.get(key)
  const elementsArr: readonly HTMLElement[] = elementRecord
    ? Object.freeze([...elementRecord.elements])
    : EMPTY_ELEMENTS
  const firstElement: HTMLElement | null = elementsArr[0] ?? null
  const resolved = state.schema.getFieldMetaAtPath
    ? state.schema.getFieldMetaAtPath(segments)
    : EMPTY_RESOLVED_FIELD_META
  const lastSegment = segments.length === 0 ? '' : (segments[segments.length - 1] ?? '')
  const label = resolved.label || humanize(lastSegment)
  return {
    value,
    original,
    pristine,
    dirty: !pristine,
    focused: record?.focused ?? null,
    blurred: record?.blurred ?? null,
    touched: record?.touched ?? null,
    connected: record?.connected ?? false,
    element: firstElement,
    elements: elementsArr,
    updatedAt: record?.updatedAt ?? null,
    errors,
    validating,
    valid,
    path: segments,
    blank: state.blankPaths.has(key),
    label,
    description: resolved.description,
    placeholder: resolved.placeholder,
    meta: resolved.meta,
  }
}

/**
 * Per-leaf full computation: builds the base, then layers on
 * `showErrors` / `firstError` via `state.shouldShowErrors`. The
 * base object passed to the predicate has NO `showErrors` /
 * `firstError` keys at runtime (it's the literal `FieldStateBase`
 * we just constructed) — recursion is impossible regardless of TS
 * vs vanilla-JS.
 */
function buildLeafFieldState<F extends GenericForm>(
  state: FormStore<F>,
  segments: Path,
  key: PathKey,
  getFormMetaBase: FormMetaBaseGetter,
  shouldShowErrors?: ShouldShowErrors
): FieldState<unknown> {
  const base = buildLeafFieldStateBase(state, segments, key)
  return decorateWithDerivedProps(base, state, getFormMetaBase, shouldShowErrors)
}

/**
 * Per-container aggregation for the predicate-safe base shape.
 * Rolls up descendant-leaf state per the rule sheet; does NOT
 * compute `showErrors` / `firstError`.
 *
 * Aggregation rules (matches `docs/api/use-form-return.md`):
 *   - pristine / valid / blank: conjunction (all descendants)
 *   - dirty: !pristine
 *   - focused / blurred / touched / connected / validating: disjunction (any descendant)
 *   - errors: concat + sort by `pathOrdinal` (schema-declaration order)
 *   - updatedAt: max ISO timestamp (lex-compared) over descendants
 *   - value / original: live subtree at the path
 *   - element / elements: nothing bound at containers — null / empty
 *   - label / description / placeholder / meta: from `getFieldMetaAtPath`
 *
 * Exported so `build-form-api.ts` can build a `FormMetaBase` (the
 * predicate's second arg) without going through the cached
 * field-state accessor — that route would recurse through the
 * root path's own `showErrors` computation.
 */
export function buildContainerFieldStateBase<F extends GenericForm>(
  state: FormStore<F>,
  segments: Path,
  _key: PathKey
): FieldStateBase {
  // Read live form value first so the access participates in dep
  // tracking; the discriminator key write that switches a DU variant
  // shows up here and re-runs the computed.
  const formValue = state.form.value
  const value = state.getValueAtPath(segments)
  const original = state.originals.get(canonicalizePath(segments).key)?.value
  // Enumerate active descendant leaves under the container path.
  // The `originals` Map tracks every leaf the form has ever seen;
  // filter via `isPathPrefix` for descendant-membership and via
  // `hasAtPath(formValue, leafSeg)` to keep only the active-variant
  // leaves (DU switches reshape `formValue` wholesale, so this is
  // the live ground truth).
  let pristine = true
  let blank = true
  let dirty = false
  let focused = false
  let blurred = false
  let touched = false
  let connected = false
  let validating = false
  let updatedAt: string | null = null
  let asyncPending = false
  for (const [, entry] of state.originals) {
    if (!isPathPrefix(segments, entry.segments)) continue
    if (segments.length === entry.segments.length) continue // self isn't a descendant
    if (!hasAtPath(formValue, entry.segments)) continue
    const leafKey = canonicalizePath(entry.segments).key
    const leafRecord = state.fields.get(leafKey)
    if (!state.isPristineAtPath(entry.segments)) {
      pristine = false
      dirty = true
    }
    if (!state.blankPaths.has(leafKey)) blank = false
    if (leafRecord?.focused === true) focused = true
    if (leafRecord?.blurred === true) blurred = true
    if (leafRecord?.touched === true) touched = true
    if (leafRecord?.connected === true) connected = true
    if ((state.fieldValidationCounts.get(leafKey) ?? 0) > 0) validating = true
    if (state.pathHasAsyncValidation(entry.segments)) asyncPending = true
    const ts = leafRecord?.updatedAt
    if (ts !== undefined && ts !== null) {
      // ISO 8601 timestamps sort lexicographically; max-string is
      // the most-recent write.
      if (updatedAt === null || ts > updatedAt) updatedAt = ts
    }
  }
  // Aggregate errors at this prefix. Drives `form.fields(p).errors`,
  // `form.errors(p)`, and `form.meta.errors` through one helper so
  // the three surfaces read identically. Active-variant filter
  // applied via the same `hasAtPath` gate the descendant walk used.
  // `valid` derives from this single source so the two fields can
  // never disagree.
  const errors = aggregateErrorsAt(state, segments)
  // A container's own sub-schema can also declare async work — a
  // top-level `.refine(async ...)` on the root, or a cross-field
  // refine on a sub-object — and those don't show up in any per-
  // leaf `pathHasAsyncValidation` reading. Check the container's
  // OWN path too, so the firstValidationDone gate fires until that
  // pass lands.
  if (!asyncPending && state.pathHasAsyncValidation(segments)) asyncPending = true
  const gated = asyncPending && !state.firstValidationDone.value
  const valid = !gated && errors.length === 0 && !validating
  const resolved = state.schema.getFieldMetaAtPath
    ? state.schema.getFieldMetaAtPath(segments)
    : EMPTY_RESOLVED_FIELD_META
  const lastSegment = segments.length === 0 ? '' : (segments[segments.length - 1] ?? '')
  const label = resolved.label || humanize(lastSegment)
  return {
    value,
    original,
    pristine,
    dirty,
    focused,
    blurred,
    touched,
    connected,
    element: null,
    elements: EMPTY_ELEMENTS,
    updatedAt,
    errors,
    validating,
    valid,
    path: segments,
    blank,
    label,
    description: resolved.description,
    placeholder: resolved.placeholder,
    meta: resolved.meta,
  }
}

/**
 * Per-container full computation: builds the base, layers on the
 * derived predicate-fed props.
 */
function buildContainerFieldState<F extends GenericForm>(
  state: FormStore<F>,
  segments: Path,
  key: PathKey,
  getFormMetaBase: FormMetaBaseGetter,
  shouldShowErrors?: ShouldShowErrors
): FieldState<unknown> {
  const base = buildContainerFieldStateBase(state, segments, key)
  return decorateWithDerivedProps(base, state, getFormMetaBase, shouldShowErrors)
}

/**
 * Layer `showErrors` + `firstError` onto a freshly-computed base.
 * Shared by leaf and container paths so the gate runs identically
 * at every depth.
 *
 * `firstError` is `errors[0]` — deterministic because errors are
 * already sorted by schema-declaration order (within a leaf: schema
 * → blank → user concat; across a container: `pathOrdinal` bucket
 * sort).
 *
 * `showErrors` short-circuits when there are no errors, so the
 * predicate only fires when the heuristic actually has something to
 * decide.
 */
function decorateWithDerivedProps<F extends GenericForm>(
  base: FieldStateBase,
  state: FormStore<F>,
  getFormMetaBase: FormMetaBaseGetter,
  shouldShowErrors?: ShouldShowErrors
): FieldState<unknown> {
  const firstError = base.errors[0]
  const predicate = shouldShowErrors ?? state.shouldShowErrors
  const showErrors = base.errors.length > 0 && predicate(base, getFormMetaBase())
  return { ...base, showErrors, firstError }
}

/**
 * Walk the merged error stores at every leaf descendant of `prefix`,
 * filter inactive variants via `hasAtPath`, and return the
 * concatenated errors sorted by schema-declaration order
 * (`pathOrdinals` — same ordering metaErrors uses today).
 *
 * Shared by container `errors` aggregation here and by the top-level
 * `metaErrors` / `form.errors(path)` aggregation in `build-form-api.ts`
 * — one helper, three call sites, no drift.
 */
export function aggregateErrorsAt<F extends GenericForm>(
  state: FormStore<F>,
  prefix: Path
): ValidationError[] {
  const formValue = state.form.value
  const buckets = new Map<number, ValidationError[]>()
  const collect = (errs: ReadonlyMap<PathKey, ValidationError[]>): void => {
    for (const [pathKey, list] of errs) {
      if (list.length === 0) continue
      // Resolve the path's segments via the canonical PathKey ↔
      // Segment[] inverse cache (`segmentsForPathKey`). Covers
      // every shape the error stores can hold — leaf paths,
      // container paths (cross-field refines), and the form-level
      // `[]` key — without depending on `originals` (which only
      // tracks leaves).
      const segs = segmentsForPathKey(pathKey)
      if (segs === null) continue
      if (!isPathPrefix(prefix, segs)) continue
      // Skip inactive variants. Form-level errors are always retained
      // — they're not variant-bound. Two flavours qualify:
      //   - the empty path `[]` (kept for parity with any legacy
      //     entries / cross-adapter paths);
      //   - the empty-string bucket `['']`, which is the conventional
      //     home for root `.refine()` errors and `setFormErrors()`
      //     entries.
      // Container-level errors (cross-field refines on a container
      // path) are filtered when their CONTAINER path is reachable;
      // the refine pinned the error at the container, not at any
      // particular leaf.
      if (pathKey === FORM_ERRORS_PATH_KEY) {
        // Always retain — form-level bucket.
      } else if (segs.length > 0 && !hasAtPath(formValue, segs)) continue
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
}

// Frozen empty array shared across "no elements bound" reads so
// consumers can `===`-compare against a stable reference and the
// computed doesn't allocate a new array on every re-evaluation when
// the path has no registered elements.
const EMPTY_ELEMENTS: readonly HTMLElement[] = Object.freeze([])
