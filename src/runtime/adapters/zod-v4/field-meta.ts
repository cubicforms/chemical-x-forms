/**
 * Field-metadata write/read API for the Zod v4 adapter.
 *
 * Backed by Zod 4's native `z.registry<T>()` mechanism — the schema
 * carries the metadata directly through `schema.register(fieldMeta,
 * payload)` (returns the schema, chainable) or the `withMeta()`
 * helper (same effect, version-agnostic across the v3 / v4 adapter
 * split).
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
 *     z.string().optional().register(fieldMeta, { label: 'Email' })
 *     z.string().register(fieldMeta, { label: 'Email' }).optional()
 *
 * The path walker returns the wrapper at terminal positions
 * (`['email']` against `{ email: z.string().optional() }` resolves
 * to `ZodOptional<ZodString>`) and peels at intermediate descent
 * (`['address', 'street']` peels through `address`'s wrapper to
 * reach the inner object). The two-stage lookup covers both leaf
 * and container registrations symmetrically.
 */
import { z } from 'zod'
import type { FieldMetaPayload } from '../../core/field-meta'

/**
 * The shared registry every Attaform-aware Zod 4 schema can register
 * field metadata against. One module-scoped instance per consumer
 * project — re-exported from `attaform/zod` so user code reads the
 * same registry the runtime does.
 *
 * Consumers extending `FieldMetaPayload` via declaration merging
 * automatically get the richer payload type at every `register` /
 * `add` / `get` call site.
 *
 * **Shared-instance disambiguation.** A single schema instance reused
 * at multiple form paths (e.g. one address schema bound to both
 * `pickup` and `delivery`) can carry distinct metadata per path —
 * even via the canonical `schema.register(fieldMeta, payload)` chain.
 * Internally we maintain a parallel WeakMap of payload LISTS indexed
 * per schema reference, and the path-resolver walks the form's
 * schema tree counting per-schema occurrences to pick the right
 * payload for each path. Object literals evaluate left-to-right, so
 * registration order matches tree-walk order, and shared schemas
 * pair their two registrations to the two paths correctly:
 *
 *     z.object({
 *       pickup: addressSchema.register(fieldMeta, { label: 'Pickup address' }),
 *       delivery: addressSchema.register(fieldMeta, { label: 'Delivery address' }),
 *     })
 *     // form.fields('pickup').label   → 'Pickup address'
 *     // form.fields('delivery').label → 'Delivery address'
 *
 * Schemas reused via `withMeta()` get a fresh clone per call (see
 * `withMeta` below), so they never share a registry slot in the
 * first place.
 */
export const fieldMeta = z.registry<FieldMetaPayload>()

// Parallel list-per-schema store used by the path-resolver to pick
// the right payload when one schema instance is registered at
// multiple paths. The native registry only stores last-write-wins;
// this list captures every registration so the resolver can
// disambiguate by tree-walk order. Module-scoped so it survives
// across multiple useForm calls; WeakMap so schemas GC normally.
const fieldMetaLists = new WeakMap<object, FieldMetaPayload[]>()

const originalAdd = fieldMeta.add.bind(fieldMeta)
fieldMeta.add = function add(schema, payload) {
  // The `add` overload's type uses Zod's `$ZodType` (core) while our
  // public `getFieldMetaList` exposes `z.ZodType` (classic). Both
  // are objects with stable identity at runtime — the WeakMap is
  // typed as `object` to bridge the two without a noisy cast at
  // every call site.
  const list = fieldMetaLists.get(schema as object) ?? []
  list.push(payload as FieldMetaPayload)
  fieldMetaLists.set(schema as object, list)
  return originalAdd(schema, payload)
} as typeof fieldMeta.add

/**
 * Read the list of payloads registered against `schema`, in
 * registration order. Empty list when nothing has been registered.
 *
 * Used by the v4 adapter's path-resolver to disambiguate per
 * occurrence when a schema is shared across multiple form paths.
 * Most consumers won't need this — use `fieldMeta.get(schema)` for
 * the single-payload case.
 */
export function getFieldMetaList(schema: z.ZodType): readonly FieldMetaPayload[] {
  return fieldMetaLists.get(schema as object) ?? []
}

/**
 * Attach `payload` to `schema` in the shared `fieldMeta` registry
 * and return `schema` (chainable). Cross-version with `attaform/zod-v3`'s
 * `withMeta()`; user code that uses this helper reads the same on
 * either adapter.
 *
 * Equivalent to `schema.register(fieldMeta, payload)` on Zod 4.
 * Prefer the native chain for v4-only code; reach for `withMeta`
 * when authoring schema modules that may need to compile under both
 * adapters.
 *
 * Registers on the schema reference passed in. See the
 * "Registration rule" note in this file's header — register on the
 * inner schema before wrapping with `.optional()` / `.nullable()` /
 * `.default()` / etc.
 */
export function withMeta<S extends z.ZodType>(schema: S, payload: FieldMetaPayload): S {
  // Clone first so each `withMeta` returns a fresh schema identity.
  // The fieldMeta registry keys on schema reference; without
  // cloning, two registrations on the same instance — common when a
  // sub-schema is reused at multiple form paths (e.g. address shared
  // between pickup and delivery) — would overwrite (last-write-wins)
  // and every path would resolve to the most recently registered
  // payload. Cloning gives every callsite its own slot.
  //
  // Merge any existing payload through so chaining accumulates
  // fields rather than replacing — `withMeta(withMeta(s, {label}), {description})`
  // keeps both keys.
  const existing = fieldMeta.get(schema) ?? {}
  const cloned = schema.clone() as S
  fieldMeta.add(cloned, { ...existing, ...payload })
  return cloned
}

/**
 * Read the registered payload for a schema. Returns `undefined`
 * when nothing has been registered — callers apply their own
 * fallbacks (humanize for label, `.describe()` for description).
 *
 * Internal helper used by the v4 adapter's `getFieldMetaAtPath`.
 * Not part of the public `attaform/zod` surface.
 */
export function getFieldMeta(schema: z.ZodType): FieldMetaPayload | undefined {
  return fieldMeta.get(schema)
}
