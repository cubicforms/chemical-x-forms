/**
 * Field-metadata write/read API for the Zod v3 adapter.
 *
 * Storage lives in the shared `field-meta-store` core — every entry
 * (`attaform/zod`, `attaform/zod-v3`, `attaform/zod-v4`) writes to and
 * reads from the same `WeakMap`s, so a payload registered via any
 * entry surfaces at lookup regardless of which adapter actually runs.
 *
 * Zod 3 has no `z.registry()` mechanism, so `fieldMeta` is the
 * shared registry-shaped object exposing `add` / `get` / `has` /
 * `remove`. The public `withMeta(schema, payload)` write API matches
 * `attaform/zod`'s so schema authoring reads identically across the
 * two adapters.
 *
 * **Registration patterns:** both styles work — register on whatever
 * schema reference you assign into the parent's shape, OR on the
 * inner schema before wrapping. The adapter's resolver tries the
 * walker-returned schema first, then falls back to the peeled
 * inner so either ordering hits:
 *
 *     // both equivalent — registry hits at lookup time
 *     withMeta(z.string(), { label: 'Email' }).optional()
 *     withMeta(z.string().optional(), { label: 'Email' })
 *
 * The path walker returns the wrapper at terminal positions and
 * peels at intermediate descent. The two-stage lookup covers both
 * leaf and container registrations symmetrically.
 */
import type { z } from 'zod-v3'
import type { FieldMetaPayload } from '../../core/field-meta'
import { fieldMetaStore, getFieldMetaForSchema } from '../../core/field-meta-store'

/**
 * The shared registry every Attaform-aware Zod 3 schema can register
 * field metadata against. Backed by the cross-adapter
 * `fieldMetaStore` — a payload registered here is visible to the v4
 * adapter and the unified `attaform/zod` entry, and vice versa.
 */
type FieldMetaRegistryV3 = {
  /**
   * Register `payload` against `schema`. Returns the registry to
   * mirror Zod 4's `$ZodRegistry.add` chain shape.
   */
  add<S extends z.ZodTypeAny>(schema: S, payload: FieldMetaPayload): FieldMetaRegistryV3
  /**
   * Read the registered payload for a schema, or `undefined` if
   * nothing has been registered.
   */
  get(schema: z.ZodTypeAny): FieldMetaPayload | undefined
  /** True iff a payload has been registered for the schema. */
  has(schema: z.ZodTypeAny): boolean
}

export const fieldMeta = fieldMetaStore as unknown as FieldMetaRegistryV3

/**
 * Attach `payload` to `schema` in the shared `fieldMeta` registry
 * and return a clone of `schema` (chainable, with the new metadata).
 * Cross-version with `attaform/zod`'s `withMeta()`.
 *
 * **Why clone, not mutate.** The shared store keys metadata on the
 * schema reference. Calling `withMeta` twice on the same instance
 * would overwrite (last-write-wins) — so a sub-schema reused at
 * multiple form paths (e.g. an address schema shared between pickup
 * and delivery) couldn't carry distinct metadata per path.
 *
 * `withMeta` sidesteps the footgun by reconstructing `schema` via
 * its constructor + `_def` — Zod 3 schemas don't expose `.clone()`,
 * but `new schema.constructor(schema._def)` is the equivalent. Each
 * call gets a fresh identity and a fresh registry slot. Existing
 * metadata on the original is merged through, so chaining
 * `withMeta` accumulates payload fields rather than replacing.
 *
 * Inner field schemas (e.g. an object's `.shape.city`) are shared
 * across clones — the def is held by reference — so leaf metadata
 * registers once and surfaces at every path.
 *
 * `schema.register()` does NOT exist on Zod 3 — `withMeta` is the
 * only fluent write API. Register on the inner schema before
 * wrapping; see the "Registration rule" note in this file's header.
 */
export function withMeta<S extends z.ZodTypeAny>(schema: S, payload: FieldMetaPayload): S {
  const existing = getFieldMetaForSchema(schema as object) ?? {}
  // Zod 3 lacks a public `.clone()`, so reconstruct via the
  // constructor + _def. Each ZodSchema subclass's constructor takes
  // a `_def` object and produces an instance — same shape, fresh
  // identity.
  const Ctor = schema.constructor as new (def: S['_def']) => S
  const cloned = new Ctor(schema._def)
  fieldMetaStore.add(cloned as object, { ...existing, ...payload })
  return cloned
}

/**
 * Read the registered payload for a schema. Returns `undefined`
 * when nothing has been registered — callers apply their own
 * fallbacks (humanize for label, `.describe()` for description).
 *
 * Internal helper used by the v3 adapter's `getFieldMetaAtPath`.
 * Not part of the public `attaform/zod-v3` surface.
 */
export function getFieldMeta(schema: z.ZodTypeAny): FieldMetaPayload | undefined {
  return getFieldMetaForSchema(schema as object)
}
