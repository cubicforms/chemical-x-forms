import type { ValidationError } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { aggregateErrorsAt } from './field-state-api'
import { getAtPath, hasAtPath } from './path-walker'
import {
  canonicalizePath,
  segmentsForPathKey,
  type PathKey,
  type Path,
  type Segment,
} from './paths'
import { buildSurfaceProxy, type SurfaceProxy } from './surface-proxy'

/**
 * Build the leaf-aware `form.errors` callable Proxy. Drill via dot /
 * bracket OR call dynamically:
 *
 *   form.errors.email                  // ValidationError[] | undefined (leaf)
 *   form.errors.address.city           // ValidationError[] | undefined (leaf)
 *   form.errors.address                // proxy for descent only (container)
 *   form.errors('address.city')        // function-call (dynamic / programmatic)
 *   form.errors(['address', 'city'])   // path-array form
 *   form.errors()                      // root proxy
 *
 * Specialises `buildSurfaceProxy` (see surface-proxy.ts) with:
 * - `resolveLeaf`: merges schemaErrors + derivedBlankErrors + userErrors
 *   at the canonical PathKey, FILTERED by `hasAtPath` (the active-path
 *   filter from commit 1fbb8bb stays). Returns `undefined` when no
 *   errors at the path OR the path isn't reachable through the live
 *   form value (e.g. inactive variant of a discriminated union after
 *   a switch). The store-side entries STAY — `form.meta.errors`
 *   exposes the unfiltered aggregate.
 * - `leafKeys`: undefined. The leaf IS the terminal — an array or
 *   undefined. No further proxy wrap.
 *
 * Path / value contract preserved: errors at unknown paths return a
 * sub-proxy (descend permissively). `form.errors.bogus` is a proxy,
 * not undefined — readers who want existence checks should use the
 * leaf form (`form.errors.bogus.somePath`) which terminates only at
 * schema-leaves.
 */
export function buildErrorsProxy<F extends GenericForm>(
  state: FormStore<F, GenericForm>
): SurfaceProxy {
  return buildSurfaceProxy<ValidationError[] | undefined>({
    schema: state.schema as unknown as Parameters<typeof buildSurfaceProxy>[0]['schema'],
    resolveLeaf: (path) => {
      // Active-path filter applies to SCHEMA + DERIVED-BLANK errors
      // only: paths whose value is no longer reachable through the
      // live form (e.g. the inactive variant of a DU after a switch)
      // are hidden because they're library-produced verdicts against
      // state that's been replaced. USER errors (set via
      // `setFieldErrors` / `setFormErrors`) are the consumer's data
      // — server replies, programmatic warnings, manual marks — and
      // we never silently drop them, even at paths the schema
      // doesn't know about. Per-field reads
      // (`form.fields.<path>.errors`, `state.getErrorsForPath`) and
      // the `form.meta.errors` aggregate are unaffected by this
      // filter.
      const { key } = canonicalizePath(path as Path)
      const userForKey = state.userErrors.get(key)
      const isActive = hasAtPath(state.form.value, path as ReadonlyArray<Segment>)
      const merged: ValidationError[] = []
      if (isActive) {
        const schemaForKey = state.schemaErrors.get(key)
        const blankForKey = state.derivedBlankErrors.value.get(key)
        if (schemaForKey !== undefined) merged.push(...schemaForKey)
        if (blankForKey !== undefined) merged.push(...blankForKey)
      }
      if (userForKey !== undefined) merged.push(...userForKey)
      return merged.length === 0 ? undefined : merged
    },
    // No leafKeys — at a leaf, the resolved value (the merged array or
    // undefined) IS the terminal.
    materializeContainer: (segments) => materializeErrors(state, segments),
    // Call-form aggregates: `form.errors(path)` returns a single
    // `ValidationError[]` for any depth (leaf or container) — same
    // shared `aggregateErrorsAt` helper that `form.meta.errors` and
    // `form.fields(path).errors` use, so the three surfaces never
    // drift. Empty results return `undefined`, matching the leaf
    // proxy's pre-existing semantic (`form.errors.email === undefined`
    // when valid) so consumer code that branches on truthiness keeps
    // working — the call-form just extends that semantic to
    // containers and dynamic paths.
    resolveCallTarget: (path) => {
      const errs = aggregateErrorsAt(state, path)
      return errs.length === 0 ? undefined : errs
    },
  })
}

