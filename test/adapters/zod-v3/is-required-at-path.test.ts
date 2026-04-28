import { describe, expect, it } from 'vitest'
import { z } from 'zod-v3'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v3'

/**
 * Mirror of the v4 adapter's `is-required-at-path.test.ts`. Both
 * adapters MUST agree on which leaves admit "empty" via wrapper, so
 * the submit / validate required-empty check produces identical
 * errors across them.
 */

describe('zod v3: isRequiredAtPath — required leaves', () => {
  it('returns true for a strict primitive leaf', () => {
    const schema = z.object({ income: z.number(), name: z.string(), agreed: z.boolean() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['income'])).toBe(true)
    expect(adapter.isRequiredAtPath(['name'])).toBe(true)
    expect(adapter.isRequiredAtPath(['agreed'])).toBe(true)
  })

  it('returns true for the root form (empty path)', () => {
    const schema = z.object({ x: z.number() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath([])).toBe(true)
  })

  it('treats refinements as required', () => {
    const schema = z.object({
      bio: z.string().min(10),
      email: z.string().email(),
    })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['bio'])).toBe(true)
    expect(adapter.isRequiredAtPath(['email'])).toBe(true)
  })
})

describe('zod v3: isRequiredAtPath — optional / nullable / default / catch wrappers', () => {
  it('returns false for .optional()', () => {
    const schema = z.object({ count: z.number().optional() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['count'])).toBe(false)
  })

  it('returns false for .nullable()', () => {
    const schema = z.object({ count: z.number().nullable() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['count'])).toBe(false)
  })

  it('returns false for .default()', () => {
    const schema = z.object({ count: z.number().default(0) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['count'])).toBe(false)
  })

  it('returns false for .catch()', () => {
    const schema = z.object({ count: z.number().catch(0) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['count'])).toBe(false)
  })

  it('returns false when wrappers are stacked', () => {
    const schema = z.object({ count: z.number().optional().nullable() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['count'])).toBe(false)
  })
})

describe('zod v3: isRequiredAtPath — unions', () => {
  it('union with all required branches → required', () => {
    const schema = z.object({ x: z.union([z.number(), z.string()]) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['x'])).toBe(true)
  })

  it('union containing a nullable branch → not required', () => {
    const schema = z.object({ x: z.union([z.string(), z.null()]) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['x'])).toBe(false)
  })
})

describe('zod v3: isRequiredAtPath — nested paths', () => {
  it('walks through object nesting', () => {
    const schema = z.object({ user: z.object({ name: z.string(), age: z.number().optional() }) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['user', 'name'])).toBe(true)
    expect(adapter.isRequiredAtPath(['user', 'age'])).toBe(false)
  })

  it('walks through arrays', () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['tags', 0])).toBe(true)
  })

  it('walks through array of optional elements', () => {
    const schema = z.object({ scores: z.array(z.number().optional()) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['scores', 0])).toBe(false)
  })

  it('returns false for an unknown path', () => {
    const schema = z.object({ name: z.string() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['ghost'])).toBe(false)
  })
})

describe('zod v3: isRequiredAtPath — readonly / pipeline wrappers', () => {
  it('readonly is transparent — inner required → required', () => {
    const schema = z.object({ name: z.string().readonly() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['name'])).toBe(true)
  })

  it('readonly with optional inner → not required', () => {
    const schema = z.object({ name: z.string().optional().readonly() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isRequiredAtPath(['name'])).toBe(false)
  })
})
