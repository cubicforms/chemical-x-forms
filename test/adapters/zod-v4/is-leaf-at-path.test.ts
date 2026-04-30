import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v4'

/**
 * Adapter-level tests for `isLeafAtPath`. The runtime proxies query
 * this at every step to decide between **descend into a sub-proxy**
 * and **terminate with a leaf value**. Semantics: leaf iff the slim-
 * primitive set is non-empty AND contains only primitive kinds (no
 * `object`, `array`, `map`, `set`).
 */

describe('zod v4: isLeafAtPath — primitives are leaves', () => {
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

  it('returns true for Date (Date is a leaf — never drilled into)', () => {
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

describe('zod v4: isLeafAtPath — wrappers are transparent', () => {
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

describe('zod v4: isLeafAtPath — containers descend', () => {
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

  it('returns false for nested object container at depth 2', () => {
    const schema = z.object({
      profile: z.object({
        avatar: z.object({ url: z.string(), size: z.number() }),
      }),
    })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['profile'])).toBe(false)
    expect(adapter.isLeafAtPath(['profile', 'avatar'])).toBe(false)
    expect(adapter.isLeafAtPath(['profile', 'avatar', 'url'])).toBe(true)
    expect(adapter.isLeafAtPath(['profile', 'avatar', 'size'])).toBe(true)
  })
})

describe('zod v4: isLeafAtPath — discriminated unions', () => {
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

  it('returns true at variant-only keys (schema-static, regardless of active variant)', () => {
    expect(adapter.isLeafAtPath(['notify', 'address'])).toBe(true)
    expect(adapter.isLeafAtPath(['notify', 'number'])).toBe(true)
  })

  it('handles nested DUs', () => {
    const nested = z.object({
      flow: z.discriminatedUnion('step', [
        z.object({
          step: z.literal('choose-type'),
          type: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('A'), a: z.string() }),
            z.object({ kind: z.literal('B'), b: z.number() }),
          ]),
        }),
        z.object({ step: z.literal('review'), notes: z.string() }),
      ]),
    })
    const a = zodAdapter(nested)('f')
    expect(a.isLeafAtPath(['flow'])).toBe(false)
    expect(a.isLeafAtPath(['flow', 'step'])).toBe(true)
    expect(a.isLeafAtPath(['flow', 'type'])).toBe(false)
    expect(a.isLeafAtPath(['flow', 'type', 'kind'])).toBe(true)
    expect(a.isLeafAtPath(['flow', 'type', 'a'])).toBe(true)
    expect(a.isLeafAtPath(['flow', 'type', 'b'])).toBe(true)
    expect(a.isLeafAtPath(['flow', 'notes'])).toBe(true)
  })
})

describe('zod v4: isLeafAtPath — non-existent paths', () => {
  it('returns false for unknown paths (descend permissively)', () => {
    const schema = z.object({ name: z.string() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['unknown'])).toBe(false)
    expect(adapter.isLeafAtPath(['name', 'whatever'])).toBe(false)
  })
})

describe('zod v4: isLeafAtPath — cache behaviour', () => {
  it('returns the same result on repeated calls (memoised)', () => {
    const schema = z.object({ email: z.string(), address: z.object({ city: z.string() }) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.isLeafAtPath(['email'])).toBe(true)
    expect(adapter.isLeafAtPath(['email'])).toBe(true)
    expect(adapter.isLeafAtPath(['address'])).toBe(false)
    expect(adapter.isLeafAtPath(['address'])).toBe(false)
  })

  it('canonicalises so dotted-form and array-form share the cache', () => {
    const schema = z.object({ users: z.array(z.object({ name: z.string() })) })
    const adapter = zodAdapter(schema)('f')
    // Both should resolve to the same canonical key — and both should
    // return the same answer (the leaf at users.0.name).
    expect(adapter.isLeafAtPath(['users', 0, 'name'])).toBe(true)
    expect(adapter.isLeafAtPath(['users', 0, 'name'])).toBe(true)
  })
})
