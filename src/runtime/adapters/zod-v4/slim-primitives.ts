/**
 * Slim-primitive walker for the zod-v4 adapter. Returns the set of
 * `SlimPrimitiveKind`s a schema accepts at write time — wrappers are
 * peeled, refinement-level constraints (`.email()`, `.min(N)`, enum
 * membership, literal equality, regex) are ignored.
 *
 * The runtime gate (`src/runtime/core/slim-primitive-gate.ts`) calls
 * the adapter method `getSlimPrimitiveTypesAtPath(path)`, which
 * resolves leaf candidates via `getNestedZodSchemasAtPath` and unions
 * `slimPrimitivesOf` across them.
 */
import type { z } from 'zod'
import type { SlimPrimitiveKind } from '../../types/types-api'
import {
  getEnumValues,
  getIntersectionLeft,
  getIntersectionRight,
  getLiteralValues,
  getUnionOptions,
  kindOf,
  unwrapInner,
  unwrapLazy,
  unwrapPipe,
} from './introspect'

export const PERMISSIVE: ReadonlySet<SlimPrimitiveKind> = new Set<SlimPrimitiveKind>([
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

const MAX_LAZY_DEPTH = 64

/**
 * Walk a schema, emitting the union of slim primitive kinds it
 * accepts. Wrappers descend into their inner schema; unions union
 * their branches; intersections intersect; lazy resolves through;
 * pipe takes the input side.
 *
 * Returns an empty set ONLY for `z.never()` — every other kind we
 * understand emits at least one entry. Unknown kinds (lazy with a
 * recursive cycle, custom z-types we don't recognise) return the
 * permissive set so the runtime gate doesn't reject legitimate
 * writes against shapes we can't introspect.
 */
export function slimPrimitivesOf(schema: z.ZodType): Set<SlimPrimitiveKind> {
  return walk(schema, 0)
}

function walk(schema: z.ZodType, depth: number): Set<SlimPrimitiveKind> {
  if (depth > MAX_LAZY_DEPTH) return new Set(PERMISSIVE)
  const kind = kindOf(schema)
  switch (kind) {
    case 'string':
      return new Set(['string'])
    case 'number':
    case 'nan':
      return new Set(['number'])
    case 'boolean':
      return new Set(['boolean'])
    case 'bigint':
      return new Set(['bigint'])
    case 'date':
      return new Set(['date'])
    case 'null':
      return new Set(['null'])
    case 'undefined':
    case 'void':
      return new Set(['undefined'])
    case 'enum': {
      // Enums in v4 may be string- or number-valued; walk entries.
      const values = getEnumValues(schema)
      const out = new Set<SlimPrimitiveKind>()
      for (const v of values) {
        if (typeof v === 'string') out.add('string')
        else if (typeof v === 'number') out.add('number')
      }
      return out.size === 0 ? new Set(['string']) : out
    }
    case 'literal': {
      const values = getLiteralValues(schema)
      const out = new Set<SlimPrimitiveKind>()
      for (const v of values) out.add(slimKindOfRaw(v))
      return out.size === 0 ? new Set(PERMISSIVE) : out
    }
    case 'object':
    case 'record':
      return new Set(['object'])
    case 'array':
    case 'tuple':
      return new Set(['array'])
    case 'set':
      return new Set(['set'])
    case 'optional': {
      const inner = unwrapInner(schema)
      const innerSet = inner === undefined ? new Set<SlimPrimitiveKind>() : walk(inner, depth + 1)
      innerSet.add('undefined')
      return innerSet
    }
    case 'nullable': {
      const inner = unwrapInner(schema)
      const innerSet = inner === undefined ? new Set<SlimPrimitiveKind>() : walk(inner, depth + 1)
      innerSet.add('null')
      return innerSet
    }
    case 'default':
    case 'readonly':
    case 'catch': {
      const inner = unwrapInner(schema)
      return inner === undefined ? new Set(PERMISSIVE) : walk(inner, depth + 1)
    }
    case 'pipe': {
      // Use the INPUT side: writes are pre-transform values.
      const inner = unwrapPipe(schema)
      return inner === undefined ? new Set(PERMISSIVE) : walk(inner, depth + 1)
    }
    case 'lazy': {
      const inner = unwrapLazy(schema)
      return inner === undefined ? new Set(PERMISSIVE) : walk(inner, depth + 1)
    }
    case 'union':
    case 'discriminated-union': {
      const options = getUnionOptions(schema)
      const out = new Set<SlimPrimitiveKind>()
      for (const opt of options) {
        for (const k of walk(opt as z.ZodType, depth + 1)) out.add(k)
      }
      return out.size === 0 ? new Set(PERMISSIVE) : out
    }
    case 'intersection': {
      const left = getIntersectionLeft(schema)
      const right = getIntersectionRight(schema)
      const leftSet = left === undefined ? new Set(PERMISSIVE) : walk(left, depth + 1)
      const rightSet = right === undefined ? new Set(PERMISSIVE) : walk(right, depth + 1)
      const out = new Set<SlimPrimitiveKind>()
      for (const k of leftSet) if (rightSet.has(k)) out.add(k)
      return out
    }
    case 'never':
      return new Set()
    case 'any':
    case 'unknown':
      return new Set(PERMISSIVE)
    // Kinds we don't understand at the slim level: be permissive to
    // avoid false-rejecting legitimate writes against schema shapes
    // we haven't characterised.
    case 'promise':
    case 'custom':
    case 'template-literal':
    default:
      return new Set(PERMISSIVE)
  }
}

function slimKindOfRaw(value: unknown): SlimPrimitiveKind {
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
    case 'undefined':
      return 'undefined'
    case 'object':
      return 'object'
    case 'function':
      return 'function'
    default:
      return 'object'
  }
}
