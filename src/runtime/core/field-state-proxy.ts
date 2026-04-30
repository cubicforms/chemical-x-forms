import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { buildFieldStateAccessor, type FieldStateView } from './field-state-api'
import { getAtPath } from './path-walker'
import type { Path, Segment } from './paths'
import { buildSurfaceProxy, type SurfaceProxy } from './surface-proxy'

/**
 * The leaf-prop set of a `FieldStateView`. At a leaf path, reads of
 * any of these keys terminate against the FieldStateView's reactive
 * prop. Reads of OTHER keys descend (e.g. a schema field literally
 * named `dirty` AT the leaf — which can happen when a schema has
 * `{ outer: { dirty: z.boolean() } }`, making `outer.dirty` a leaf in
 * its own right; that case resolves via the leaf-aware proxy in
 * surface-proxy.ts where `outer.dirty` becomes a leaf-VIEW proxy and
 * `.dirty` on it reads the FieldStateView's `dirty` boolean).
 *
 * Container paths do NOT inject these keys — `form.fields.address.dirty`
 * (where `address` is a container with no `dirty` field) descends to
 * a sub-proxy at `address.dirty`, not the legacy "any-descendant
 * dirty" boolean. Consumers who need a container aggregate compute
 * their own.
 */
const FIELD_STATE_KEYS: ReadonlySet<string> = new Set<keyof FieldStateView>([
  'value',
  'original',
  'pristine',
  'dirty',
  'focused',
  'blurred',
  'touched',
  'isConnected',
  'updatedAt',
  'errors',
  'path',
  'blank',
])

/**
 * Build the leaf-aware `form.fields` callable Proxy. Drill via dot /
 * bracket access OR call dynamically:
 *
 *   form.fields.email.errors           // dot/bracket descent
 *   form.fields('email').errors        // function-call (dynamic / programmatic)
 *   form.fields(['users', 0, 'name'])  // path-array form
 *   form.fields()                      // root proxy
 *
 * Specialises `buildSurfaceProxy` (see surface-proxy.ts) with:
 * - `resolveLeaf`: returns the per-path `ComputedRef<FieldStateView>`
 *   produced by `buildFieldStateAccessor`. The accessor allocates one
 *   computed per path; the per-path memoisation in `buildSurfaceProxy`
 *   ensures repeated reads of the same path return the same proxy.
 * - `leafKeys`: `FIELD_STATE_KEYS`. At a leaf path, reads off these
 *   keys return the FieldStateView's reactive prop. Reads inside the
 *   trap stay inside the consumer's active effect, so Vue's dep
 *   tracking captures the dependency at access time.
 * - `readLeafKey`: extracts `view.value[key]` — the `view.value` access
 *   triggers the computed's evaluation; the bracket lookup is a plain
 *   object read against the resulting `FieldStateView`.
 */
export function buildFieldStateProxy<F extends GenericForm>(state: FormStore<F>): SurfaceProxy {
  const getFieldStateAt = buildFieldStateAccessor(state)
  const snapshotFieldStateAt = (path: Path): Record<string, unknown> => {
    const view = getFieldStateAt(path as Parameters<typeof getFieldStateAt>[0]).value
    const snapshot: Record<string, unknown> = {}
    for (const k of FIELD_STATE_KEYS) snapshot[k] = (view as Record<string, unknown>)[k]
    return snapshot
  }
  return buildSurfaceProxy<ReturnType<typeof getFieldStateAt>>({
    schema: state.schema as unknown as Parameters<typeof buildSurfaceProxy>[0]['schema'],
    resolveLeaf: (path) => getFieldStateAt(path as Parameters<typeof getFieldStateAt>[0]),
    leafKeys: FIELD_STATE_KEYS,
    readLeafKey: (computed, key) => (computed.value as Record<string, unknown>)[key],
    materializeContainer: (segments) => materializeFields(state, segments, snapshotFieldStateAt),
  })
}

/**
 * Build a dense, nested `FieldStateView`-snapshot tree at
 * `containerSegments` for `JSON.stringify(form.fields.<container>)`.
 * Walks the live form value at the container path and snapshots the
 * `FieldStateView` for every schema-leaf descendant. Containers
 * recurse; leaves terminate with the snapshot. Arrays produce arrays;
 * records / objects produce objects whose key set matches the live
 * data (so a discriminated union exposes only the active variant's
 * keys, and a record exposes the keys actually present).
 *
 * Reactivity contract identical to `materializeErrors`: every read in
 * this function happens at call time inside the consumer's active
 * effect, so dependency tracking captures `state.form.value` and the
 * field-state computeds — `JSON.stringify(form.fields)` re-runs
 * whenever the form data or any per-leaf field state changes.
 */
function materializeFields<F extends GenericForm>(
  state: FormStore<F>,
  containerSegments: readonly Segment[],
  snapshotFieldStateAt: (path: Path) => Record<string, unknown>
): unknown {
  const liveValue = getAtPath(state.form.value, containerSegments)
  return walk(liveValue, containerSegments, state.schema, snapshotFieldStateAt)
}

function walk(
  value: unknown,
  basePath: readonly Segment[],
  schema: { isLeafAtPath(path: Path): boolean },
  snapshotFieldStateAt: (path: Path) => Record<string, unknown>
): unknown {
  // Schema-leaf takes precedence over data shape: a leaf path with
  // `null` or a primitive in storage still surfaces the FieldStateView
  // (which is the field-state authority — `value` lives inside the view).
  if (schema.isLeafAtPath(basePath)) return snapshotFieldStateAt(basePath)
  // Container with no live value (e.g. an absent record key, or a
  // missing optional object): expose null so consumers can distinguish
  // "schema container that hasn't been populated" from "container with
  // empty state" (`{}` / `[]`).
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') {
    // Defensive: schema reports container but data is a primitive. Surface
    // the primitive so the JSON shape reflects reality without throwing.
    return value
  }
  if (Array.isArray(value)) {
    return value.map((_, i) => walk(value[i], [...basePath, i], schema, snapshotFieldStateAt))
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    result[key] = walk(
      (value as Record<string, unknown>)[key],
      [...basePath, key],
      schema,
      snapshotFieldStateAt
    )
  }
  return result
}
