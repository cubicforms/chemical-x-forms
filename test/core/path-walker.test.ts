import { describe, expect, it } from 'vitest'
import { getAtPath, hasAtPath, setAtPath } from '../../src/runtime/core/path-walker'

describe('getAtPath', () => {
  it('returns root for an empty path', () => {
    expect(getAtPath({ a: 1 }, [])).toEqual({ a: 1 })
    expect(getAtPath(42, [])).toBe(42)
    expect(getAtPath(null, [])).toBe(null)
  })

  it('reads a shallow object property', () => {
    expect(getAtPath({ a: 1 }, ['a'])).toBe(1)
  })

  it('reads a nested object property', () => {
    expect(getAtPath({ user: { name: 'alice' } }, ['user', 'name'])).toBe('alice')
  })

  it('reads an array element by numeric segment', () => {
    expect(getAtPath({ items: [10, 20, 30] }, ['items', 1])).toBe(20)
  })

  it('returns null faithfully when the target itself is null', () => {
    // Distinguishes "target is null" from "target missing".
    expect(getAtPath({ a: null }, ['a'])).toBe(null)
  })

  it('returns undefined when the target itself is undefined but present', () => {
    expect(getAtPath({ a: undefined }, ['a'])).toBe(undefined)
  })

  it('returns undefined when an intermediate is null/undefined', () => {
    expect(getAtPath({ a: null }, ['a', 'b'])).toBe(undefined)
    expect(getAtPath({ a: undefined }, ['a', 'b'])).toBe(undefined)
  })

  it('returns undefined when an intermediate is a primitive', () => {
    expect(getAtPath({ a: 42 }, ['a', 'b'])).toBe(undefined)
    expect(getAtPath({ a: 'hello' }, ['a', 'b'])).toBe(undefined)
  })

  it('returns undefined for a numeric segment against a non-array intermediate', () => {
    expect(getAtPath({ a: { 0: 'zero' } }, ['a', 0])).toBe('zero')
    // Object with numeric-looking key: key lookup works via string coercion.
  })

  it('returns undefined when array index is out of bounds', () => {
    expect(getAtPath({ items: [1, 2] }, ['items', 5])).toBe(undefined)
  })

  it('returns undefined when applying a string segment to an array', () => {
    expect(getAtPath({ items: [1, 2] }, ['items', 'foo'])).toBe(undefined)
  })

  it('handles deeply nested paths', () => {
    const form = { users: [{ profile: { contact: { email: 'x@y' } } }] }
    expect(getAtPath(form, ['users', 0, 'profile', 'contact', 'email'])).toBe('x@y')
  })
})

describe('hasAtPath', () => {
  it('returns true for empty path (root always exists)', () => {
    expect(hasAtPath({ a: 1 }, [])).toBe(true)
  })

  it('returns true for an existing defined value', () => {
    expect(hasAtPath({ a: 1 }, ['a'])).toBe(true)
  })

  it('returns true for an existing undefined value (the key is present)', () => {
    expect(hasAtPath({ a: undefined }, ['a'])).toBe(true)
  })

  it('returns true for a null value', () => {
    expect(hasAtPath({ a: null }, ['a'])).toBe(true)
  })

  it('returns false for a missing key', () => {
    expect(hasAtPath({ a: 1 }, ['b'])).toBe(false)
  })

  it('returns false when traversal cannot reach the target', () => {
    expect(hasAtPath({ a: null }, ['a', 'b'])).toBe(false)
    expect(hasAtPath({ a: 42 }, ['a', 'b'])).toBe(false)
  })

  it('returns true for a valid array index, false for out-of-bounds', () => {
    expect(hasAtPath([10, 20], [1])).toBe(true)
    expect(hasAtPath([10, 20], [5])).toBe(false)
  })
})

describe('setAtPath', () => {
  it('returns the value itself for an empty path (root replacement)', () => {
    expect(setAtPath({ old: true }, [], 'replaced')).toBe('replaced')
    expect(setAtPath(null, [], 42)).toBe(42)
  })

  it('sets a shallow property, preserving siblings', () => {
    const input = { a: 1, b: 2 }
    const output = setAtPath(input, ['a'], 99)
    expect(output).toEqual({ a: 99, b: 2 })
    // Input must not be mutated
    expect(input).toEqual({ a: 1, b: 2 })
  })

  it('sets a nested property, preserving structural sharing at untouched siblings', () => {
    const sibling = { deep: true }
    const input = { a: { x: 1 }, b: sibling }
    const output = setAtPath(input, ['a', 'x'], 99) as { a: { x: number }; b: typeof sibling }
    expect(output).toEqual({ a: { x: 99 }, b: sibling })
    // The untouched 'b' subtree should be the same reference
    expect(output.b).toBe(sibling)
  })

  it('creates missing intermediates as plain objects for string segments', () => {
    const output = setAtPath({}, ['user', 'name'], 'alice')
    expect(output).toEqual({ user: { name: 'alice' } })
  })

  it('creates missing intermediates as arrays for numeric segments', () => {
    const output = setAtPath({}, ['items', 0, 'name'], 'first')
    expect(output).toEqual({ items: [{ name: 'first' }] })
  })

  it('extends an array to accommodate a higher index', () => {
    const output = setAtPath({ items: [10] }, ['items', 2], 99)
    expect(output).toEqual({ items: [10, undefined, 99] })
  })

  it('does not mutate the source array', () => {
    const input = [1, 2, 3]
    const output = setAtPath(input, [1], 99)
    expect(output).toEqual([1, 99, 3])
    expect(input).toEqual([1, 2, 3])
  })

  it('overwrites non-descendable intermediates (e.g. primitive at intermediate position)', () => {
    const output = setAtPath({ a: 42 }, ['a', 'b'], 'nested')
    expect(output).toEqual({ a: { b: 'nested' } })
  })

  it('deep-nested set creates the full chain', () => {
    const output = setAtPath({}, ['users', 0, 'profile', 'email'], 'x@y')
    expect(output).toEqual({ users: [{ profile: { email: 'x@y' } }] })
  })
})
