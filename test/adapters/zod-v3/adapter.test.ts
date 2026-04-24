import { describe, expect, it } from 'vitest'
import { z } from 'zod-v3'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v3'

/**
 * The v3 adapter is the pre-rewrite implementation moved verbatim in
 * Phase 4a. It was previously only exercised through `test/ssr.test.ts`
 * (Nuxt fixture). This file is the v3's unit-test counterpart to the
 * v4 suite under `test/adapters/zod-v4/`, covering the `AbstractSchema`
 * contract directly so regressions in shared zod behaviour surface
 * without a full Nuxt build.
 */

describe('zod v3 adapter — getInitialState', () => {
  it('produces defaults for a basic object schema', () => {
    const schema = z.object({
      email: z.string(),
      age: z.number(),
      active: z.boolean(),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getInitialState({ useDefaultSchemaValues: true })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ email: '', age: 0, active: false })
  })

  it('honours .default() values', () => {
    const schema = z.object({
      role: z.string().default('user'),
      count: z.number().default(5),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getInitialState({ useDefaultSchemaValues: true })
    expect(result.data).toEqual({ role: 'user', count: 5 })
  })

  it('optional fields default to undefined', () => {
    const schema = z.object({
      email: z.string(),
      nickname: z.string().optional(),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getInitialState({ useDefaultSchemaValues: true })
    expect(result.data).toEqual({ email: '', nickname: undefined })
  })

  it('nullable fields default to null', () => {
    const schema = z.object({ profile: z.string().nullable() })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getInitialState({ useDefaultSchemaValues: true })
    expect(result.data).toEqual({ profile: null })
  })

  it('arrays default to empty', () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.getInitialState({ useDefaultSchemaValues: true }).data).toEqual({ tags: [] })
  })

  it('enums default to the first value', () => {
    const schema = z.object({ color: z.enum(['red', 'green', 'blue']) })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.getInitialState({ useDefaultSchemaValues: true }).data).toEqual({
      color: 'red',
    })
  })

  it('literal fields default to the literal value', () => {
    const schema = z.object({ kind: z.literal('user') })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.getInitialState({ useDefaultSchemaValues: true }).data).toEqual({
      kind: 'user',
    })
  })

  it('nested objects are walked recursively', () => {
    const schema = z.object({
      profile: z.object({
        name: z.string(),
        age: z.number(),
      }),
    })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.getInitialState({ useDefaultSchemaValues: true }).data).toEqual({
      profile: { name: '', age: 0 },
    })
  })

  it('merges constraints over defaults', () => {
    const schema = z.object({
      email: z.string(),
      count: z.number(),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getInitialState({
      useDefaultSchemaValues: true,
      constraints: { email: 'seeded@x' },
    })
    expect(result.data).toEqual({ email: 'seeded@x', count: 0 })
  })

  it('tuples default to their per-position empties', () => {
    const schema = z.object({
      point: z.tuple([z.number(), z.number()]),
    })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.getInitialState({ useDefaultSchemaValues: true }).data).toEqual({
      point: [0, 0],
    })
  })

  it('discriminated unions pick the first option as the default', () => {
    const schema = z.object({
      event: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('click'), x: z.number() }),
        z.object({ kind: z.literal('scroll'), delta: z.number() }),
      ]),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.getInitialState({ useDefaultSchemaValues: true })
    expect(result.data).toEqual({ event: { kind: 'click', x: 0 } })
  })
})

describe('zod v3 adapter — validateAtPath', () => {
  it('returns success for a valid full-form value', async () => {
    const schema = z.object({ email: z.string().email() })
    const adapter = zodAdapter(schema)('f')
    const result = await adapter.validateAtPath({ email: 'a@b.co' }, undefined)
    expect(result.success).toBe(true)
  })

  it('returns ValidationError[] for invalid input with the leaf path', async () => {
    const schema = z.object({ email: z.string().email() })
    const adapter = zodAdapter(schema)('f')
    const result = await adapter.validateAtPath({ email: 'not-an-email' }, undefined)
    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors?.[0]?.path).toEqual(['email'])
  })

  it('validates at a specific path', async () => {
    const schema = z.object({ email: z.string().email(), name: z.string() })
    const adapter = zodAdapter(schema)('f')
    const good = await adapter.validateAtPath('a@b.co', ['email'])
    expect(good.success).toBe(true)
    const bad = await adapter.validateAtPath('nope', ['email'])
    expect(bad.success).toBe(false)
  })

  it('descends into arrays by numeric segment', async () => {
    const schema = z.object({
      items: z.array(z.object({ name: z.string().min(1) })),
    })
    const adapter = zodAdapter(schema)('f')
    const bad = await adapter.validateAtPath({ items: [{ name: 'ok' }, { name: '' }] }, undefined)
    expect(bad.success).toBe(false)
    const badEntry = bad.errors?.find((e) => e.path.includes('name'))
    expect(badEntry).toBeDefined()
  })
})

