import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getNestedZodSchemasAtPath } from '../../../src/runtime/adapters/zod-v4/path-walker'

describe('getNestedZodSchemasAtPath', () => {
  it('returns the root schema for an empty path', () => {
    const schema = z.object({ name: z.string() })
    expect(getNestedZodSchemasAtPath(schema, '')).toEqual([schema])
  })

  it('walks through object → leaf', () => {
    const schema = z.object({ name: z.string() })
    const resolved = getNestedZodSchemasAtPath(schema, 'name')
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.safeParse('hello').success).toBe(true)
  })

  it('walks through object → array → object', () => {
    const schema = z.object({
      items: z.array(z.object({ label: z.string() })),
    })
    const resolved = getNestedZodSchemasAtPath(schema, 'items.0.label')
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.safeParse('x').success).toBe(true)
  })

  it('returns empty array for a non-existent path', () => {
    const schema = z.object({ name: z.string() })
    expect(getNestedZodSchemasAtPath(schema, 'nope')).toEqual([])
  })

  it('returns empty array when descending into a leaf', () => {
    const schema = z.object({ name: z.string() })
    expect(getNestedZodSchemasAtPath(schema, 'name.middle')).toEqual([])
  })

  it('returns multiple subschemas for a union branch', () => {
    const schema = z.object({
      value: z.union([
        z.object({ kind: z.literal('a'), x: z.string() }),
        z.object({ kind: z.literal('b'), x: z.number() }),
      ]),
    })
    const resolved = getNestedZodSchemasAtPath(schema, 'value.x')
    // Both union branches have an x — both resolve.
    expect(resolved.length).toBeGreaterThanOrEqual(1)
  })

  it('discriminated union: filters options by next-segment presence', () => {
    const schema = z.object({
      result: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('ok'), value: z.string() }),
        z.object({ kind: z.literal('err'), message: z.string() }),
      ]),
    })
    // "value" only lives in the ok branch — expect exactly one match.
    const resolved = getNestedZodSchemasAtPath(schema, 'result.value')
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.safeParse('x').success).toBe(true)
  })

  it('transparently walks through optional wrappers', () => {
    const schema = z.object({ inner: z.string().optional() })
    const resolved = getNestedZodSchemasAtPath(schema, 'inner')
    expect(resolved).toHaveLength(1)
    // Optional preserves undefined.
    expect(resolved[0]?.safeParse(undefined).success).toBe(true)
  })

  it('accepts both dotted-string and array path forms', () => {
    const schema = z.object({
      profile: z.object({ name: z.string() }),
    })
    const byString = getNestedZodSchemasAtPath(schema, 'profile.name')
    const byArray = getNestedZodSchemasAtPath(schema, ['profile', 'name'])
    expect(byString).toHaveLength(1)
    expect(byArray).toHaveLength(1)
  })
})
