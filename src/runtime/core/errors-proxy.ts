import type { ValidationError } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { getAtPath, hasAtPath } from './path-walker'
import { canonicalizePath, type PathKey, type Path, type Segment } from './paths'
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
export function buildErrorsProxy<F extends GenericForm>(state: FormStore<F>): SurfaceProxy {
  return buildSurfaceProxy<ValidationError[] | undefined>({
    schema: state.schema as unknown as Parameters<typeof buildSurfaceProxy>[0]['schema'],
    resolveLeaf: (path) => {
      // Active-path filter: paths whose value is no longer reachable
      // through the live form value (inactive variant after a DU
      // switch) are hidden from `form.errors`. Per-field read APIs
      // (`form.fields.<path>.errors`, `state.getErrorsForPath`) and
      // the `form.meta.errors` aggregate still expose them.
      if (!hasAtPath(state.form.value, path as ReadonlyArray<Segment>)) return undefined
      const { key } = canonicalizePath(path as Path)
      const schemaForKey = state.schemaErrors.get(key)
      const blankForKey = state.derivedBlankErrors.value.get(key)
      const userForKey = state.userErrors.get(key)
      const merged: ValidationError[] = []
      if (schemaForKey !== undefined) merged.push(...schemaForKey)
      if (blankForKey !== undefined) merged.push(...blankForKey)
      if (userForKey !== undefined) merged.push(...userForKey)
      return merged.length === 0 ? undefined : merged
    },
    // No leafKeys — at a leaf, the resolved value (the merged array or
    // undefined) IS the terminal.
    materializeContainer: (segments) => materializeErrors(state, segments),
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
  state: FormStore<F>,
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

  const collect = (store: ReadonlyMap<PathKey, ValidationError[]>): void => {
    entries: for (const [pathKey, errors] of store) {
      if (errors.length === 0) continue
      const fullPath = JSON.parse(pathKey) as Segment[]
      // Skip paths that aren't strict descendants of the container —
      // a path equal to or shorter than the container has no leaf-keyed
      // contribution at this view (errors at the exact container path
      // are surfaced via `form.meta.errors`).
      if (fullPath.length <= containerSegments.length) continue
      for (let i = 0; i < containerSegments.length; i++) {
        if (fullPath[i] !== containerSegments[i]) continue entries
      }
      // Active-path filter: skip paths that aren't reachable through
      // the live form value. Matches `resolveLeaf` semantics so a leaf
      // read and a container materialisation never disagree.
      if (!hasAtPath(state.form.value, fullPath)) continue
      placeAt(tree, fullPath.slice(containerSegments.length), errors)
    }
  }

  collect(state.schemaErrors)
  collect(state.derivedBlankErrors.value)
  collect(state.userErrors)
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
