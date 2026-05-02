import { describe, expect, it } from 'vitest'
import { z } from 'zod-v3'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v3'

/**
 * Mirror of the v4 adapter's `is-leaf-at-path.test.ts`. Both adapters
 * MUST agree on leaf classification, so the leaf-aware proxy resolves
 * identically across them.
 */

describe('zod v3: isLeafAtPath — primitives are leaves', () => {
  it('returns true for primitive leaves', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      agreed: z.boolean(),
      big: z.bigint(),
    })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['name'])).toBe(true)
    expect(adapter.isLeafAtPath(['age'])).toBe(true)
    expect(adapter.isLeafAtPath(['agreed'])).toBe(true)
    expect(adapter.isLeafAtPath(['big'])).toBe(true)
  })

  it('returns true for Date', () => {
    const schema = z.object({ created: z.date() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['created'])).toBe(true)
  })

  it('returns true for literal types', () => {
    const schema = z.object({ kind: z.literal('admin') })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['kind'])).toBe(true)
  })

  it('returns true for string enums', () => {
    const schema = z.object({ role: z.enum(['admin', 'user', 'guest']) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['role'])).toBe(true)
  })
})

describe('zod v3: isLeafAtPath — wrappers are transparent', () => {
  it('returns true for .optional() over a primitive', () => {
    const schema = z.object({ note: z.string().optional() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['note'])).toBe(true)
  })

  it('returns true for .nullable() over a primitive', () => {
    const schema = z.object({ count: z.number().nullable() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['count'])).toBe(true)
  })

  it('returns true for .default() over a primitive', () => {
    const schema = z.object({ count: z.number().default(0) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['count'])).toBe(true)
  })
})

describe('zod v3: isLeafAtPath — containers descend', () => {
  it('returns false for object containers', () => {
    const schema = z.object({
      address: z.object({ city: z.string(), zip: z.string() }),
    })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['address'])).toBe(false)
    expect(adapter.isLeafAtPath(['address', 'city'])).toBe(true)
    expect(adapter.isLeafAtPath(['address', 'zip'])).toBe(true)
  })

  it('returns false for array containers; element paths can be leaves', () => {
    const schema = z.object({
      tags: z.array(z.string()),
      users: z.array(z.object({ name: z.string() })),
    })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['tags'])).toBe(false)
    expect(adapter.isLeafAtPath(['tags', 0])).toBe(true)
    expect(adapter.isLeafAtPath(['users'])).toBe(false)
    expect(adapter.isLeafAtPath(['users', 0])).toBe(false)
    expect(adapter.isLeafAtPath(['users', 0, 'name'])).toBe(true)
  })

  it('returns false for the root form (empty path)', () => {
    const schema = z.object({ x: z.number() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath([])).toBe(false)
  })
})

describe('zod v3: isLeafAtPath — discriminated unions', () => {
  const schema = z.object({
    notify: z.discriminatedUnion('channel', [
      z.object({ channel: z.literal('email'), address: z.string() }),
      z.object({ channel: z.literal('sms'), number: z.string() }),
    ]),
  })
  const adapter = zodAdapter(schema)('f')

  it('returns false at the DU root (variants are objects)', () => {
    expect(adapter.isLeafAtPath(['notify'])).toBe(false)
  })

  it('returns true at the discriminator key', () => {
    expect(adapter.isLeafAtPath(['notify', 'channel'])).toBe(true)
  })

  it('returns true at variant-only keys (schema-static)', () => {
    expect(adapter.isLeafAtPath(['notify', 'address'])).toBe(true)
    expect(adapter.isLeafAtPath(['notify', 'number'])).toBe(true)
  })
})

describe('zod v3: isLeafAtPath — non-existent paths', () => {
  it('returns false for unknown paths (descend permissively)', () => {
    const schema = z.object({ name: z.string() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['unknown'])).toBe(false)
    expect(adapter.isLeafAtPath(['name', 'whatever'])).toBe(false)
  })
})

describe('zod v3: isLeafAtPath — cache behaviour', () => {
  it('returns the same result on repeated calls (memoised)', () => {
    const schema = z.object({ email: z.string(), address: z.object({ city: z.string() }) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['email'])).toBe(true)
    expect(adapter.isLeafAtPath(['email'])).toBe(true)
    expect(adapter.isLeafAtPath(['address'])).toBe(false)
    expect(adapter.isLeafAtPath(['address'])).toBe(false)
  })
})
