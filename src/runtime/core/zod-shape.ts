/**
 * Shape detectors for Zod schemas. Used by the unified `attaform/zod`
 * entry's runtime dispatch (`runtime/adapters/unified/use-form.ts`)
 * to route to the v3 or v4 adapter based on the schema's runtime
 * shape. Mirrors the discrimination already used by the v4
 * introspection helper (`adapters/zod-v4/introspect.ts`'s
 * `assertZodVersion`, which reads `def.type`) and the v3 wrapper's
 * legitimate-input branch (`composables/use-form.ts`'s `isZodType`,
 * which reads `_def`).
 *
 * Why this discriminator and not `_zod` / `_def`:
 * - Zod v4 retained `_def` for backward compat — reading `_def` alone
 *   misclassifies v4 schemas as v3.
 * - Zod v4's stable shape is `def.type: string` (lowercase tag like
 *   `'object'`); Zod v3's is `_def.typeName: string` (capitalised tag
 *   like `'ZodObject'`). Both are checked structurally so consumers
 *   who alias one Zod major to a non-standard import path still work.
 */

interface ZodV4Shape {
  def: { type: unknown }
}

interface ZodV3Shape {
  _def: { typeName: unknown }
}

/**
 * Returns true when `value` looks like a Zod schema of either major
 * version. Convenience wrapper around the v3 / v4 detectors.
 */
export function isZodSchemaShape(value: unknown): boolean {
  return isZodV4SchemaShape(value) || isZodV3SchemaShape(value)
}

/**
 * Returns true when `value` looks like a Zod v4 schema (has
 * `def.type: string`). Used by the unified entry's runtime-dispatch
 * to route to the v4 adapter.
 */
export function isZodV4SchemaShape(value: unknown): value is ZodV4Shape {
  if (typeof value !== 'object' || value === null) return false
  const def = (value as { def?: unknown }).def
  if (typeof def !== 'object' || def === null) return false
  return typeof (def as { type?: unknown }).type === 'string'
}

/**
 * Returns true when `value` looks like a Zod v3 schema (has
 * `_def.typeName: string`). Kept distinct from `isZodV4SchemaShape`
 * because some v4 schemas also expose `_def` for backward compat —
 * the v4 detector wins first in `isZodSchemaShape`.
 */
export function isZodV3SchemaShape(value: unknown): value is ZodV3Shape {
  if (typeof value !== 'object' || value === null) return false
  const def = (value as { _def?: unknown })._def
  if (typeof def !== 'object' || def === null) return false
  return typeof (def as { typeName?: unknown }).typeName === 'string'
}
