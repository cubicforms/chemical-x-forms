import { describe, expect, it } from 'vitest'
import { z } from 'zod-v3'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v3'

/**
 * Wrapper-handling regressions for the v3 adapter — bounded peel
 * recursion, transparent peel for newer wrapper kinds, and
 * ZodCatch fallback preservation.
 *
 * The adapter is the pre-rewrite implementation; these tests guard
 * the unwrap helpers (`unwrapDefault`, `_stripRefinements`,
 * `unwrapToDiscriminatedUnion`, `peelV3Wrappers`) against pathological
 * input that previously caused a stack overflow or hang.
 */

describe('zod v3 adapter — bounded wrapper recursion', () => {
  it('does not stack-overflow on a long .refine() chain', () => {
    let schema: z.ZodTypeAny = z.string()
    for (let i = 0; i < 500; i++) {
      schema = schema.refine(() => true)
    }
    const root = z.object({ field: schema })
    // Each layer of `.refine()` produces a ZodEffects wrapper. Pre-fix
    // these recursed unbounded through `unwrapDefault` and
    // `_stripRefinements`; with a 64-step cap we now bail conservatively.
    const adapter = zodAdapter(root)('f')
    expect(() => adapter.getDefaultValues({ useDefaultSchemaValues: true })).not.toThrow()
  })

  it('honours .default() inside a moderate .refine() chain', () => {
    let schema: z.ZodTypeAny = z.string().default('seed')
    for (let i = 0; i < 16; i++) {
      schema = schema.refine(() => true)
    }
    const root = z.object({ token: schema })
    const adapter = zodAdapter(root)('f')
    const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ token: 'seed' })
  })

  it('does not hang when peeling a deep optional/nullable chain', () => {
    let schema: z.ZodTypeAny = z.string()
    for (let i = 0; i < 200; i++) {
      schema = schema.optional().nullable() as z.ZodTypeAny
    }
    const root = z.object({ chained: schema })
    const adapter = zodAdapter(root)('f')
    expect(() => adapter.getDefaultValues({ useDefaultSchemaValues: true })).not.toThrow()
  })

  it('produces a finite fingerprint for a deep optional chain', () => {
    let schema: z.ZodTypeAny = z.string()
    for (let i = 0; i < 100; i++) {
      schema = schema.optional()
    }
    const root = z.object({ deep: schema })
    const adapter = zodAdapter(root)('f')
    const fp = adapter.fingerprint()
    expect(typeof fp).toBe('string')
    expect(fp.length).toBeGreaterThan(0)
  })
})
