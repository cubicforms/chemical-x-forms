import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v4'

describe('zod v4 adapter', () => {
  describe('getDefaultValues', () => {
    it('produces defaults for a basic object schema', () => {
      const schema = z.object({
        email: z.string(),
        age: z.number(),
        active: z.boolean(),
      })
      const adapter = zodAdapter(schema)('f')
      const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ email: '', age: 0, active: false })
    })

    it('honors .default() values', () => {
      const schema = z.object({
        role: z.string().default('user'),
        count: z.number().default(5),
      })
      const adapter = zodAdapter(schema)('f')
      const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
      expect(result.data).toEqual({ role: 'user', count: 5 })
    })

    it('optional fields default to undefined', () => {
      const schema = z.object({
        email: z.string(),
        nickname: z.string().optional(),
      })
      const adapter = zodAdapter(schema)('f')
      const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
      expect(result.data).toEqual({ email: '', nickname: undefined })
    })

    it('nullable fields default to null', () => {
      const schema = z.object({ profile: z.string().nullable() })
      const adapter = zodAdapter(schema)('f')
      const result = adapter.getDefaultValues({ useDefaultSchemaValues: true })
      expect(result.data).toEqual({ profile: null })
    })

    it('arrays default to empty', () => {
      const schema = z.object({ tags: z.array(z.string()) })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultValues({ useDefaultSchemaValues: true }).data).toEqual({ tags: [] })
    })

    it('enums default to the first value', () => {
      const schema = z.object({ color: z.enum(['red', 'green', 'blue']) })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultValues({ useDefaultSchemaValues: true }).data).toEqual({
        color: 'red',
      })
    })

    it('literal fields default to the literal value', () => {
      const schema = z.object({ kind: z.literal('user') })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultValues({ useDefaultSchemaValues: true }).data).toEqual({
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
      expect(adapter.getDefaultValues({ useDefaultSchemaValues: true }).data).toEqual({
        profile: { name: '', age: 0 },
      })
    })

    it('merges constraints over defaults', () => {
      const schema = z.object({
        email: z.string(),
        count: z.number(),
      })
      const adapter = zodAdapter(schema)('f')
      const result = adapter.getDefaultValues({
        useDefaultSchemaValues: true,
        constraints: { email: 'seeded@x' },
      })
      expect(result.data).toEqual({ email: 'seeded@x', count: 0 })
    })
  })

  describe('validateAtPath', () => {
    it('returns success for a valid full-form value', async () => {
      const schema = z.object({ email: z.email() })
      const adapter = zodAdapter(schema)('f')
      const result = await adapter.validateAtPath({ email: 'a@b.co' }, undefined)
      expect(result.success).toBe(true)
    })

    it('returns ValidationError[] for invalid input', async () => {
      const schema = z.object({ email: z.email() })
      const adapter = zodAdapter(schema)('f')
      const result = await adapter.validateAtPath({ email: 'not-an-email' }, undefined)
      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors?.[0]?.path).toEqual(['email'])
    })

    it('validates at a specific path', async () => {
      const schema = z.object({ email: z.email(), name: z.string() })
      const adapter = zodAdapter(schema)('f')
      const good = await adapter.validateAtPath('a@b.co', ['email'])
      expect(good.success).toBe(true)
      const bad = await adapter.validateAtPath('nope', ['email'])
      expect(bad.success).toBe(false)
    })
  })

  describe('getSchemasAtPath', () => {
    it('resolves a nested path', async () => {
      const schema = z.object({
        user: z.object({ email: z.string() }),
      })
      const adapter = zodAdapter(schema)('f')
      const schemas = adapter.getSchemasAtPath(['user', 'email'])
      expect(schemas).toHaveLength(1)
      // Validate that the resolved schema is the inner string schema.
      expect((await schemas[0]?.validateAtPath('hi', undefined))?.success).toBe(true)
      expect((await schemas[0]?.validateAtPath(42, undefined))?.success).toBe(false)
    })

    it('returns empty for a non-existent path', () => {
      const schema = z.object({ a: z.string() })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getSchemasAtPath(['b'])).toHaveLength(0)
    })

    it('descends through arrays by index', () => {
      const schema = z.object({ items: z.array(z.object({ name: z.string() })) })
      const adapter = zodAdapter(schema)('f')
      const schemas = adapter.getSchemasAtPath(['items', 0, 'name'])
      expect(schemas).toHaveLength(1)
    })

    it('distinguishes a literal-dot key from a sibling pair', async () => {
      // The structured path `['user.name']` — a top-level key containing
      // a literal `.` — must NOT collide with `['user', 'name']`. Before
      // the AbstractSchema widening both collapsed to the same dotted
      // string and the walker resolved whichever branch was first. We
      // probe each resolved sub-schema with data the OTHER branch would
      // reject to prove the disambiguation landed.
      const schema = z.object({
        'user.name': z.number(),
        user: z.object({ name: z.string() }),
      })
      const adapter = zodAdapter(schema)('f')
      const literalKey = adapter.getSchemasAtPath(['user.name'])
      const siblingPair = adapter.getSchemasAtPath(['user', 'name'])
      expect(literalKey).toHaveLength(1)
      expect(siblingPair).toHaveLength(1)
      // The literal-dot branch should accept a number and reject a string.
      expect((await literalKey[0]?.validateAtPath(42, undefined))?.success).toBe(true)
      expect((await literalKey[0]?.validateAtPath('forty-two', undefined))?.success).toBe(false)
      // The sibling-pair branch is the opposite: string good, number bad.
      expect((await siblingPair[0]?.validateAtPath('alice', undefined))?.success).toBe(true)
      expect((await siblingPair[0]?.validateAtPath(42, undefined))?.success).toBe(false)
    })
  })
})
