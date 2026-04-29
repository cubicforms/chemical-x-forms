/**
 * The single file that reads Zod v4's internal `def` shape. Every other
 * file in the zod-v4 adapter uses these public-shaped accessors — future
 * Zod minor bumps that reshape internals touch only this file.
 *
 * Design principle: treat `schema.def.*` as an unstable surface, even when
 * Zod's docs say otherwise. Each helper returns a narrow, well-typed slice;
 * no adapter code outside this file does shape-based pattern matching on
 * `def`.
 */
import type { z } from 'zod'

/**
 * Stable kind discriminant for a Zod v4 schema. Returned by
 * `kindOf(schema)`. Use when building a custom integration that
 * needs to branch on schema shape — most consumers don't need this.
 */
export type ZodKind =
  | 'object'
  | 'array'
  | 'record'
  | 'tuple'
  | 'union'
  | 'discriminated-union'
  | 'string'
  | 'number'
  | 'boolean'
  | 'bigint'
  | 'date'
  | 'enum'
  | 'literal'
  | 'null'
  | 'undefined'
  | 'any'
  | 'unknown'
  | 'optional'
  | 'nullable'
  | 'default'
  | 'pipe'
  | 'readonly'
  | 'nan'
  | 'void'
  | 'never'
  | 'lazy'
  | 'intersection'
  | 'catch'
  | 'promise'
  | 'custom'
  | 'template-literal'

// Narrow accessor for the unstable `def` surface. All reads from this
// object go through helpers below — never inline.
interface ZodInternalShape {
  def?: {
    type?: string
    element?: unknown
    innerType?: unknown
    options?: readonly unknown[]
    shape?: Record<string, unknown>
    keyType?: unknown
    valueType?: unknown
    items?: readonly unknown[]
    values?: readonly unknown[]
    entries?: Record<string, unknown>
    discriminator?: string
    defaultValue?: unknown
    in?: unknown
    out?: unknown
    checks?: readonly unknown[]
    // Added for the extended kind coverage. `getter` on z.lazy(),
    // `left`/`right` on z.intersection(), `catchValue` on z.catch(),
    // `parts` on z.templateLiteral().
    getter?: () => unknown
    left?: unknown
    right?: unknown
    catchValue?: (ctx: { error: unknown; input: unknown }) => unknown
    parts?: readonly unknown[]
  }
}

function readDef(schema: unknown): ZodInternalShape['def'] | undefined {
  if (schema === null || typeof schema !== 'object') return undefined
  return (schema as ZodInternalShape).def
}

/**
 * Inspect a Zod v4 schema and return its `ZodKind`. Returns
 * `'unknown'` for non-Zod inputs and unrecognised shapes.
 *
 * Useful when writing introspection helpers that branch on schema
 * structure (e.g. custom error formatters or doc generators).
 */
export function kindOf(schema: unknown): ZodKind {
  const def = readDef(schema)
  const rawType = def?.type
  if (rawType === undefined) return 'unknown'
  switch (rawType) {
    case 'object':
      return 'object'
    case 'array':
      return 'array'
    case 'record':
      return 'record'
    case 'tuple':
      return 'tuple'
    case 'union':
      // v4 stores `z.discriminatedUnion(...)` as `type: 'union'` with an
      // extra `discriminator: string` field — differentiate here.
      return def?.discriminator !== undefined ? 'discriminated-union' : 'union'
    case 'discriminated_union':
    case 'discriminatedUnion':
      return 'discriminated-union'
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'bigint':
      return 'bigint'
    case 'date':
      return 'date'
    case 'enum':
      return 'enum'
    case 'literal':
      return 'literal'
    case 'null':
      return 'null'
    case 'undefined':
      return 'undefined'
    case 'optional':
      return 'optional'
    case 'nullable':
      return 'nullable'
    case 'default':
    case 'prefault':
      return 'default'
    case 'pipe':
      return 'pipe'
    case 'readonly':
      return 'readonly'
    case 'any':
      return 'any'
    case 'nan':
      return 'nan'
    case 'void':
      return 'void'
    case 'never':
      return 'never'
    case 'lazy':
      return 'lazy'
    case 'intersection':
      return 'intersection'
    case 'catch':
      return 'catch'
    case 'promise':
      return 'promise'
    case 'custom':
      return 'custom'
    case 'template_literal':
    case 'templateLiteral':
      return 'template-literal'
    default:
      return 'unknown'
  }
}

/** Returns schema.shape as Record<string, ZodTypeAny>. */
export function getObjectShape(schema: z.ZodObject): Record<string, z.ZodType> {
  const s = schema as unknown as { shape: Record<string, z.ZodType> }
  return s.shape
}

export function getArrayElement(schema: z.ZodArray): z.ZodType {
  const def = readDef(schema)
  return def?.element as z.ZodType
}

export function getRecordKeyType(schema: z.ZodType): z.ZodType {
  const def = readDef(schema)
  return def?.keyType as z.ZodType
}