describe('zod v3 adapter — getSchemasAtPath', () => {
  it('resolves a nested path', async () => {
    const schema = z.object({
      user: z.object({ email: z.string() }),
    })
    const adapter = zodAdapter(schema)('f')
    const schemas = adapter.getSchemasAtPath(['user', 'email'])
    expect(schemas.length).toBeGreaterThan(0)
    expect((await schemas[0]?.validateAtPath('hi', undefined))?.success).toBe(true)
    expect((await schemas[0]?.validateAtPath(42, undefined))?.success).toBe(false)
  })

  it('descends through arrays by index', () => {
    const schema = z.object({ items: z.array(z.object({ name: z.string() })) })
    const adapter = zodAdapter(schema)('f')
    const schemas = adapter.getSchemasAtPath(['items', 0, 'name'])
    expect(schemas.length).toBeGreaterThan(0)
  })

  it('returns empty for a non-existent path', () => {
    const schema = z.object({ a: z.string() })
    const adapter = zodAdapter(schema)('f')
    expect(adapter.getSchemasAtPath(['b'])).toHaveLength(0)
  })
})

describe('zod v3 adapter — validator error paths (refine / superRefine / transform / pipe)', () => {
  it('leaf .refine emits error at the leaf path', async () => {
    const schema = z.object({
      username: z.string().refine((v) => v.length > 3, 'too short'),
    })
    const adapter = zodAdapter(schema)('f')
    const result = await adapter.validateAtPath({ username: 'ab' }, undefined)
    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors?.[0]?.path).toEqual(['username'])
    expect(result.errors?.[0]?.message).toBe('too short')
  })

  it('.refine with explicit path redirects the error', async () => {
    const schema = z
      .object({
        password: z.string(),
        confirm: z.string(),
      })
      .refine((v) => v.password === v.confirm, {
        message: 'passwords differ',
        path: ['confirm'],
      })
    const adapter = zodAdapter(schema)('f')
    const result = await adapter.validateAtPath({ password: 'abc', confirm: 'xyz' }, undefined)
    expect(result.success).toBe(false)
    expect(result.errors?.[0]?.path).toEqual(['confirm'])
  })

  it('.superRefine preserves the issue path it sets', async () => {
    const schema = z.object({
      items: z.array(z.object({ name: z.string() })).superRefine((items, ctx) => {
        items.forEach((it, i) => {
          if (it.name.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [i, 'name'],
              message: 'name required',
            })
          }
        })
      }),
    })
    const adapter = zodAdapter(schema)('f')
    const result = await adapter.validateAtPath({ items: [{ name: 'a' }, { name: '' }] }, undefined)
    expect(result.success).toBe(false)
    const customPath = result.errors?.find((e) => e.message === 'name required')?.path
    expect(customPath).toEqual(['items', 1, 'name'])
  })

  it('.transform yields the transformed shape on success', async () => {
    const schema = z.object({
      email: z.string().transform((v) => v.trim().toLowerCase()),
    })
    const adapter = zodAdapter(schema)('f')
    const result = await adapter.validateAtPath({ email: '  HI@X.CO  ' }, undefined)
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ email: 'hi@x.co' })
  })

  it('.pipe success preserves the parsed-through value', async () => {
    const schema = z.object({
      ageStr: z
        .string()
        .transform((s) => Number(s))
        .pipe(z.number()),
    })
    const adapter = zodAdapter(schema)('f')
    const ok = await adapter.validateAtPath({ ageStr: '42' }, undefined)
    expect(ok.success).toBe(true)
    expect(ok.data).toEqual({ ageStr: 42 })
  })
})

describe('zod v3 adapter — discriminated union routing', () => {
  it('routes per-branch refinement errors to the active branch', async () => {
    const schema = z.object({
      event: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('click'),
          x: z.number().refine((v) => v >= 0, 'x must be non-negative'),
        }),
        z.object({ kind: z.literal('scroll'), delta: z.number() }),
      ]),
    })
    const adapter = zodAdapter(schema)('f')
    const result = await adapter.validateAtPath({ event: { kind: 'click', x: -1 } }, undefined)
    expect(result.success).toBe(false)
    const match = result.errors?.some(
      (e) =>
        e.path.length === 2 &&
        e.path[0] === 'event' &&
        e.path[1] === 'x' &&
        e.message === 'x must be non-negative'
    )
    expect(match).toBe(true)
  })
})
