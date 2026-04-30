import type { ComputedRef } from 'vue'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { buildFieldStateAccessor, type FieldStateView } from './field-state-api'
import type { Segment } from './paths'

/**
 * The leaf-prop set of a `FieldStateView`. Reads at any non-root path
 * with a key in this set are resolved against the FieldStateView at
 * that path; reads with any other key descend one level deeper.
 *
 * Shadowing trade-off: a schema field with one of these names at depth
 * 2 or deeper is unreachable by dotted access through the proxy
 * (`form.fields.user.dirty` reads the `dirty` boolean of `user`,
 * not the FieldStateView for a `user.dirty` field). Documented edge
 * case; rename the schema field or read via the legacy
 * `getFieldState('user.dirty')` until C2 deletes that surface.
 *
 * Top-level fields are NOT shadowed — the root proxy treats every
 * access as descent, so `form.fields.dirty` resolves to the
 * FieldStateView for a top-level `dirty` field (if your schema has
 * one). Form-level boolean aggregates live on `form.state.isDirty`.
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
 * Build the `form.fields` reactive proxy. At every level the trap
 * disambiguates:
 *
 *   - Known FieldStateView prop names → read the reactive prop value
 *     of the FieldStateView at the current path.
 *
 *   - Other keys → return a deeper proxy at \`segments + key\`.
 *
 * Memoizes per-path proxies so repeated reads (`form.fields.email`
 * twice) return the same object — referential equality matters for
 * downstream effect tracking and Vue's render diff. Memoizes
 * per-path FieldStateView computeds via `buildFieldStateAccessor` so
 * dependency tracking is fine-grained on the underlying state slices.
 *
 * The root proxy (segments === []) treats EVERY key as descent — no
 * FieldStateView exists at the form root, so a top-level field whose
 * name happens to be in the FieldState prop set (e.g. a schema field
 * named `dirty`) is reachable as `form.fields.dirty`. Shadowing
 * only kicks in at depth 2+.
 */
export function buildFieldStateProxy<F extends GenericForm>(
  state: FormStore<F>
): Record<string, unknown> {
  const getFieldStateAt = buildFieldStateAccessor(state)

  // Per-path Proxy cache. Lifetime is tied to this buildFormApi
  // invocation (one cache per FormStore consumer), which means two
  // consumers of the same FormStore get separate proxies — fine, since
  // the underlying state is shared and identity differences only show
  // up in tests that compare proxy references across calls.
  const proxyCache = new Map<string, Record<string, unknown>>()

  // Per-path FieldStateView cache. `buildFieldStateAccessor` already
  // memoizes nothing internally — every call creates a fresh computed
  // — so the cache here amortises the computed allocation across
  // multiple reads of the same path.
  const viewCache = new Map<string, ComputedRef<FieldStateView>>()

  function proxyAt(segments: readonly Segment[]): Record<string, unknown> {
    const cacheKey = JSON.stringify(segments)
    const existing = proxyCache.get(cacheKey)
    if (existing !== undefined) return existing

    const isRoot = segments.length === 0
    const view = isRoot
      ? null
      : (viewCache.get(cacheKey) ??
        (() => {
          const fresh = getFieldStateAt(segments as Segment[])
          viewCache.set(cacheKey, fresh)
          return fresh
        })())

    const proxy = new Proxy(
      {},
      {
        get(_, key) {
          if (typeof key !== 'string') return undefined
          // Leaf-prop access: read off the FieldStateView at this path.
          // Wrapping `view.value[key]` inside the trap (rather than
          // pre-extracting) keeps the read inside the consumer's
          // active effect — Vue tracks the dependency at access time.
          if (view !== null && FIELD_STATE_KEYS.has(key)) {
            return (view.value as Record<string, unknown>)[key]
          }
          // Descent: return the deeper proxy at segments + key.
          return proxyAt([...segments, key])
        },
        has(_, key) {
          if (typeof key !== 'string') return false
          if (view !== null && FIELD_STATE_KEYS.has(key)) return true
          // Descent reachability is conservatively `true` — the proxy
          // can navigate any path; whether the path resolves to a
          // schema-defined slot is the FormStore's concern, not the
          // proxy's.
          return true
        },
        // Iteration support: at non-root paths, expose the FieldStateLeaf
        // keys so `JSON.stringify(form.fields.email)` produces the
        // expected leaf snapshot (matching the legacy
        // `JSON.stringify(form.getFieldState('email').value)` shape).
        // At the root, return `[]` — the root has no FieldStateView and
        // schema field names aren't enumerable through the proxy.
        ownKeys() {
          return view !== null ? Array.from(FIELD_STATE_KEYS) : []
        },
        getOwnPropertyDescriptor(_, key) {
          if (typeof key !== 'string') return undefined
          if (view !== null && FIELD_STATE_KEYS.has(key)) {
            return {
              configurable: true,
              enumerable: true,
              value: (view.value as Record<string, unknown>)[key],
              writable: false,
            }
          }
          return undefined
        },
        // Block writes at the proxy boundary. Mutations go through
        // `setValue`, the directive, or the field-array helpers.
        set() {
          return false
        },
        deleteProperty() {
          return false
        },
        defineProperty() {
          return false
        },
      }
    )
    proxyCache.set(cacheKey, proxy)
    return proxy
  }

  return proxyAt([])
}