export function getRecordValueType(schema: z.ZodType): z.ZodType {
  const def = readDef(schema)
  return def?.valueType as z.ZodType
}

export function getTupleItems(schema: z.ZodType): readonly z.ZodType[] {
  const def = readDef(schema)
  return (def?.items as readonly z.ZodType[] | undefined) ?? []
}

export function getUnionOptions(schema: z.ZodType): readonly z.ZodType[] {
  const def = readDef(schema)
  return (def?.options as readonly z.ZodType[] | undefined) ?? []
}

export function getLiteralValues(schema: z.ZodType): readonly unknown[] {
  const def = readDef(schema)
  return def?.values ?? []
}

export function getEnumValues(schema: z.ZodType): readonly (string | number)[] {
  const def = readDef(schema)
  const entries = def?.entries
  if (entries === undefined) return []
  return Object.values(entries) as (string | number)[]
}

export function unwrapInner(schema: z.ZodType): z.ZodType | undefined {
  const def = readDef(schema)
  return def?.innerType as z.ZodType | undefined
}

export function unwrapPipe(schema: z.ZodType): z.ZodType | undefined {
  const def = readDef(schema)
  return (def?.in as z.ZodType | undefined) ?? (def?.out as z.ZodType | undefined)
}

/**
 * Resolve a `z.lazy(() => inner)` to its inner schema by invoking the
 * factory. Each invocation runs the arrow function fresh, so the returned
 * schema is a distinct object on each call — cycle detection must track
 * the getter function identity, not the resulting schema.
 */
export function unwrapLazy(schema: z.ZodType): z.ZodType | undefined {
  const def = readDef(schema)
  const getter = def?.getter
  if (typeof getter !== 'function') return undefined
  return getter() as z.ZodType
}

/** Getter function reference on a `z.lazy()` — used for recursion detection. */
export function getLazyGetter(schema: z.ZodType): (() => unknown) | undefined {
  const def = readDef(schema)
  return typeof def?.getter === 'function' ? def.getter : undefined
}

export function getIntersectionLeft(schema: z.ZodType): z.ZodType | undefined {
  const def = readDef(schema)
  return def?.left as z.ZodType | undefined
}

export function getIntersectionRight(schema: z.ZodType): z.ZodType | undefined {
  const def = readDef(schema)
  return def?.right as z.ZodType | undefined
}

/**
 * Materialise the fallback value of a `z.catch(inner, value)` wrapper.
 * v4 stores the catch as a function `(ctx) => value` on `def.catchValue`;
 * we invoke it with a placeholder context. Consumer catch functions that
 * inspect `ctx.input` / `ctx.error` during default-values derivation are
 * rare — if the function throws, we surface `undefined` and let the
 * validate-then-fix loop find a fallback.
 */
export function getCatchDefault(schema: z.ZodType): unknown {
  const def = readDef(schema)
  const cv = def?.catchValue
  if (typeof cv !== 'function') return undefined
  try {
    return cv({ error: new Error('cx:default-values'), input: undefined })
  } catch {
    return undefined
  }
}

export function getDefaultValue(schema: z.ZodType): unknown {
  const def = readDef(schema)
  // In v4, defaultValue is stored as a getter that returns the value directly
  // (v3 stored a function that had to be called). We read the property via
  // normal access so the getter fires.
  return def?.defaultValue
}

/** True if the schema's `def` carries refinement checks (e.g. `.min(3)`). */
export function hasChecks(schema: z.ZodType): boolean {
  const def = readDef(schema)
  const checks = def?.checks
  return Array.isArray(checks) && checks.length > 0
}

/** Raw checks array. Empty when the schema has no refinements. */
export function getChecks(schema: z.ZodType): readonly unknown[] {
  const def = readDef(schema)
  const checks = def?.checks
  return Array.isArray(checks) ? (checks as readonly unknown[]) : []
}

/** ZodDiscriminatedUnion: the discriminator key (e.g. 'status'). */
export function getDiscriminator(schema: z.ZodType): string | undefined {
  const def = readDef(schema)
  return def?.discriminator
}

/** ZodDiscriminatedUnion: the option objects (typed narrowly as ZodObject). */
export function getDiscriminatedOptions(schema: z.ZodType): readonly z.ZodObject[] {
  const def = readDef(schema)
  const options = def?.options
  return Array.isArray(options) ? (options as readonly z.ZodObject[]) : []
}

/**
 * Verify a schema is Zod v4. Throws a clear error if it's a v3
 * schema mistakenly imported through `@chemical-x/forms/zod`.
 *
 * Most consumers never call this directly — the v4 adapter calls it
 * internally on every schema. Reach for it only when wiring a custom
 * adapter that needs the same guard.
 */
export function assertZodVersion(schema: unknown): void {
  const def = readDef(schema)
  if (def?.type === undefined) {
    throw new Error('[@chemical-x/forms/zod] schema is not zod v4. Install zod@^4 or use /zod-v3.')
  }
}
