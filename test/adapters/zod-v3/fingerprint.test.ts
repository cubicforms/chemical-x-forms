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

describe('v3 fingerprintZodSchema — deep nesting + scale', () => {
  it('distinguishes 4-level-nested objects that differ only at the innermost leaf', () => {
    const a = z.object({
      a: z.object({ b: z.object({ c: z.object({ d: z.string() }) }) }),
    })
    const b = z.object({
      a: z.object({ b: z.object({ c: z.object({ d: z.number() }) }) }),
    })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('distinguishes tuples that differ at a single position', () => {
    const a = z.tuple([z.string(), z.number(), z.object({ flag: z.boolean() })])
    const b = z.tuple([z.string(), z.number(), z.object({ flag: z.string() })])
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('matches across 50 random key orderings of a 20-field object', () => {
    const fields: Array<[string, z.ZodTypeAny]> = []
    for (let i = 0; i < 20; i++) {
      fields.push([`f${i}`, i % 2 === 0 ? z.string() : z.number()])
    }
    const canonicalFp = fingerprintZodSchema(z.object(Object.fromEntries(fields)))

    // Deterministic PRNG — reproducible across CI runs.
    let seed = 0xdecafbad
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x80000000
    }

    for (let trial = 0; trial < 50; trial++) {
      const shuffled = [...fields]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [
          shuffled[j] as [string, z.ZodTypeAny],
          shuffled[i] as [string, z.ZodTypeAny],
        ]
      }
      expect(fingerprintZodSchema(z.object(Object.fromEntries(shuffled)))).toBe(canonicalFp)
    }
  })

  it('distinguishes 20-field objects that differ in exactly one field type', () => {
    const baseFields: Array<[string, z.ZodTypeAny]> = []
    for (let i = 0; i < 20; i++) baseFields.push([`f${i}`, z.string()])
    const a = z.object(Object.fromEntries(baseFields))
    const mutated = [...baseFields]
    mutated[10] = ['f10', z.number()]
    const b = z.object(Object.fromEntries(mutated))
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })
})
