import { describe, expect, it } from 'vitest'
import {
  mergeStructural,
  setAtPathWithSchemaFill,
  type SchemaForFill,
} from '../../src/runtime/core/path-walker'
import type { Path } from '../../src/runtime/core/paths'

/**
 * Unit tests for the structural-completeness helpers in path-walker.ts.
 * The full integration with `setValueAtPath` is covered by
 * `test/composables/set-value-schema-fill-regression.test.ts`; this
 * file pins the helpers' lower-level contracts.
 */

/**
 * Schema-stub builder. Defines a literal "default at path" map; any
 * other path returns undefined. For arrays, returning element defaults
 * at indices 0..big simulates a Zod array; returning per-position
 * values at exactly N indices simulates a Zod tuple of length N.
 */
function buildSchema(
  defaults: Record<string, unknown>,
  options?: { arrayElementDefault?: unknown; tupleAt?: Record<string, readonly unknown[]> }
): SchemaForFill {
  return {
    getDefaultAtPath(path: Path): unknown {
      if (path.length === 0) {
        // Combine top-level keys into a single defaults object.
        const root: Record<string, unknown> = {}
        for (const key of Object.keys(defaults)) {
          root[key] = defaults[key]
        }
        if (options?.tupleAt) {
          for (const tupleKey of Object.keys(options.tupleAt)) {
            root[tupleKey] = options.tupleAt[tupleKey]
          }
        }
        return root
      }
      // Tuple lookup: tuple[index] for paths of form [tupleKey, idx].
      if (options?.tupleAt && path.length === 2) {
        const [tupleKey, idx] = path
        if (typeof tupleKey === 'string' && typeof idx === 'number') {
          const tuple = options.tupleAt[tupleKey]
          if (tuple !== undefined) {
            return idx < tuple.length ? tuple[idx] : undefined
          }
        }
      }
      // Array element default: any path through an array key returns
      // the configured element default.
      if (options?.arrayElementDefault !== undefined) {
        const [first] = path
        if (typeof first === 'string' && first === 'arr') {
          return options.arrayElementDefault
        }
      }
      // Object lookup.
      const head = path[0]
      if (typeof head !== 'string') return undefined
      const next = defaults[head]
      if (path.length === 1) return next
      if (next === null || typeof next !== 'object' || Array.isArray(next)) return undefined
      let current: unknown = next
      for (let i = 1; i < path.length; i++) {
        if (current === null || typeof current !== 'object' || Array.isArray(current)) {
          return undefined
        }
        const seg = path[i]
        const key = typeof seg === 'number' ? String(seg) : seg
        current = (current as Record<string, unknown>)[key as string]
      }
      return current
    },
  }
}

