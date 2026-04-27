import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v4'

/**
 * Adapter-level tests for `getDefaultAtPath`. The runtime structural-
 * completeness invariant fills missing slots in the form via this method,
 * so its semantics need to be uniform across adapters and stable across
 * common Zod shapes (objects, arrays, tuples, wrappers, unions).
 */

describe('zod v4: getDefaultAtPath', () => {
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
    it('returns element default for any numeric index (the array is element-uniform)', () => {
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

  describe('wrappers', () => {
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

    it('peels Default and returns inner default at sub-paths', () => {
      const schema = z.object({
        prefs: z.object({ theme: z.string() }).default({ theme: 'dark' }),
      })
      const adapter = zodAdapter(schema)('f')
      // The leaf inside the .default is unwrapped; theme as a property
      // returns its primitive default. The .default value applies at the
      // wrapper level (path ['prefs']), not below it.
      expect(adapter.getDefaultAtPath(['prefs', 'theme'])).toBe('')
      // At the wrapper level itself, the .default value applies.
      expect(adapter.getDefaultAtPath(['prefs'])).toEqual({ theme: 'dark' })
    })

    it('peels Optional at the LEAF and returns structural inner default', () => {
      // The runtime uses this to fill partial writes through optional
      // sub-schemas: `setValue('user.profile', { name: 'Carol' })` against
      // `profile: z.object({...}).optional()` needs the inner default
      // `{ name: '', age: 0 }` to fill missing keys.
      const schema = z.object({
        profile: z.object({ name: z.string(), age: z.number() }).optional(),
      })
      const adapter = zodAdapter(schema)('f')
      // Structural default at the wrapper level: inner shape's default.
      expect(adapter.getDefaultAtPath(['profile'])).toEqual({ name: '', age: 0 })
      // Sub-paths also resolve through the wrapper.
      expect(adapter.getDefaultAtPath(['profile', 'name'])).toBe('')
    })

    it('peels Nullable at the LEAF and returns structural inner default', () => {
      const schema = z.object({ name: z.string().nullable() })
      const adapter = zodAdapter(schema)('f')
      // Structural default: '' (slim view), not null.
      expect(adapter.getDefaultAtPath(['name'])).toBe('')
    })

    it('preserves .default(x) at wrapper level — not peeled', () => {
      // `.default(x)` is the explicit "fresh" value; it stays.
      const schema = z.object({
        prefs: z.object({ theme: z.string() }).default({ theme: 'dark' }),
      })
      const adapter = zodAdapter(schema)('f')
      expect(adapter.getDefaultAtPath(['prefs'])).toEqual({ theme: 'dark' })
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
      // 'nope' isn't in the post shape.
      expect(adapter.getDefaultAtPath(['posts', 0, 'nope'])).toBeUndefined()
    })

    it('returns the schema-prescribed default even for unpopulated array indices', () => {
      // The runtime needs this to fill posts[0..N-1] when consumer writes
      // to posts[N] against an empty array — the schema must answer
      // "what's the element default at index 0?" identically for any N.
      const schema = z.object({
        posts: z.array(z.object({ title: z.string().default('untitled') })),
      })
      const adapter = zodAdapter(schema)('f')
      const def = adapter.getDefaultAtPath(['posts', 7])
      expect(def).toEqual({ title: 'untitled' })
    })
  })
})