/**
 * Build a sparse, nested error tree under `containerSegments` for
 * `JSON.stringify(form.errors.<container>)`. Includes every leaf-keyed
 * descendant whose path is reachable in the live form value (the same
 * active-path filter `resolveLeaf` applies), excludes paths that
 * resolve to the container itself (cross-field refines and form-level
 * errors live in `form.meta.errors`, which is the unfiltered flat
 * aggregate). Sparse: containers with no error-bearing descendants
 * don't appear in the tree.
 *
 * Reactivity contract: every read in this function (the three error
 * stores, the form Ref) happens at call time. JSON.stringify invokes
 * `toJSON` once per stringify call inside the consumer's active
 * effect, so dependency tracking captures every store on every render
 * and re-runs on mutation. The per-path proxy memoisation in
 * `surface-proxy.ts` caches the proxy itself, NOT the materialised
 * object — there is no staleness.
 */
function materializeErrors<F extends GenericForm>(
  state: FormStore<F, GenericForm>,
  containerSegments: readonly Segment[]
): Record<string, unknown> | unknown[] {
  // Mirror the live-data shape at the container: array container →
  // array root (array indices place into integer slots, holes
  // serialise as `null`); object container → object root. Without
  // this the placement code would route numeric segments through a
  // string-keyed object, producing `{ "0": {…} }` for an array path
  // and breaking shape parity with `form.values`.
  const liveContainer = getAtPath(state.form.value, containerSegments)
  const tree: Record<string, unknown> | unknown[] = Array.isArray(liveContainer) ? [] : {}

  // Two store classes with different visibility rules. Schema +
  // derived-blank: library-produced verdicts; filter out paths the
  // current form value can't reach (inactive DU variants). User:
  // consumer-supplied data (server replies, manual marks); surface
  // every entry regardless of `hasAtPath`, otherwise unknown server
  // keys / form-level messages get silently swallowed.
  const collect = (
    store: ReadonlyMap<PathKey, ValidationError[]>,
    applyActivePathFilter: boolean
  ): void => {
    entries: for (const [pathKey, errors] of store) {
      if (errors.length === 0) continue
      // Cache hit on every keystroke — the store's PathKeys are
      // produced through `canonicalizePath`, which warms the inverse
      // cache. Cold path (corrupt key) returns null and we skip.
      const fullPath = segmentsForPathKey(pathKey)
      if (fullPath === null) continue
      // Skip paths that aren't strict descendants of the container.
      // Exception at the ROOT container (`containerSegments.length === 0`):
      // form-level user entries live at the empty-string path `['']`
      // (length 1), which IS a strict descendant of the root by length,
      // but with a `''` first segment that placeAt routes under an
      // empty-string key — letting consumers debug-print form-level
      // messages without a separate API call.
      if (fullPath.length <= containerSegments.length) continue
      for (let i = 0; i < containerSegments.length; i++) {
        if (fullPath[i] !== containerSegments[i]) continue entries
      }
      // Active-path filter matches `resolveLeaf` semantics so a leaf
      // read and a container materialisation never disagree. Only
      // schema-class stores apply it — user errors stay visible
      // whether or not their path is reachable.
      if (applyActivePathFilter && !hasAtPath(state.form.value, fullPath)) continue
      placeAt(tree, fullPath.slice(containerSegments.length), errors)
    }
  }

  collect(state.schemaErrors, true)
  collect(state.derivedBlankErrors.value, true)
  collect(state.userErrors, false)
  return tree
}

/**
 * Place `errors` at the relative `path` inside `tree`, allocating
 * intermediate object/array containers as needed (numeric segments
 * produce arrays). When `tree` already has an array at `path`,
 * concatenate so multiple stores' contributions to the same path
 * merge into one array — matches `resolveLeaf`'s
 * `[...schemaErrors, ...blankErrors, ...userErrors]` ordering.
 */
function placeAt(
  tree: Record<string, unknown> | unknown[],
  path: readonly Segment[],
  errors: ValidationError[]
): void {
  if (path.length === 0) return
  let cursor: Record<string, unknown> | unknown[] = tree
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i] as Segment
    const nextSeg = path[i + 1] as Segment
    const key = typeof seg === 'number' ? String(seg) : seg
    const cursorRecord = cursor as Record<string, unknown>
    let child = cursorRecord[key]
    if (child === null || child === undefined || typeof child !== 'object') {
      child = typeof nextSeg === 'number' ? [] : {}
      cursorRecord[key] = child
    }
    cursor = child as Record<string, unknown> | unknown[]
  }
  const lastSeg = path[path.length - 1] as Segment
  const lastKey = typeof lastSeg === 'number' ? String(lastSeg) : lastSeg
  const cursorRecord = cursor as Record<string, unknown>
  const existing = cursorRecord[lastKey]
  cursorRecord[lastKey] = Array.isArray(existing) ? [...existing, ...errors] : errors
}
