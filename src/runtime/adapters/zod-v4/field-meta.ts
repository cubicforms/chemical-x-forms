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
 */
export const fieldMeta = z.registry<FieldMetaPayload>()

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
  fieldMeta.add(schema, payload)
  return schema
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
