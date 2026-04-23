import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getInitialStateFromZodSchema } from '../../../src/runtime/adapters/zod-v4/initial-state'

type Options = {
  useDefaultSchemaValues?: boolean
  validationMode?: 'strict' | 'lax'
  constraints?: unknown
}

function run<T extends z.ZodObject>(schema: T, opts: Options = {}) {
  return getInitialStateFromZodSchema<z.infer<T>>({
    schema,
    useDefaultSchemaValues: opts.useDefaultSchemaValues ?? false,
    validationMode: opts.validationMode ?? 'lax',
    constraints: opts.constraints,
    formKey: 'test-form',
  })
}

describe('getInitialStateFromZodSchema — scalar defaults', () => {
  it('string → empty string', () => {
    const { data } = run(z.object({ name: z.string() }))
    expect(data.name).toBe('')
  })
  it('number → 0', () => {
    const { data } = run(z.object({ age: z.number() }))
    expect(data.age).toBe(0)
  })
  it('boolean → false', () => {
    const { data } = run(z.object({ active: z.boolean() }))
    expect(data.active).toBe(false)
  })
})

describe('getInitialStateFromZodSchema — wrappers', () => {
  it('optional → undefined', () => {
    const { data } = run(z.object({ nickname: z.string().optional() }))
    expect(data.nickname).toBeUndefined()
  })
  it('nullable → null', () => {
    const { data } = run(z.object({ maybeAge: z.number().nullable() }))
    expect(data.maybeAge).toBeNull()
  })
  it('.default() respected when useDefaultSchemaValues=true', () => {
    const { data } = run(z.object({ tier: z.string().default('free') }), {
      useDefaultSchemaValues: true,
    })
    expect(data.tier).toBe('free')
  })
  it('.default() skipped when useDefaultSchemaValues=false — leaf empty wins', () => {
    const { data } = run(z.object({ tier: z.string().default('free') }))
    expect(data.tier).toBe('')
  })
})

describe('getInitialStateFromZodSchema — containers', () => {
  it('array → []', () => {
    const { data } = run(z.object({ tags: z.array(z.string()) }))
    expect(data.tags).toEqual([])
  })
  it('tuple → [element defaults]', () => {
    const { data } = run(z.object({ coord: z.tuple([z.string(), z.number()]) }))
    expect(data.coord).toEqual(['', 0])
  })
  it('nested object → recursive defaults', () => {
    const { data } = run(
      z.object({
        user: z.object({
          name: z.string(),
          age: z.number(),
        }),
      })
    )
    expect(data.user).toEqual({ name: '', age: 0 })
  })
})

describe('getInitialStateFromZodSchema — discriminated unions', () => {
  it('produces first-option defaults (not an empty object)', () => {
    const schema = z.object({
      status: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('success'), value: z.string() }),
        z.object({ kind: z.literal('error'), message: z.string() }),
      ]),
    })
    const { data } = run(schema)
    // First option has 'success' literal for kind; v4 literals return their value.
    expect((data.status as { kind: string }).kind).toBe('success')
    expect((data.status as { value: string }).value).toBe('')
  })
})

describe('getInitialStateFromZodSchema — refinement-heavy schemas', () => {
  it('lax mode: email refinement passes (walker returns "")', () => {
    const schema = z.object({ email: z.string().email() })
    const { data, success } = run(schema, { validationMode: 'lax' })
    expect(data.email).toBe('')
    expect(success).toBe(true)
  })

  it('strict mode: email refinement fails because "" is not an email', () => {
    const schema = z.object({ email: z.string().email() })
    const { success } = run(schema, { validationMode: 'strict' })
    expect(success).toBe(false)
  })
})

describe('getInitialStateFromZodSchema — constraints', () => {
  it('constraints override walker defaults (shallow)', () => {
    const schema = z.object({ name: z.string(), age: z.number() })
    const { data } = run(schema, { constraints: { name: 'alice' } })
    expect(data.name).toBe('alice')
    expect(data.age).toBe(0)
  })

  it('constraints merge deeply into nested objects', () => {
    const schema = z.object({
      profile: z.object({ name: z.string(), bio: z.string() }),
    })
    const { data } = run(schema, {
      constraints: { profile: { name: 'alice' } },
    })
    expect(data.profile).toEqual({ name: 'alice', bio: '' })
  })
})

describe('getInitialStateFromZodSchema — validate-then-fix recovery', () => {
  it('succeeds in lax mode even with unusual leaf types', () => {
    const schema = z.object({
      enumField: z.enum(['red', 'green', 'blue']),
      literalField: z.literal('fixed'),
    })
    const { data, success } = run(schema, { validationMode: 'lax' })
    expect(data.enumField).toBe('red')
    expect(data.literalField).toBe('fixed')
    expect(success).toBe(true)
  })
})
