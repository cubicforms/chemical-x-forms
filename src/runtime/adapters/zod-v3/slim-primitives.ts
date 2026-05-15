import type { z } from 'zod-v3'
import type { SlimPrimitiveKind } from '../../types/types-api'
import { isZodSchemaType } from './helpers'

/**
 * Slim-primitive walker for v3. Returns the set of `SlimPrimitiveKind`s
 * a schema accepts at write time. Wrappers (`ZodOptional`,
 * `ZodNullable`, `ZodDefault`, `ZodEffects`, `ZodPipeline`,
 * `ZodReadonly`, `ZodBranded`, `ZodCatch`, `ZodLazy`) are peeled;
 * refinement-level constraints are ignored.
 *
 * Mirrors the v4 implementation in
 * `src/runtime/adapters/zod-v4/slim-primitives.ts`.
 */

export const PERMISSIVE_V3: ReadonlySet<SlimPrimitiveKind> =
  /* @__PURE__ */ new Set<SlimPrimitiveKind>([
    'string',
    'number',
    'boolean',
    'bigint',
    'date',
    'null',
    'undefined',
    'object',
    'array',
    'symbol',
    'function',
    'map',
    'set',
    'file',
  ])

// Module-level frozen leaf singletons; see the v4 file for rationale.
const KIND_STRING: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['string'])
const KIND_NUMBER: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['number'])
const KIND_BOOLEAN: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['boolean'])
const KIND_BIGINT: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['bigint'])
const KIND_DATE: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['date'])
const KIND_NULL: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['null'])
const KIND_UNDEFINED: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['undefined'])
const KIND_OBJECT: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['object'])
const KIND_ARRAY: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['array'])
const KIND_SET: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['set'])
const EMPTY_KINDS: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set()

const MAX_LAZY_DEPTH_V3 = 64

export function slimPrimitivesV3(schema: z.ZodTypeAny, depth = 0): Set<SlimPrimitiveKind> {
  // Clone once at the public boundary; the internal walk reuses
  // frozen singletons for leaf kinds.
  return new Set(walk(schema, depth))
}

function walk(schema: z.ZodTypeAny, depth: number): ReadonlySet<SlimPrimitiveKind> {
  if (depth > MAX_LAZY_DEPTH_V3) return PERMISSIVE_V3
  const def = (
    schema as {
      _def?: {
        typeName?: string
        innerType?: z.ZodTypeAny
        type?: z.ZodTypeAny
        schema?: z.ZodTypeAny
        in?: z.ZodTypeAny
        out?: z.ZodTypeAny
        getter?: () => z.ZodTypeAny
        options?: readonly z.ZodTypeAny[]
        left?: z.ZodTypeAny
        right?: z.ZodTypeAny
      }
    }
  )._def
  const typeName = def?.typeName

  if (isZodSchemaType(schema, 'ZodString')) return KIND_STRING
  if (isZodSchemaType(schema, 'ZodNumber')) return KIND_NUMBER
  if (isZodSchemaType(schema, 'ZodBoolean')) return KIND_BOOLEAN
  if (isZodSchemaType(schema, 'ZodBigInt')) return KIND_BIGINT
  if (isZodSchemaType(schema, 'ZodDate')) return KIND_DATE
  if (isZodSchemaType(schema, 'ZodNull')) return KIND_NULL
  if (isZodSchemaType(schema, 'ZodUndefined')) return KIND_UNDEFINED
  if (typeName === 'ZodVoid') return KIND_UNDEFINED
  if (typeName === 'ZodNaN') return KIND_NUMBER

  if (isZodSchemaType(schema, 'ZodEnum')) {
    const options = (schema as z.ZodEnum<[string, ...string[]]>).options
    const out = new Set<SlimPrimitiveKind>()
    for (const v of options) {
      if (typeof v === 'string') out.add('string')
      else if (typeof v === 'number') out.add('number')
    }
    return out.size === 0 ? KIND_STRING : out
  }
  if (isZodSchemaType(schema, 'ZodLiteral')) {
    const value = (schema as z.ZodLiteral<unknown>).value
    return new Set([slimKindOfRawV3(value)])
  }
  if (isZodSchemaType(schema, 'ZodObject') || typeName === 'ZodRecord') {
    return KIND_OBJECT
  }
  if (isZodSchemaType(schema, 'ZodArray') || typeName === 'ZodTuple') {
    return KIND_ARRAY
  }
  if (isZodSchemaType(schema, 'ZodSet')) {
    return KIND_SET
  }
  if (isZodSchemaType(schema, 'ZodOptional')) {
    const inner = def?.innerType
    const innerSet = inner === undefined ? EMPTY_KINDS : walk(inner, depth + 1)
    const out = new Set<SlimPrimitiveKind>(innerSet)
    out.add('undefined')
    return out
  }
  if (isZodSchemaType(schema, 'ZodNullable')) {
    const inner = def?.innerType
    const innerSet = inner === undefined ? EMPTY_KINDS : walk(inner, depth + 1)
    const out = new Set<SlimPrimitiveKind>(innerSet)
    out.add('null')
    return out
  }
  if (
    isZodSchemaType(schema, 'ZodDefault') ||
    isZodSchemaType(schema, 'ZodReadonly') ||
    isZodSchemaType(schema, 'ZodCatch') ||
    isZodSchemaType(schema, 'ZodBranded')
  ) {
    const inner = def?.innerType ?? def?.type
    return inner === undefined ? PERMISSIVE_V3 : walk(inner, depth + 1)
  }
  if (isZodSchemaType(schema, 'ZodEffects')) {
    // ZodEffects wraps refinements/transforms. Use the inner schema
    // type — writes are pre-transform values.
    const inner = def?.schema
    return inner === undefined ? PERMISSIVE_V3 : walk(inner, depth + 1)
  }
  if (isZodSchemaType(schema, 'ZodPipeline')) {
    // Pipeline: input side ('in').
    const inner = def?.in
    return inner === undefined ? PERMISSIVE_V3 : walk(inner, depth + 1)
  }
  if (typeName === 'ZodLazy') {
    const getter = def?.getter
    if (typeof getter !== 'function') return PERMISSIVE_V3
    return walk(getter(), depth + 1)
  }
  if (isZodSchemaType(schema, 'ZodUnion') || isZodSchemaType(schema, 'ZodDiscriminatedUnion')) {
    const options = def?.options ?? []
    const out = new Set<SlimPrimitiveKind>()
    for (const opt of options) {
      for (const k of walk(opt, depth + 1)) out.add(k)
    }
    return out.size === 0 ? PERMISSIVE_V3 : out
  }
  if (typeName === 'ZodIntersection') {
    const left = def?.left
    const right = def?.right
    const leftSet = left === undefined ? PERMISSIVE_V3 : walk(left, depth + 1)
    const rightSet = right === undefined ? PERMISSIVE_V3 : walk(right, depth + 1)
    const out = new Set<SlimPrimitiveKind>()
    for (const k of leftSet) if (rightSet.has(k)) out.add(k)
    return out
  }
  if (typeName === 'ZodNever') return EMPTY_KINDS
  if (typeName === 'ZodAny' || typeName === 'ZodUnknown') return PERMISSIVE_V3

  return PERMISSIVE_V3
}

function slimKindOfRawV3(value: unknown): SlimPrimitiveKind {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  const t = typeof value
  switch (t) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'bigint':
      return 'bigint'
    case 'symbol':
      return 'symbol'
    case 'function':
      return 'function'
    case 'undefined':
      return 'undefined'
    case 'object':
      return 'object'
    default:
      return 'object'
  }
}
