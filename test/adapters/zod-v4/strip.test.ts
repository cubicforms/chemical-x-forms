import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getSlimSchema, stripRefinements } from '../../../src/runtime/adapters/zod-v4/strip'

describe('stripRefinements', () => {
  it('z.string().min(3) → parses empty string without error', () => {
    const slimmed = stripRefinements(z.string().min(3))
    expect(slimmed.safeParse('').success).toBe(true)
  })

  it('z.string().email() → parses empty string without error', () => {
    const slimmed = stripRefinements(z.string().email())
    expect(slimmed.safeParse('').success).toBe(true)
  })

  it('z.number().int().positive() → parses 0 without error', () => {
    const slimmed = stripRefinements(z.number().int().positive())
    expect(slimmed.safeParse(0).success).toBe(true)
  })

  it('nested refinements inside arrays get stripped', () => {
    const schema = z.array(z.string().min(3))
    const slimmed = stripRefinements(schema)
    expect(slimmed.safeParse(['']).success).toBe(true)
  })

  it('nested refinements inside objects get stripped', () => {
    const schema = z.object({ email: z.string().email() })
    const slimmed = stripRefinements(schema)
    expect(slimmed.safeParse({ email: '' }).success).toBe(true)
  })

  it('pass-through for non-refined leaves', () => {
    const schema = z.boolean()
    const slimmed = stripRefinements(schema)
    expect(slimmed.safeParse(true).success).toBe(true)
    expect(slimmed.safeParse(false).success).toBe(true)
  })
})

describe('getSlimSchema — stripRefinements flag', () => {
  it('strips refinements from nested leaves when true', () => {
    const schema = z.object({ email: z.string().email() })
    const slim = getSlimSchema(schema, { stripRefinements: true })
    expect(slim.safeParse({ email: '' }).success).toBe(true)
  })

  it('keeps refinements when flag is false', () => {
    const schema = z.object({ email: z.string().email() })
    const slim = getSlimSchema(schema, { stripRefinements: false })
    expect(slim.safeParse({ email: '' }).success).toBe(false)
  })
})

describe('getSlimSchema — stripDefaultValues flag', () => {
  it('strips `.default()` wrapper when true', () => {
    const schema = z.string().default('hello')
    const slim = getSlimSchema(schema, { stripDefaultValues: true })
    // With default stripped, parsing undefined should fail.
    expect(slim.safeParse(undefined).success).toBe(false)
    expect(slim.safeParse('explicit').success).toBe(true)
  })

  it('keeps `.default()` when flag is false (or omitted)', () => {
    const schema = z.string().default('hello')
    const slim = getSlimSchema(schema, {})
    // With default kept, undefined should resolve to the default.
    const parsed = slim.safeParse(undefined)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toBe('hello')
  })
})

describe('getSlimSchema — stripOptional / stripNullable flags', () => {
  it('stripOptional=true rejects undefined', () => {
    const schema = z.string().optional()
    const slim = getSlimSchema(schema, { stripOptional: true })
    expect(slim.safeParse(undefined).success).toBe(false)
    expect(slim.safeParse('x').success).toBe(true)
  })

  it('stripNullable=true rejects null', () => {
    const schema = z.string().nullable()
    const slim = getSlimSchema(schema, { stripNullable: true })
    expect(slim.safeParse(null).success).toBe(false)
    expect(slim.safeParse('x').success).toBe(true)
  })

  it('defaults preserve optionality/nullability', () => {
    const optional = getSlimSchema(z.string().optional(), {})
    const nullable = getSlimSchema(z.string().nullable(), {})
    expect(optional.safeParse(undefined).success).toBe(true)
    expect(nullable.safeParse(null).success).toBe(true)
  })
})
