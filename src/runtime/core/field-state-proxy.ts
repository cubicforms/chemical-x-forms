import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { buildFieldStateAccessor, type FieldState } from './field-state-api'
import { getAtPath } from './path-walker'
import type { Path, Segment } from './paths'
import { buildSurfaceProxy, type SurfaceProxy } from './surface-proxy'

/**
 * The leaf-prop set of a `FieldState`. At a leaf path, reads of
 * any of these keys terminate against the FieldState's reactive
 * prop. Reads of OTHER keys descend (e.g. a schema field literally
 * named `dirty` AT the leaf — which can happen when the shape is
 * `{ outer: { dirty: boolean } }`, making `outer.dirty` a leaf in
 * its own right; that case resolves via the leaf-aware proxy in
 * surface-proxy.ts where `outer.dirty` becomes a leaf-VIEW proxy and
 * `.dirty` on it reads the FieldState's `dirty` boolean).
 *
 * Container paths do NOT inject these keys via dot-access —
 * `form.fields.address.dirty` (where `address` is a container with
 * no `dirty` field) descends to a sub-proxy at `address.dirty` so
 * schema fields literally named `dirty` at depth 2+ stay
 * reachable. The container aggregation is reached via call-form:
 * `form.fields('address').dirty` returns the disjunction over
 * descendants.
 */
const FIELD_STATE_KEYS: ReadonlySet<string> = new Set<keyof FieldState<unknown>>([
  'value',
  'original',
  'pristine',
  'dirty',
  'focused',
  'blurred',
  'touched',
  'connected',
  'element',
  'elements',
  'updatedAt',
  'errors',
  'validating',
  'valid',
  'path',
  'blank',
  'label',
  'description',
  'placeholder',
  'meta',
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
 * - `resolveLeaf`: returns the per-path `ComputedRef<FieldState>`
 *   produced by `buildFieldStateAccessor`. The accessor allocates one
 *   computed per path; the per-path memoisation in `buildSurfaceProxy`
 *   ensures repeated reads of the same path return the same proxy.
 * - `leafKeys`: `FIELD_STATE_KEYS`. At a leaf path, reads off these
 *   keys return the FieldState's reactive prop. Reads inside the
 *   trap stay inside the consumer's active effect, so Vue's dep
 *   tracking captures the dependency at access time.
 * - `readLeafKey`: extracts `view.value[key]` — the `view.value` access
 *   triggers the computed's evaluation; the bracket lookup is a plain
 *   object read against the resulting `FieldState`.
 */
export function buildFieldStateProxy<F extends GenericForm>(state: FormStore<F>): SurfaceProxy {
  const getFieldStateAt = buildFieldStateAccessor(state)
  const snapshotFieldStateAt = (path: Path): Record<string, unknown> => {
    const view = getFieldStateAt(path as Parameters<typeof getFieldStateAt>[0]).value
    const snapshot: Record<string, unknown> = {}
    for (const k of FIELD_STATE_KEYS) snapshot[k] = (view as Record<string, unknown>)[k]
    return snapshot
  }
  // Per-path cache for the FieldState terminal proxy — stable
  // referential identity across repeated `form.fields(p)` reads with
  // the same canonical key.
  const terminalCache = new Map<string, SurfaceProxy>()
  /**
   * Build the third proxy shape (distinct from `containerProxyAt` and
   * `leafViewProxyAt` in surface-proxy.ts). Returned by `apply`-trap
   * call-form at any depth — leaf or container — so
   * `form.fields(path)` always lands on a `FieldState` surface.
   *
   * - `get`: `FIELD_STATE_KEYS` reads return the resolved leaf
   *   prop (delegates to the per-path computed); other keys return
   *   `undefined`. No descent.
   * - No `apply`. No further callable behavior.
   */
  function fieldStateTerminalAt(segments: Path): SurfaceProxy {
    const cacheKey = JSON.stringify(segments)
    const existing = terminalCache.get(cacheKey)
    if (existing !== undefined) return existing
    const target = (() => {}) as unknown as SurfaceProxy
    const proxy = new Proxy(target, {
      get(_, key: string | symbol): unknown {
        if (typeof key === 'symbol') {
          if (key === Symbol.toPrimitive) {
            return (hint: string): string | number =>
              hint === 'number' ? NaN : JSON.stringify(snapshotFieldStateAt(segments))
          }
          return Reflect.get(target, key)
        }
        if (typeof key !== 'string') return undefined
        if (key === 'toJSON') return () => snapshotFieldStateAt(segments)
        if (key === 'toString') return () => JSON.stringify(snapshotFieldStateAt(segments))
        if (key === 'valueOf')
          return function (this: unknown): unknown {
            return this
          }
        if (FIELD_STATE_KEYS.has(key)) {
          const computed = getFieldStateAt(segments as Parameters<typeof getFieldStateAt>[0])
          return (computed.value as Record<string, unknown>)[key]
        }
        return undefined
      },
      has: (_, key: string | symbol): boolean =>
        typeof key === 'string' && FIELD_STATE_KEYS.has(key),
      ownKeys: () => Array.from(FIELD_STATE_KEYS),
      getOwnPropertyDescriptor(_, key: string | symbol): PropertyDescriptor | undefined {
        if (typeof key !== 'string') return undefined
        if (!FIELD_STATE_KEYS.has(key)) return undefined
        const computed = getFieldStateAt(segments as Parameters<typeof getFieldStateAt>[0])
        return {
          configurable: true,
          enumerable: true,
          value: (computed.value as Record<string, unknown>)[key],
          writable: false,
        }
      },
      set: () => false,
      deleteProperty: () => false,
      defineProperty: () => false,
    })
    terminalCache.set(cacheKey, proxy)
    return proxy
  }
  return buildSurfaceProxy<ReturnType<typeof getFieldStateAt>>({
    schema: state.schema as unknown as Parameters<typeof buildSurfaceProxy>[0]['schema'],
    resolveLeaf: (path) => getFieldStateAt(path as Parameters<typeof getFieldStateAt>[0]),
    leafKeys: FIELD_STATE_KEYS,
    readLeafKey: (computed, key) => (computed.value as Record<string, unknown>)[key],
    materializeContainer: (segments) => materializeFields(state, segments, snapshotFieldStateAt),
    resolveCallTarget: (path) => fieldStateTerminalAt(path),
  })
}

/**
 * Build a dense, nested `FieldState`-snapshot tree at
 * `containerSegments` for `JSON.stringify(form.fields.<container>)`.
 * Walks the live form value at the container path and snapshots the
 * `FieldState` for every schema-leaf descendant. Containers
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
  // `null` or a primitive in storage still surfaces the FieldState
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
