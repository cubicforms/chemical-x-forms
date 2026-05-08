/**
 * Shared field-metadata storage. Both Zod adapters (v3 and v4) and the
 * unified `attaform/zod` entry read from the same `WeakMap`s so a
 * payload written via any entry's `withMeta` / `fieldMeta.add` is
 * visible to whichever adapter actually runs at lookup time.
 *
 * No `zod` runtime import — pure JavaScript primitives. The previous
 * v4 adapter built `fieldMeta` via `z.registry<FieldMetaPayload>()`,
 * which left a `z.registry` namespace reference reachable from
 * `attaform/zod`'s module graph; bundlers analysing a `zod@^3` consumer
 * resolved that against zod 3's exports map (no `registry` export) and
 * emitted an `IMPORT_IS_UNDEFINED` warning. Lifting storage here drops
 * that reference entirely so the unified entry behaves cleanly on any
 * Zod major.
 *
 * The native v4 chain `schema.register(fieldMeta, payload)` still
 * works against this shim — Zod 4's `.register()` only calls
 * `registry.add(this, payload)` and returns the schema; structural
 * matching is enough.
 *
 * Two parallel maps:
 * - `store` — last-write-wins single payload per schema reference.
 *   Backs `fieldMeta.get(schema)` and the adapter's
 *   `getFieldMetaAtPath` single-payload fallback.
 * - `lists` — every registration in order, per schema reference.
 *   Backs the v4 adapter's path-walker disambiguation when the same
 *   schema instance is bound at multiple form paths.
 */

import type { FieldMetaPayload } from './field-meta'

/**
 * Minimal registry shape the shared store satisfies — `.add` / `.get`
 * / `.has` / `.remove`. Cast to `z.$ZodRegistry<FieldMetaPayload>` at
 * the v4 adapter's re-export so the native `schema.register(fieldMeta,
 * payload)` chain type-checks; the v3 adapter exports it as its own
 * registry-shaped surface.
 */
export type FieldMetaStore = {
  add(schema: object, payload: FieldMetaPayload): FieldMetaStore
  get(schema: object): FieldMetaPayload | undefined
  has(schema: object): boolean
  remove(schema: object): FieldMetaStore
}

const store = new WeakMap<object, FieldMetaPayload>()
const lists = new WeakMap<object, FieldMetaPayload[]>()

const registry: FieldMetaStore = {
  add(schema, payload) {
    store.set(schema, payload)
    const list = lists.get(schema) ?? []
    list.push(payload)
    lists.set(schema, list)
    return registry
  },
  get(schema) {
    return store.get(schema)
  },
  has(schema) {
    return store.has(schema)
  },
  remove(schema) {
    store.delete(schema)
    lists.delete(schema)
    return registry
  },
}

/**
 * The shared registry every Attaform-aware Zod schema can register
 * field metadata against, regardless of Zod major. One module-scoped
 * instance — every adapter entry re-exports this same object so
 * writes from one entry are visible at lookup through any other.
 */
export const fieldMetaStore: FieldMetaStore = registry

/**
 * Last-write-wins payload lookup for a schema reference. Returns
 * `undefined` if nothing has been registered.
 */
export function getFieldMetaForSchema(schema: object): FieldMetaPayload | undefined {
  return store.get(schema)
}

/**
 * Read every payload registered against `schema` in registration
 * order. Empty list when nothing has been registered. Used by the v4
 * adapter's path-resolver to disambiguate per occurrence when one
 * schema instance is bound at multiple form paths.
 */
export function getFieldMetaListForSchema(schema: object): readonly FieldMetaPayload[] {
  return lists.get(schema) ?? []
}
