import type { ValidationError } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { hasAtPath } from './path-walker'
import { canonicalizePath, type Path, type Segment } from './paths'
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
  })
}
