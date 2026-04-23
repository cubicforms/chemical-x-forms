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

/** Our stable discriminant. Decouples adapter code from Zod's internal type strings. */
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
  }
}

function readDef(schema: unknown): ZodInternalShape['def'] | undefined {
  if (schema === null || typeof schema !== 'object') return undefined
  return (schema as ZodInternalShape).def
}

/** Returns our stable ZodKind, or 'unknown' if the schema shape doesn't match a known form. */
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
      return 'union'
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

export function getDefaultValue(schema: z.ZodType): unknown {
  const def = readDef(schema)
  // In v4, defaultValue is stored as a getter that returns the value directly
  // (v3 stored a function that had to be called). We read the property via
  // normal access so the getter fires.
  return def?.defaultValue
}

/**
 * Runtime-side assertion: confirms the given schema exposes v4 internals.
 * Every adapter entry point calls this on first use so a v3-installed
 * consumer importing `/zod` gets a clear error instead of a mystery.
 */
export function assertZodVersion(schema: unknown): void {
  const def = readDef(schema)
  if (def?.type === undefined) {
    throw new Error(
      '[@chemical-x/forms/zod] Detected a schema that does not expose Zod v4 internals. ' +
        'Install zod@^4 in your project, or import from @chemical-x/forms/zod-v3 if you are on zod@^3.'
    )
  }
}
