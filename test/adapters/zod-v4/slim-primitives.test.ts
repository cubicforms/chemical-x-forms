import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodV4Adapter } from '../../../src/runtime/adapters/zod-v4/adapter'

/**
 * Adapter unit tests for `getSlimPrimitiveTypesAtPath`. Pins the
 * walker's behaviour for the slim-primitive write contract:
 * wrappers peel, refinements ignored, unions union, intersections
 * intersect.
 */

function probe(rootSchema: z.ZodObject, path: (string | number)[]): Set<string> {
  const adapter = zodV4Adapter(rootSchema)('f')
  return adapter.getSlimPrimitiveTypesAtPath(path)
}

describe('getSlimPrimitiveTypesAtPath — leaf primitives', () => {
  it('z.string() → {string}', () => {
    expect([...probe(z.object({ x: z.string() }), ['x'])]).toEqual(['string'])
  })
  it('z.number() → {number}', () => {
    expect([...probe(z.object({ x: z.number() }), ['x'])]).toEqual(['number'])
  })
  it('z.boolean() → {boolean}', () => {
    expect([...probe(z.object({ x: z.boolean() }), ['x'])]).toEqual(['boolean'])
  })
  it('z.bigint() → {bigint}', () => {
    expect([...probe(z.object({ x: z.bigint() }), ['x'])]).toEqual(['bigint'])
  })
  it('z.date() → {date}', () => {
    expect([...probe(z.object({ x: z.date() }), ['x'])]).toEqual(['date'])
  })
})

describe('getSlimPrimitiveTypesAtPath — refinements ignored', () => {
  it('z.string().email() → {string}', () => {
    expect([...probe(z.object({ x: z.string().email() }), ['x'])]).toEqual(['string'])
  })
  it('z.string().min(8) → {string}', () => {
    expect([...probe(z.object({ x: z.string().min(8) }), ['x'])]).toEqual(['string'])
  })
  it('z.number().int().min(0) → {number}', () => {
    expect([...probe(z.object({ x: z.number().int().min(0) }), ['x'])]).toEqual(['number'])
  })
})

describe('getSlimPrimitiveTypesAtPath — enum / literal', () => {
  it('z.enum([strings...]) → {string}', () => {
    expect([...probe(z.object({ x: z.enum(['a', 'b', 'c']) }), ['x'])]).toEqual(['string'])
  })
  it("z.literal('on') → {string}", () => {
    expect([...probe(z.object({ x: z.literal('on') }), ['x'])]).toEqual(['string'])
  })
  it('z.literal(42) → {number}', () => {
    expect([...probe(z.object({ x: z.literal(42) }), ['x'])]).toEqual(['number'])
  })
})

describe('getSlimPrimitiveTypesAtPath — wrappers', () => {
  it('z.string().optional() → {string, undefined}', () => {
    const set = probe(z.object({ x: z.string().optional() }), ['x'])
    expect(set.has('string')).toBe(true)
    expect(set.has('undefined')).toBe(true)
    expect(set.size).toBe(2)
  })
  it('z.string().nullable() → {string, null}', () => {
    const set = probe(z.object({ x: z.string().nullable() }), ['x'])
    expect(set.has('string')).toBe(true)
    expect(set.has('null')).toBe(true)
    expect(set.size).toBe(2)
  })
  it('z.string().default("hi") → {string}', () => {
    expect([...probe(z.object({ x: z.string().default('hi') }), ['x'])]).toEqual(['string'])
  })
  it('z.string().readonly() → {string}', () => {
    expect([...probe(z.object({ x: z.string().readonly() }), ['x'])]).toEqual(['string'])
  })
})

describe('getSlimPrimitiveTypesAtPath — unions', () => {
  it('z.union([z.string(), z.number()]) → {string, number}', () => {
    const set = probe(z.object({ x: z.union([z.string(), z.number()]) }), ['x'])
    expect(set.has('string')).toBe(true)
    expect(set.has('number')).toBe(true)
    expect(set.size).toBe(2)
  })
  it('z.union([z.string(), z.null()]) → {string, null}', () => {
    const set = probe(z.object({ x: z.union([z.string(), z.null()]) }), ['x'])
    expect(set.has('string')).toBe(true)
    expect(set.has('null')).toBe(true)
  })
})

describe('getSlimPrimitiveTypesAtPath — composites', () => {
  it('z.object({...}) at the path → {object}', () => {
    expect([...probe(z.object({ x: z.object({ y: z.string() }) }), ['x'])]).toEqual(['object'])
  })
  it('z.array(...) at the path → {array}', () => {
    expect([...probe(z.object({ x: z.array(z.string()) }), ['x'])]).toEqual(['array'])
  })
  it('nested leaf access → returns the leaf primitive', () => {
    expect([...probe(z.object({ x: z.object({ y: z.number() }) }), ['x', 'y'])]).toEqual(['number'])
  })
  it('array element access → returns the element primitive', () => {
    expect([...probe(z.object({ x: z.array(z.string()) }), ['x', 0])]).toEqual(['string'])
  })
})

describe('getSlimPrimitiveTypesAtPath — permissive shapes', () => {
  it('z.any() → permissive (set has many primitives)', () => {
    const set = probe(z.object({ x: z.any() }), ['x'])
    expect(set.has('string')).toBe(true)
    expect(set.has('number')).toBe(true)
    expect(set.has('boolean')).toBe(true)
  })
  it('z.unknown() → permissive', () => {
    const set = probe(z.object({ x: z.unknown() }), ['x'])
    expect(set.has('string')).toBe(true)
    expect(set.size).toBeGreaterThan(3)
  })
  it('z.never() → empty set', () => {
    const set = probe(z.object({ x: z.never() as unknown as z.ZodAny }), ['x'])
    expect(set.size).toBe(0)
  })
})

describe('getSlimPrimitiveTypesAtPath — root path', () => {
  it('empty path → {object} (root form is always an object)', () => {
    expect([...probe(z.object({ x: z.string() }), [])]).toEqual(['object'])
  })
})
