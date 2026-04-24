import { describe, expect, it } from 'vitest'
import { z } from 'zod-v3'
import { fingerprintZodSchema } from '../../../src/runtime/adapters/zod-v3/fingerprint'

/**
 * Parallel coverage to the v4 fingerprint suite, adapted to v3's
 * introspection surface (`_def.typeName`-based).
 */

describe('v3 fingerprintZodSchema — structural equivalence', () => {
  it('identical object schemas in separate statements match', () => {
    const a = z.object({ email: z.string(), password: z.string().min(8) })
    const b = z.object({ email: z.string(), password: z.string().min(8) })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('object key order does not change the fingerprint', () => {
    const a = z.object({ email: z.string(), password: z.string() })
    const b = z.object({ password: z.string(), email: z.string() })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('nested object shapes match across reference identity', () => {
    const a = z.object({ user: z.object({ name: z.string(), age: z.number() }) })
    const b = z.object({ user: z.object({ age: z.number(), name: z.string() }) })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('union membership order does not change the fingerprint', () => {
    const a = z.union([z.string(), z.number()])
    const b = z.union([z.number(), z.string()])
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('discriminated-union option order does not change the fingerprint', () => {
    const a = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), x: z.number() }),
      z.object({ kind: z.literal('b'), y: z.string() }),
    ])
    const b = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('b'), y: z.string() }),
      z.object({ kind: z.literal('a'), x: z.number() }),
    ])
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('check order on a primitive does not change the fingerprint', () => {
    const a = z.string().min(3).max(10)
    const b = z.string().max(10).min(3)
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })
})

describe('v3 fingerprintZodSchema — structural distinctness', () => {
  it('differing leaf types produce different fingerprints', () => {
    const a = z.object({ email: z.string() })
    const b = z.object({ email: z.number() })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('missing a field produces a different fingerprint', () => {
    const a = z.object({ email: z.string(), password: z.string() })
    const b = z.object({ email: z.string() })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('different check constraints produce different fingerprints', () => {
    const a = z.object({ password: z.string().min(8) })
    const b = z.object({ password: z.string().min(4) })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('optional vs required is distinguishable', () => {
    const a = z.object({ bio: z.string() })
    const b = z.object({ bio: z.string().optional() })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('nullable vs non-nullable is distinguishable', () => {
    const a = z.object({ bio: z.string() })
    const b = z.object({ bio: z.string().nullable() })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })
})

describe('v3 fingerprintZodSchema — false negatives (documented floor)', () => {
  it('refinements with different predicates collapse to the same fingerprint', () => {
    const a = z.object({ email: z.string().refine((v) => v.includes('@')) })
    const b = z.object({ email: z.string().refine((v) => v.endsWith('.com')) })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })
})

describe('v3 fingerprintZodSchema — caching', () => {
  it('repeat calls on the same schema produce the same output', () => {
    const schema = z.object({ a: z.string(), b: z.number() })
    expect(fingerprintZodSchema(schema)).toBe(fingerprintZodSchema(schema))
  })
})
