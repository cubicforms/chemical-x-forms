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

describe('zod v3 adapter — transparent wrapper kinds', () => {
  it('produces a default for a ZodReadonly leaf', () => {
    const schema = z.object({
      handle: z.string().readonly(),
      count: z.number().readonly(),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ handle: '', count: 0 })
  })

  it('produces a default for a ZodBranded leaf', () => {
    const schema = z.object({
      id: z.string().brand<'Id'>(),
      seq: z.number().brand<'Seq'>(),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ id: '', seq: 0 })
  })

  it('produces a default for a ZodPipeline (uses input schema)', () => {
    const schema = z.object({
      email: z.string().pipe(z.string().email()),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
    // Input schema default (pre-transform) is `''` — `email` validation
    // would reject it but the slim-parse rebuilds a checks-free copy
    // for default extraction.
    expect(result.success).toBe(true)
    expect((result.data as { email: string }).email).toBe('')
  })

  it('honours .default() through a ZodReadonly wrapper', () => {
    const schema = z.object({
      role: z.string().default('user').readonly(),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
    expect(result.data).toEqual({ role: 'user' })
  })

  it('honours .default() through a ZodBranded wrapper', () => {
    const schema = z.object({
      handle: z.string().default('anon').brand<'Handle'>(),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
    expect(result.data).toEqual({ handle: 'anon' })
  })

  it('walks getDefaultAtPath through a ZodPipeline + ZodReadonly chain', () => {
    const schema = z.object({
      profile: z
        .object({
          name: z.string().default('Ada'),
        })
        .readonly(),
    })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.getDefaultAtPath(['profile', 'name'])).toBe('Ada')
  })
})

describe('zod v3 adapter — ZodCatch fallback', () => {
  it('produces the caught fallback as the construction-time default', () => {
    const schema = z.object({
      handle: z.string().catch('anonymous'),
      count: z.number().catch(42),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ handle: 'anonymous', count: 42 })
  })

  it('honours .catch() over .default() when both are present', () => {
    // `.catch()` is the more emphatic statement: it replaces ANY parse
    // failure, where `.default()` only fires for `undefined`. The
    // adapter's order of checks (catch before default-recursion) gives
    // the catch precedence at the level where it sits in the wrapper
    // chain.
    const schema = z.object({
      role: z.string().default('user').catch('guest'),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
    expect(result.data).toEqual({ role: 'guest' })
  })

  it('surfaces the catch fallback even when useDefaultSchemaValues is false', () => {
    const schema = z.object({
      handle: z.string().catch('anonymous'),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getDefaultValues({ useDefaultSchemaValues: false })
    // .catch() is an explicit consumer statement; suppressing schema
    // defaults shouldn't suppress it.
    expect((result.data as { handle: string }).handle).toBe('anonymous')
  })

  it('walks getDefaultAtPath through a ZodCatch on an object', () => {
    const schema = z.object({
      profile: z
        .object({
          name: z.string().default('Ada'),
        })
        .catch({ name: 'fallback' }),
    })
    const adapter = zodAdapter(schema)('f')
    // Catch's fallback object IS the default at that path.
    expect(adapter.getDefaultAtPath(['profile'])).toEqual({ name: 'fallback' })
  })
})

describe('zod v3 adapter — symbol-segment coercion in ValidationError.path', () => {
  it('coerces a Symbol path segment to a string at validateAtPath', async () => {
    const symbolKey = Symbol('weird')
    // A custom check that emits a Symbol path segment. v3 issue paths
    // are typed `(string | number)[]` but the runtime allows custom
    // checks to push anything via `ctx.addIssue`.
    const schema = z.object({
      handle: z.string().superRefine((value, ctx) => {
        if (value.length === 0) {
          ctx.addIssue({
            // Using `as never` to pass the Symbol past the type check —
            // this mimics what a misbehaving custom check would do.
            path: [symbolKey as never],
            code: z.ZodIssueCode.custom,
            message: 'symbol path',
          })
        }
      }),
    })
    const adapter = zodAdapter(schema)('f')
    const result = await adapter.validateAtPath({ handle: '' }, [])
    expect(result.success).toBe(false)
    if (result.success) return
    // Every segment in every emitted error must be string|number; never
    // a Symbol. The contract is that `ValidationError.path` matches its
    // declared type at runtime.
    for (const err of result.errors) {
      for (const seg of err.path) {
        expect(typeof seg).toMatch(/string|number/)
      }
    }
  })
})
