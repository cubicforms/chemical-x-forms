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

export const PERMISSIVE_V3: ReadonlySet<SlimPrimitiveKind> = new Set<SlimPrimitiveKind>([
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
])

const MAX_LAZY_DEPTH_V3 = 64

export function slimPrimitivesV3(schema: z.ZodTypeAny, depth = 0): Set<SlimPrimitiveKind> {
  if (depth > MAX_LAZY_DEPTH_V3) return new Set(PERMISSIVE_V3)
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

  if (isZodSchemaType(schema, 'ZodString')) return new Set(['string'])
  if (isZodSchemaType(schema, 'ZodNumber')) return new Set(['number'])
  if (isZodSchemaType(schema, 'ZodBoolean')) return new Set(['boolean'])
  if (isZodSchemaType(schema, 'ZodBigInt')) return new Set(['bigint'])
  if (isZodSchemaType(schema, 'ZodDate')) return new Set(['date'])
  if (isZodSchemaType(schema, 'ZodNull')) return new Set(['null'])
  if (isZodSchemaType(schema, 'ZodUndefined')) return new Set(['undefined'])
  if (typeName === 'ZodVoid') return new Set(['undefined'])
  if (typeName === 'ZodNaN') return new Set(['number'])

  if (isZodSchemaType(schema, 'ZodEnum')) {
    const options = (schema as z.ZodEnum<[string, ...string[]]>).options
    const out = new Set<SlimPrimitiveKind>()
    for (const v of options) {
      if (typeof v === 'string') out.add('string')
      else if (typeof v === 'number') out.add('number')
    }
    return out.size === 0 ? new Set(['string']) : out
  }
  if (isZodSchemaType(schema, 'ZodLiteral')) {
    const value = (schema as z.ZodLiteral<unknown>).value
    return new Set([slimKindOfRawV3(value)])
  }
  if (isZodSchemaType(schema, 'ZodObject') || typeName === 'ZodRecord') {
    return new Set(['object'])
  }
  if (isZodSchemaType(schema, 'ZodArray') || typeName === 'ZodTuple') {
    return new Set(['array'])
  }
  if (isZodSchemaType(schema, 'ZodSet')) {
    return new Set(['set'])
  }
  if (isZodSchemaType(schema, 'ZodOptional')) {
    const inner = def?.innerType
    const innerSet =
      inner === undefined ? new Set<SlimPrimitiveKind>() : slimPrimitivesV3(inner, depth + 1)
    innerSet.add('undefined')
    return innerSet
  }
  if (isZodSchemaType(schema, 'ZodNullable')) {
    const inner = def?.innerType
    const innerSet =
      inner === undefined ? new Set<SlimPrimitiveKind>() : slimPrimitivesV3(inner, depth + 1)
    innerSet.add('null')
    return innerSet
  }
  if (
    isZodSchemaType(schema, 'ZodDefault') ||
    isZodSchemaType(schema, 'ZodReadonly') ||
    isZodSchemaType(schema, 'ZodCatch') ||
    isZodSchemaType(schema, 'ZodBranded')
  ) {
    const inner = def?.innerType ?? def?.type
    return inner === undefined ? new Set(PERMISSIVE_V3) : slimPrimitivesV3(inner, depth + 1)
  }
  if (isZodSchemaType(schema, 'ZodEffects')) {
    // ZodEffects wraps refinements/transforms. Use the inner schema
    // type — writes are pre-transform values.
    const inner = def?.schema
    return inner === undefined ? new Set(PERMISSIVE_V3) : slimPrimitivesV3(inner, depth + 1)
  }
  if (isZodSchemaType(schema, 'ZodPipeline')) {
    // Pipeline: input side ('in').
    const inner = def?.in
    return inner === undefined ? new Set(PERMISSIVE_V3) : slimPrimitivesV3(inner, depth + 1)
  }
  if (typeName === 'ZodLazy') {
    const getter = def?.getter
    if (typeof getter !== 'function') return new Set(PERMISSIVE_V3)
    return slimPrimitivesV3(getter(), depth + 1)
  }
  if (isZodSchemaType(schema, 'ZodUnion') || isZodSchemaType(schema, 'ZodDiscriminatedUnion')) {
    const options = def?.options ?? []
    const out = new Set<SlimPrimitiveKind>()
    for (const opt of options) {
      for (const k of slimPrimitivesV3(opt, depth + 1)) out.add(k)
    }
    return out.size === 0 ? new Set(PERMISSIVE_V3) : out
  }
  if (typeName === 'ZodIntersection') {
    const left = def?.left
    const right = def?.right
    const leftSet = left === undefined ? new Set(PERMISSIVE_V3) : slimPrimitivesV3(left, depth + 1)
    const rightSet =
      right === undefined ? new Set(PERMISSIVE_V3) : slimPrimitivesV3(right, depth + 1)
    const out = new Set<SlimPrimitiveKind>()
    for (const k of leftSet) if (rightSet.has(k)) out.add(k)
    return out
  }
  if (typeName === 'ZodNever') return new Set()
  if (typeName === 'ZodAny' || typeName === 'ZodUnknown') return new Set(PERMISSIVE_V3)

  return new Set(PERMISSIVE_V3)
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
