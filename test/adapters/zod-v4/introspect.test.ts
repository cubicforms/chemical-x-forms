import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  assertZodVersion,
  getArrayElement,
  getDefaultValue,
  getEnumValues,
  getLiteralValues,
  getObjectShape,
  getTupleItems,
  getUnionOptions,
  kindOf,
  unwrapInner,
} from '../../../src/runtime/adapters/zod-v4/introspect'

/*
 * Version-pin tests for the zod v4 internals layer. If zod v4 ever changes
 * its `def.type` strings or accessor shapes, this file fails first and
 * localizes the breakage to introspect.ts — every other adapter file
 * speaks kindOf() + the stable-shape accessors.
 */

describe('kindOf', () => {
  it('recognises scalar types', () => {
    expect(kindOf(z.string())).toBe('string')
    expect(kindOf(z.number())).toBe('number')
    expect(kindOf(z.boolean())).toBe('boolean')
    expect(kindOf(z.null())).toBe('null')
    expect(kindOf(z.undefined())).toBe('undefined')
  })

  it('recognises composite types', () => {
    expect(kindOf(z.object({ a: z.string() }))).toBe('object')
    expect(kindOf(z.array(z.number()))).toBe('array')
    expect(kindOf(z.tuple([z.string(), z.number()]))).toBe('tuple')
    expect(kindOf(z.union([z.string(), z.number()]))).toBe('union')
  })

  it('recognises wrapper types', () => {
    expect(kindOf(z.string().optional())).toBe('optional')
    expect(kindOf(z.string().nullable())).toBe('nullable')
    expect(kindOf(z.string().default('x'))).toBe('default')
  })

  it('recognises literal and enum', () => {
    expect(kindOf(z.literal('x'))).toBe('literal')
    expect(kindOf(z.enum(['a', 'b']))).toBe('enum')
  })

  it('returns "unknown" for non-zod values', () => {
    expect(kindOf({})).toBe('unknown')
    expect(kindOf(null)).toBe('unknown')
    expect(kindOf('not a schema')).toBe('unknown')
  })
})

describe('accessors', () => {
  it('getObjectShape returns shape map', () => {
    const shape = getObjectShape(z.object({ a: z.string(), b: z.number() }))
    expect(Object.keys(shape)).toEqual(['a', 'b'])
  })

  it('getArrayElement returns the element schema', () => {
    const element = getArrayElement(z.array(z.string()))
    expect(kindOf(element)).toBe('string')
  })

  it('getTupleItems returns the item schemas in order', () => {
    const items = getTupleItems(z.tuple([z.string(), z.number()]))
    expect(items).toHaveLength(2)
    expect(kindOf(items[0])).toBe('string')
    expect(kindOf(items[1])).toBe('number')
  })

  it('getUnionOptions returns the branches', () => {
    const options = getUnionOptions(z.union([z.string(), z.number()]))
    expect(options).toHaveLength(2)
  })

  it('getLiteralValues returns the value array', () => {
    expect(getLiteralValues(z.literal('x'))).toEqual(['x'])
  })

  it('getEnumValues returns the entry values', () => {
    expect(getEnumValues(z.enum(['a', 'b']))).toEqual(['a', 'b'])
  })

  it('unwrapInner peels one layer of optional / nullable / default', () => {
    expect(kindOf(unwrapInner(z.string().optional()))).toBe('string')
    expect(kindOf(unwrapInner(z.string().nullable()))).toBe('string')
    expect(kindOf(unwrapInner(z.string().default('x')))).toBe('string')
  })

  it('getDefaultValue returns the configured default', () => {
    expect(getDefaultValue(z.string().default('hi'))).toBe('hi')
    expect(getDefaultValue(z.number().default(42))).toBe(42)
  })
})

describe('assertZodVersion', () => {
  it('accepts a genuine zod v4 schema', () => {
    expect(() => assertZodVersion(z.string())).not.toThrow()
  })

  it('rejects a non-zod value with a helpful message', () => {
    expect(() => assertZodVersion({})).toThrow(/zod v4/i)
  })

  it('rejects a plain-object schema-look-alike', () => {
    // Simulates accidentally passing a zod-v3 schema into the v4 adapter.
    // v3 schemas expose `_def.typeName`, not `def.type`.
    const v3Like = { _def: { typeName: 'ZodString' } }
    expect(() => assertZodVersion(v3Like)).toThrow(/zod v4/i)
  })
})
