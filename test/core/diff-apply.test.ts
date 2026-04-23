import { describe, expect, it } from 'vitest'
import { diffAndApply, type Patch } from '../../src/runtime/core/diff-apply'

function collect(oldValue: unknown, newValue: unknown): Patch[] {
  const patches: Patch[] = []
  diffAndApply(oldValue, newValue, [], (p) => patches.push(p))
  return patches
}

describe('diffAndApply', () => {
  describe('no-op cases', () => {
    it('identical primitives emit no patches', () => {
      expect(collect(1, 1)).toEqual([])
      expect(collect('x', 'x')).toEqual([])
      expect(collect(null, null)).toEqual([])
      expect(collect(undefined, undefined)).toEqual([])
    })

    it('same object reference emits no patches', () => {
      const o = { a: 1 }
      expect(collect(o, o)).toEqual([])
    })

    it('structurally equal objects but different refs still emit patches only where leaves differ', () => {
      // New object ref but identical leaves: Object.is catches the top-level
      // mismatch, recursion into children finds equality per-leaf.
      expect(collect({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([])
    })

    it('NaN === NaN is handled via Object.is (no patch)', () => {
      expect(collect(NaN, NaN)).toEqual([])
    })

    it('+0 vs -0 is detected (Object.is distinguishes them)', () => {
      const patches = collect(0, -0)
      expect(patches).toHaveLength(1)
      expect(patches[0]?.kind).toBe('changed')
    })
  })

  describe('leaf changes', () => {
    it('primitive → different primitive emits one changed patch at root', () => {
      expect(collect(1, 2)).toEqual([{ kind: 'changed', path: [], oldValue: 1, newValue: 2 }])
    })

    it('undefined → value emits an added patch', () => {
      expect(collect(undefined, 'hi')).toEqual([{ kind: 'added', path: [], newValue: 'hi' }])
    })

    it('value → undefined emits a removed patch', () => {
      expect(collect('bye', undefined)).toEqual([{ kind: 'removed', path: [], oldValue: 'bye' }])
    })

    it('null → value emits a changed patch (null is a leaf, not missing)', () => {
      expect(collect(null, 'hi')).toEqual([
        { kind: 'changed', path: [], oldValue: null, newValue: 'hi' },
      ])
    })
  })

  describe('nested object diffing', () => {
    it('changes a single nested leaf', () => {
      const patches = collect({ user: { name: 'a', age: 30 } }, { user: { name: 'b', age: 30 } })
      expect(patches).toEqual([
        { kind: 'changed', path: ['user', 'name'], oldValue: 'a', newValue: 'b' },
      ])
    })

    it('adds a new key', () => {
      const patches = collect({ a: 1 }, { a: 1, b: 2 })
      expect(patches).toEqual([{ kind: 'added', path: ['b'], newValue: 2 }])
    })

    it('removes a key', () => {
      const patches = collect({ a: 1, b: 2 }, { a: 1 })
      expect(patches).toEqual([{ kind: 'removed', path: ['b'], oldValue: 2 }])
    })

    it('handles multiple simultaneous changes deep in the tree', () => {
      const patches = collect(
        { user: { name: 'a', contact: { email: 'a@a' } }, count: 1 },
        { user: { name: 'b', contact: { email: 'b@b' } }, count: 1 }
      )
      expect(patches).toContainEqual({
        kind: 'changed',
        path: ['user', 'name'],
        oldValue: 'a',
        newValue: 'b',
      })
      expect(patches).toContainEqual({
        kind: 'changed',
        path: ['user', 'contact', 'email'],
        oldValue: 'a@a',
        newValue: 'b@b',
      })
      expect(patches).toHaveLength(2)
    })
  })

  describe('array diffing', () => {
    it('changes an element in place', () => {
      const patches = collect([1, 2, 3], [1, 9, 3])
      expect(patches).toEqual([{ kind: 'changed', path: [1], oldValue: 2, newValue: 9 }])
    })

    it('adds elements at the end (new length > old length)', () => {
      const patches = collect([1, 2], [1, 2, 3, 4])
      expect(patches).toEqual([
        { kind: 'added', path: [2], newValue: 3 },
        { kind: 'added', path: [3], newValue: 4 },
      ])
    })

    it('removes elements at the end (new length < old length)', () => {
      const patches = collect([1, 2, 3, 4], [1, 2])
      expect(patches).toEqual([
        { kind: 'removed', path: [2], oldValue: 3 },
        { kind: 'removed', path: [3], oldValue: 4 },
      ])
    })

    it('descends into nested objects within arrays', () => {
      const patches = collect(
        [{ id: 1, name: 'a' }, { id: 2 }],
        [
          { id: 1, name: 'a' },
          { id: 2, name: 'b' },
        ]
      )
      expect(patches).toEqual([{ kind: 'added', path: [1, 'name'], newValue: 'b' }])
    })
  })

  describe('shape transitions', () => {
    it('object → array emits a single changed patch (full replacement)', () => {
      const patches = collect({ a: 1 }, [1, 2])
      expect(patches).toEqual([{ kind: 'changed', path: [], oldValue: { a: 1 }, newValue: [1, 2] }])
    })

    it('array → object emits a single changed patch', () => {
      const patches = collect([1, 2], { a: 1 })
      expect(patches).toEqual([{ kind: 'changed', path: [], oldValue: [1, 2], newValue: { a: 1 } }])
    })

    it('object → primitive emits a single changed patch', () => {
      const patches = collect({ a: 1 }, 'leaf')
      expect(patches).toEqual([{ kind: 'changed', path: [], oldValue: { a: 1 }, newValue: 'leaf' }])
    })

    it('primitive → object emits a single changed patch', () => {
      const patches = collect(42, { a: 1 })
      expect(patches).toEqual([{ kind: 'changed', path: [], oldValue: 42, newValue: { a: 1 } }])
    })
  })

  describe('opaque leaf types', () => {
    it('Date instances are treated as leaves, not descended', () => {
      const a = new Date(2020, 0, 1)
      const b = new Date(2020, 0, 2)
      const patches = collect({ when: a }, { when: b })
      expect(patches).toEqual([{ kind: 'changed', path: ['when'], oldValue: a, newValue: b }])
    })

    it('Map instances are treated as leaves', () => {
      const a = new Map([['x', 1]])
      const b = new Map([['x', 2]])
      const patches = collect({ data: a }, { data: b })
      expect(patches).toHaveLength(1)
      expect(patches[0]?.kind).toBe('changed')
      expect(patches[0]?.path).toEqual(['data'])
    })

    it('Set instances are treated as leaves', () => {
      const patches = collect({ tags: new Set(['a']) }, { tags: new Set(['a', 'b']) })
      expect(patches).toHaveLength(1)
      expect(patches[0]?.kind).toBe('changed')
    })

    it('class instances are treated as leaves', () => {
      class Foo {
        constructor(public v: number) {}
      }
      const patches = collect({ f: new Foo(1) }, { f: new Foo(2) })
      expect(patches).toHaveLength(1)
      expect(patches[0]?.kind).toBe('changed')
      expect(patches[0]?.path).toEqual(['f'])
    })
  })

  describe('prefix threading', () => {
    it('patches include the full path from an explicit prefix', () => {
      const patches: Patch[] = []
      diffAndApply({ a: 1 }, { a: 2 }, ['forms', 'signup'], (p) => patches.push(p))
      expect(patches).toEqual([
        { kind: 'changed', path: ['forms', 'signup', 'a'], oldValue: 1, newValue: 2 },
      ])
    })
  })

  describe('performance characteristics', () => {
    it('touching one leaf in a 100-field form emits exactly one patch', () => {
      // Proof that diffAndApply does NOT re-emit patches for unchanged siblings.
      // If this ever regresses, the whole point of the rewrite is gone.
      const base: Record<string, { a: number; b: number; c: number }> = {}
      for (let i = 0; i < 34; i++) base[`field${i}`] = { a: i, b: i * 2, c: i * 3 }
      const next = { ...base, field17: { a: 17, b: 9999, c: 51 } }
      const patches: Patch[] = []
      diffAndApply(base, next, [], (p) => patches.push(p))
      expect(patches).toEqual([
        { kind: 'changed', path: ['field17', 'b'], oldValue: 34, newValue: 9999 },
      ])
    })
  })
})
