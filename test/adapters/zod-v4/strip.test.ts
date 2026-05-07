import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  getSlimSchema,
  stripAsyncChecks,
  stripRefinements,
} from '../../../src/runtime/adapters/zod-v4/strip'

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

  it('strips refinements INSIDE a .default() wrapper when stripDefaultValues=false', () => {
    // Regression: previously the 'default' branch returned the original
    // schema unchanged when stripDefaultValues=false, which meant nested
    // stripRefinements / stripPipe flags never reached the inner schema.
    // Now we re-apply .default(slimmedInner) so the chain is honoured.
    const schema = z.string().email().default('seed@example.com')
    const slim = getSlimSchema(schema, { stripRefinements: true })
    // The default still resolves on undefined.
    const onUndefined = slim.safeParse(undefined)
    expect(onUndefined.success).toBe(true)
    if (onUndefined.success) expect(onUndefined.data).toBe('seed@example.com')
    // Empty string, which would fail .email() on the original, now passes.
    expect(slim.safeParse('').success).toBe(true)
  })

  it('default-wrapped enum: `.default(value)` survives + slimming runs through', () => {
    const schema = z.enum(['a', 'b', 'c']).default('a')
    const slim = getSlimSchema(schema, { stripRefinements: true })
    const onUndefined = slim.safeParse(undefined)
    expect(onUndefined.success).toBe(true)
    if (onUndefined.success) expect(onUndefined.data).toBe('a')
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

describe('getSlimSchema — container-level constraints survive strict mode', () => {
  it('preserves array .min() when stripRefinements is false', () => {
    const schema = z.array(z.string()).min(1)
    const slim = getSlimSchema(schema, { stripRefinements: false })
    expect(slim.safeParse([]).success).toBe(false)
    expect(slim.safeParse(['x']).success).toBe(true)
  })

  it('drops array .min() when stripRefinements is true', () => {
    const schema = z.array(z.string()).min(1)
    const slim = getSlimSchema(schema, { stripRefinements: true })
    // With refinements stripped, the empty array should now pass.
    expect(slim.safeParse([]).success).toBe(true)
  })

  it('preserves object refinements in strict mode', () => {
    const schema = z
      .object({ a: z.number(), b: z.number() })
      .refine((v) => v.a < v.b, 'a must be less than b')
    const slim = getSlimSchema(schema, { stripRefinements: false })
    expect(slim.safeParse({ a: 2, b: 1 }).success).toBe(false)
    expect(slim.safeParse({ a: 1, b: 2 }).success).toBe(true)
  })
})

describe('stripAsyncChecks', () => {
  it('strips a top-level async refine so safeParse no longer throws', () => {
    const schema = z.string().refine(async (v) => Promise.resolve(v === 'OK'), 'must be OK')
    // Sanity: original throws on sync safeParse.
    expect(() => schema.safeParse('OK')).toThrow()
    const stripped = stripAsyncChecks(schema)
    expect(() => stripped.safeParse('OK')).not.toThrow()
    expect(stripped.safeParse('OK').success).toBe(true)
    // Async check stripped → previously-failing 'nope' now passes.
    expect(stripped.safeParse('nope').success).toBe(true)
  })

  it('preserves a sync refine while stripping a co-located async refine', () => {
    const schema = z
      .string()
      .refine(async (v) => Promise.resolve(v.length > 0), 'must be non-empty (async)')
      .refine((v) => v !== 'banned', 'banned word (sync)')
    const stripped = stripAsyncChecks(schema)
    // Sync survives — 'banned' rejected, with the sync message.
    const banned = stripped.safeParse('banned')
    expect(banned.success).toBe(false)
    if (!banned.success) {
      expect(banned.error.issues[0]?.message).toBe('banned word (sync)')
    }
    // Async stripped — empty string no longer rejected.
    expect(stripped.safeParse('').success).toBe(true)
  })

  it('seeds sync sibling errors when an async sibling would throw the original', () => {
    const schema = z.object({
      word: z.string().refine((v) => v.length > 0, 'word required'),
      email: z.email().refine(async (v) => Promise.resolve(v !== 'taken@x.com'), 'taken'),
    })
    expect(() => schema.safeParse({ word: '', email: 'a@b.com' })).toThrow()
    const stripped = stripAsyncChecks(schema)
    const result = stripped.safeParse({ word: '', email: 'a@b.com' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('word required')
      // Async refine error must NOT appear — it was stripped.
      expect(messages).not.toContain('taken')
    }
  })

  it('strips a cross-field async refine at the object root, preserving sync child refines', () => {
    const schema = z
      .object({ word: z.string().refine((v) => v.length > 0, 'word required') })
      .refine(async (data) => Promise.resolve(data.word.length < 100), 'too long (async)')
    expect(() => schema.safeParse({ word: '' })).toThrow()
    const stripped = stripAsyncChecks(schema)
    const result = stripped.safeParse({ word: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('word required')
    }
  })

  it('recurses through .optional()', () => {
    const schema = z
      .string()
      .refine(async (v) => Promise.resolve(v === 'OK'))
      .optional()
    const stripped = stripAsyncChecks(schema)
    expect(stripped.safeParse(undefined).success).toBe(true)
    expect(stripped.safeParse('anything').success).toBe(true)
  })

  it('recurses through .nullable()', () => {
    const schema = z
      .string()
      .refine(async () => Promise.resolve(true))
      .nullable()
    const stripped = stripAsyncChecks(schema)
    expect(stripped.safeParse(null).success).toBe(true)
    expect(stripped.safeParse('value').success).toBe(true)
  })

  it('recurses through .default(v)', () => {
    const schema = z
      .string()
      .refine(async () => Promise.resolve(true))
      .default('seed')
    const stripped = stripAsyncChecks(schema)
    const result = stripped.safeParse(undefined)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('seed')
  })

  it('strips async checks inside discriminated-union variants independently', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('a'),
        x: z.string().refine((v) => v.length > 0, 'x required'),
      }),
      z.object({
        kind: z.literal('b'),
        y: z.string().refine(async (v) => Promise.resolve(v === 'OK'), 'y must be OK'),
      }),
    ])
    expect(() => schema.safeParse({ kind: 'b', y: 'nope' })).toThrow()
    const stripped = stripAsyncChecks(schema)
    // Variant b: async stripped, anything passes for y.
    expect(stripped.safeParse({ kind: 'b', y: 'nope' }).success).toBe(true)
    // Variant a: sync refine survives.
    const result = stripped.safeParse({ kind: 'a', x: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('x required')
    }
  })

  it('terminates on z.lazy() schemas with async refines (cycle-safe)', () => {
    type Tree = { name: string; children: Tree[] }
    const treeSchema: z.ZodType<Tree> = z.lazy(() =>
      z.object({
        name: z.string().refine(async (v) => Promise.resolve(v.length > 0), 'name required'),
        children: z.array(treeSchema),
      })
    )
    // Smoke: stripAsyncChecks must not infinite-loop.
    const stripped = stripAsyncChecks(treeSchema)
    expect(stripped.safeParse({ name: '', children: [] }).success).toBe(true)
  })

  it('passes pure-sync schemas through behaviourally unchanged', () => {
    const schema = z.object({
      a: z.string().min(3, 'min 3'),
      b: z.number().int().positive(),
    })
    const stripped = stripAsyncChecks(schema)
    // Same parse verdicts — sync schemas have no async checks to strip.
    expect(stripped.safeParse({ a: 'ab', b: 1 }).success).toBe(false)
    expect(stripped.safeParse({ a: 'abc', b: 1 }).success).toBe(true)
    expect(stripped.safeParse({ a: 'abc', b: -1 }).success).toBe(false)
  })
})