describe('mergeStructural', () => {
  describe('primitives', () => {
    it('passes through consumer primitives unchanged', () => {
      const schema = buildSchema({ name: '' })
      expect(mergeStructural(schema, ['name'], 'alice')).toBe('alice')
      expect(mergeStructural(schema, ['name'], 0)).toBe(0)
      expect(mergeStructural(schema, ['name'], false)).toBe(false)
    })

    it('treats undefined consumer as missing — falls back to default', () => {
      const schema = buildSchema({ name: 'fallback' })
      expect(mergeStructural(schema, ['name'], undefined)).toBe('fallback')
    })

    it('treats null consumer as a deliberate value — null wins', () => {
      const schema = buildSchema({ name: '' })
      expect(mergeStructural(schema, ['name'], null)).toBeNull()
    })
  })

  describe('plain objects', () => {
    it('fills missing keys from default', () => {
      const schema = buildSchema({ user: { name: '', age: 0 } })
      const result = mergeStructural(schema, [], { user: { name: 'alice' } })
      expect(result).toEqual({ user: { name: 'alice', age: 0 } })
    })

    it('preserves consumer-only keys (validation flags them)', () => {
      const schema = buildSchema({ user: { name: '' } })
      const result = mergeStructural(schema, [], {
        user: { name: 'alice', extra: 'foo' },
      })
      expect(result).toEqual({ user: { name: 'alice', extra: 'foo' } })
    })

    it('idempotent short-circuit — returns input ref when no fills needed', () => {
      const schema = buildSchema({ user: { name: '' } })
      const consumer = { user: { name: 'alice' } }
      const result = mergeStructural(schema, [], consumer)
      expect(result).toBe(consumer)
    })

    it('handles deeply nested partial objects', () => {
      const schema = buildSchema({
        user: { profile: { name: '', age: 0, bio: '' } },
      })
      const result = mergeStructural(schema, [], {
        user: { profile: { name: 'carol' } },
      })
      expect(result).toEqual({
        user: { profile: { name: 'carol', age: 0, bio: '' } },
      })
    })
  })

  describe('arrays — unbounded (array-like)', () => {
    it('uses consumer length, fills nothing when probe returns element default', () => {
      const schema = buildSchema({ arr: [] }, { arrayElementDefault: 'def' })
      const result = mergeStructural(schema, ['arr'], ['a', 'b'])
      expect(result).toEqual(['a', 'b'])
    })

    it('passes through empty consumer arrays as-is', () => {
      const schema = buildSchema({ arr: [] }, { arrayElementDefault: 'def' })
      const consumer: unknown[] = []
      const result = mergeStructural(schema, ['arr'], consumer)
      expect(result).toBe(consumer)
    })
  })

  describe('arrays — tuple-like (fixed length)', () => {
    it('pads consumer up to tuple length with position defaults', () => {
      const schema = buildSchema({}, { tupleAt: { coords: [0, 0, 0] } })
      const result = mergeStructural(schema, ['coords'], [42])
      expect(result).toEqual([42, 0, 0])
    })

    it('preserves consumer values at provided positions', () => {
      const schema = buildSchema({}, { tupleAt: { coords: ['', 0, false] } })
      const result = mergeStructural(schema, ['coords'], ['x'])
      expect(result).toEqual(['x', 0, false])
    })
  })

  describe('non-plain-objects (Date, Map, Set)', () => {
    it('Date passes through (not recursed into)', () => {
      const schema = buildSchema({ when: new Date(0) })
      const date = new Date(2024, 5, 1)
      const result = mergeStructural(schema, ['when'], date)
      expect(result).toBe(date)
    })

    it('Map passes through', () => {
      const schema = buildSchema({ m: new Map() })
      const m = new Map([['k', 'v']])
      const result = mergeStructural(schema, ['m'], m)
      expect(result).toBe(m)
    })

    it('Set passes through', () => {
      const schema = buildSchema({ s: new Set() })
      const s = new Set([1, 2, 3])
      const result = mergeStructural(schema, ['s'], s)
      expect(result).toBe(s)
    })
  })
})

describe('setAtPathWithSchemaFill', () => {
  it('writes to an existing slot without schema lookups', () => {
    const schema = buildSchema({ user: { name: '' } })
    const root = { user: { name: 'alice' } }
    const next = setAtPathWithSchemaFill(root, schema, ['user', 'name'], 'bob')
    expect(next).toEqual({ user: { name: 'bob' } })
  })

  it('fills missing intermediate object with schema default', () => {
    const schema = buildSchema({
      user: { profile: { name: '', age: 0 } },
    })
    const root = { user: {} }
    const next = setAtPathWithSchemaFill(root, schema, ['user', 'profile', 'name'], 'carol')
    expect(next).toEqual({ user: { profile: { name: 'carol', age: 0 } } })
  })

  it('pads array past length with element defaults (array case)', () => {
    const schema = buildSchema({ arr: [] }, { arrayElementDefault: 'def' })
    const root = { arr: ['a'] }
    const next = setAtPathWithSchemaFill(root, schema, ['arr', 3], 'x')
    expect(next).toEqual({ arr: ['a', 'def', 'def', 'x'] })
  })

  it('pads tuple past length with per-position defaults', () => {
    const schema = buildSchema({}, { tupleAt: { coords: [0, 0, 0] } })
    const root = { coords: [42] }
    const next = setAtPathWithSchemaFill(root, schema, ['coords', 2], 99)
    expect(next).toEqual({ coords: [42, 0, 99] })
  })

  it('returns the value unchanged when path is empty', () => {
    const schema = buildSchema({})
    const next = setAtPathWithSchemaFill({ a: 1 }, schema, [], { b: 2 })
    expect(next).toEqual({ b: 2 })
  })
})
