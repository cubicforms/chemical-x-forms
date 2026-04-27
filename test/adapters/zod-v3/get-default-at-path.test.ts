import { describe, expect, it } from 'vitest'
import { z } from 'zod-v3'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v3'

/**
 * Mirror of the v4 adapter's `get-default-at-path.test.ts`. Both adapters
 * MUST resolve the same defaults at the same paths so the runtime's
 * structural-completeness invariant holds identically across them. v3's
 * native path-walker doesn't peel wrappers, so the adapter's
 * `getDefaultAtPath` uses a separate wrapper-peeling walker
 * (`walkV3ToLeafSchema`) — these tests pin parity with v4.
 */

describe('zod v3: getDefaultAtPath', () => {
  describe('basic paths', () => {
    it('returns the form root default for empty path', () => {
      const schema = z.object({ email: z.string(), age: z.number() })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath([])).toEqual({ email: '', age: 0 })
    })

    it('returns property default for object property path', () => {
      const schema = z.object({ email: z.string(), age: z.number() })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['email'])).toBe('')
      expect(adapter.getDefaultAtPath(['age'])).toBe(0)
    })

    it('returns the .default(x) value when set', () => {
      const schema = z.object({
        role: z.string().default('user'),
        count: z.number().default(5),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['role'])).toBe('user')
      expect(adapter.getDefaultAtPath(['count'])).toBe(5)
    })

    it('returns undefined for paths that do not exist', () => {
      const schema = z.object({ email: z.string() })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['nope'])).toBeUndefined()
      expect(adapter.getDefaultAtPath(['email', 'nested'])).toBeUndefined()
    })
  })

  describe('arrays', () => {
    it('returns element default for any numeric index', () => {
      const schema = z.object({
        posts: z.array(z.object({ title: z.string(), views: z.number() })),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['posts', 0])).toEqual({ title: '', views: 0 })
      expect(adapter.getDefaultAtPath(['posts', 21])).toEqual({ title: '', views: 0 })
    })

    it('returns scalar element default for primitive arrays', () => {
      const schema = z.object({ tags: z.array(z.string()) })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['tags', 0])).toBe('')
      expect(adapter.getDefaultAtPath(['tags', 99])).toBe('')
    })

    it('returns nested defaults through array → object → array', () => {
      const schema = z.object({
        people: z.array(
          z.object({
            name: z.string(),
            addresses: z.array(z.object({ street: z.string(), zip: z.string() })),
          })
        ),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['people', 0, 'name'])).toBe('')
      expect(adapter.getDefaultAtPath(['people', 0, 'addresses', 0])).toEqual({
        street: '',
        zip: '',
      })
      expect(adapter.getDefaultAtPath(['people', 5, 'addresses', 3, 'street'])).toBe('')
    })
  })

  describe('tuples', () => {
    it('returns position-specific defaults', () => {
      const schema = z.object({
        coords: z.tuple([z.string(), z.number(), z.boolean()]),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['coords', 0])).toBe('')
      expect(adapter.getDefaultAtPath(['coords', 1])).toBe(0)
      expect(adapter.getDefaultAtPath(['coords', 2])).toBe(false)
    })

    it('returns undefined for out-of-range tuple positions', () => {
      const schema = z.object({ pair: z.tuple([z.string(), z.number()]) })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['pair', 5])).toBeUndefined()
    })
  })

  describe('wrappers (parity with v4)', () => {
    it('peels Optional and returns inner default at sub-paths', () => {
      const schema = z.object({
        profile: z.object({ name: z.string(), age: z.number() }).optional(),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['profile', 'name'])).toBe('')
      expect(adapter.getDefaultAtPath(['profile', 'age'])).toBe(0)
    })

    it('peels Nullable and returns inner default at sub-paths', () => {
      const schema = z.object({
        meta: z.object({ note: z.string() }).nullable(),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['meta', 'note'])).toBe('')
    })

    it('peels Default and reaches inner properties', () => {
      const schema = z.object({
        prefs: z.object({ theme: z.string() }).default({ theme: 'dark' }),
      })
      const adapter = zodAdapter(schema)('f')
      // Inner property: returns the primitive default ('').
      expect(adapter.getDefaultAtPath(['prefs', 'theme'])).toBe('')
      // Wrapper level: returns the .default() value.
      expect(adapter.getDefaultAtPath(['prefs'])).toEqual({ theme: 'dark' })
    })

    it('peels ZodEffects (refinements / transforms) at sub-paths', () => {
      const schema = z.object({
        validated: z.object({ name: z.string(), age: z.number() }).refine((v) => v.age >= 0),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['validated', 'name'])).toBe('')
      expect(adapter.getDefaultAtPath(['validated', 'age'])).toBe(0)
    })

    it('peels Optional at the LEAF and returns structural inner default', () => {
      const schema = z.object({
        profile: z.object({ name: z.string(), age: z.number() }).optional(),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['profile'])).toEqual({ name: '', age: 0 })
      expect(adapter.getDefaultAtPath(['profile', 'name'])).toBe('')
    })

    it('preserves Optional around a PRIMITIVE leaf — returns undefined, not the inner default', () => {
      const schema = z.object({
        notes: z.string().optional(),
        score: z.number().optional(),
        active: z.boolean().optional(),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['notes'])).toBeUndefined()
      expect(adapter.getDefaultAtPath(['score'])).toBeUndefined()
      expect(adapter.getDefaultAtPath(['active'])).toBeUndefined()
    })

    it('preserves Nullable around a PRIMITIVE leaf — returns null, not the inner default', () => {
      const schema = z.object({ name: z.string().nullable() })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['name'])).toBeNull()
    })

    it('peels Nullable around a STRUCTURAL inner — returns the inner default', () => {
      const schema = z.object({
        user: z.object({ name: z.string(), age: z.number() }).nullable(),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['user'])).toEqual({ name: '', age: 0 })
    })
  })

  describe('discriminated unions', () => {
    it('returns first variant default at the union root', () => {
      const schema = z.object({
        event: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a'), x: z.number() }),
          z.object({ kind: z.literal('b'), y: z.string() }),
        ]),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['event'])).toEqual({ kind: 'a', x: 0 })
    })

    it('descends into the matching variant for variant-specific keys', () => {
      const schema = z.object({
        event: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a'), x: z.number() }),
          z.object({ kind: z.literal('b'), y: z.string() }),
        ]),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['event', 'x'])).toBe(0)
      expect(adapter.getDefaultAtPath(['event', 'y'])).toBe('')
    })
  })

  describe('records', () => {
    it('returns the value-type default for any record key', () => {
      const schema = z.object({
        users: z.record(z.string(), z.object({ name: z.string(), age: z.number() })),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['users', 'alice'])).toEqual({ name: '', age: 0 })
      expect(adapter.getDefaultAtPath(['users', 'bob', 'name'])).toBe('')
    })
  })

  describe('cross-cutting', () => {
    it('treats non-existent paths through arrays as undefined', () => {
      const schema = z.object({
        posts: z.array(z.object({ title: z.string() })),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['posts', 0, 'nope'])).toBeUndefined()
    })

    it('returns the schema-prescribed default even for unpopulated array indices', () => {
      const schema = z.object({
        posts: z.array(z.object({ title: z.string().default('untitled') })),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['posts', 7])).toEqual({ title: 'untitled' })
    })
  })
})
