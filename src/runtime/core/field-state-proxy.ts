import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { buildFieldStateAccessor, type FieldStateView } from './field-state-api'
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
  return buildSurfaceProxy<ReturnType<typeof getFieldStateAt>>({
    schema: state.schema as unknown as Parameters<typeof buildSurfaceProxy>[0]['schema'],
    resolveLeaf: (path) => getFieldStateAt(path as Parameters<typeof getFieldStateAt>[0]),
    leafKeys: FIELD_STATE_KEYS,
    readLeafKey: (computed, key) => (computed.value as Record<string, unknown>)[key],
  })
}
