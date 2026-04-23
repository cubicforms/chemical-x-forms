import { describe, expect, it } from 'vitest'
import {
  invokeArrayFns,
  isArray,
  isFunction,
  isMap,
  isObject,
  isSet,
  isSymbol,
  looseEqual,
  looseIndexOf,
  looseToNumber,
} from '../../src/runtime/core/vue-shared-shim'

/*
 * Covers the utilities inlined from @vue/shared. Exists as a version-pin: if
 * our inlined implementations ever drift from @vue/shared's semantics we want
 * to catch that in CI, not via silent user bug reports.
 */

describe('vue-shared shim', () => {
  describe('type guards', () => {
    it('isArray', () => {
      expect(isArray([])).toBe(true)
      expect(isArray([1, 2])).toBe(true)
      expect(isArray({})).toBe(false)
      expect(isArray('foo')).toBe(false)
      expect(isArray(null)).toBe(false)
    })

    it('isSet distinguishes Set from plain object', () => {
      expect(isSet(new Set())).toBe(true)
      expect(isSet(new Set([1, 2]))).toBe(true)
      expect(isSet(new Map())).toBe(false)
      expect(isSet({})).toBe(false)
    })

    it('isMap distinguishes Map', () => {
      expect(isMap(new Map())).toBe(true)
      expect(isMap(new Set())).toBe(false)
    })

    it('isSymbol', () => {
      expect(isSymbol(Symbol('x'))).toBe(true)
      expect(isSymbol('Symbol')).toBe(false)
    })

    it('isObject (not null, typeof object)', () => {
      expect(isObject({})).toBe(true)
      expect(isObject([])).toBe(true)
      expect(isObject(null)).toBe(false)
      expect(isObject(undefined)).toBe(false)
      expect(isObject(1)).toBe(false)
    })

    it('isFunction', () => {
      expect(isFunction(() => 0)).toBe(true)
      expect(isFunction(function foo(): void {})).toBe(true)
      expect(isFunction({})).toBe(false)
    })
  })

  describe('looseToNumber', () => {
    it('returns the parsed number for numeric strings', () => {
      expect(looseToNumber('42')).toBe(42)
      expect(looseToNumber('3.14')).toBe(3.14)
    })

    it('returns the original value when parseFloat produces NaN', () => {
      expect(looseToNumber('abc')).toBe('abc')
      expect(looseToNumber('')).toBe('')
    })

    it('passes numbers through after the parseFloat round-trip', () => {
      expect(looseToNumber(7)).toBe(7)
    })
  })

  describe('looseEqual', () => {
    it('returns true for identical primitives', () => {
      expect(looseEqual(1, 1)).toBe(true)
      expect(looseEqual('x', 'x')).toBe(true)
      expect(looseEqual(null, null)).toBe(true)
      expect(looseEqual(undefined, undefined)).toBe(true)
    })

    it('returns false for different primitives', () => {
      expect(looseEqual(1, 2)).toBe(false)
      expect(looseEqual('a', 'b')).toBe(false)
    })

    it('equates string-representable primitives (Vue s "loose" semantic)', () => {
      // Vue treats `1 == '1'` loosely for v-model convenience.
      expect(looseEqual(1, '1')).toBe(true)
    })

    it('compares Dates by time value', () => {
      expect(looseEqual(new Date(2020, 0, 1), new Date(2020, 0, 1))).toBe(true)
      expect(looseEqual(new Date(2020, 0, 1), new Date(2020, 0, 2))).toBe(false)
    })

    it('compares arrays element-wise', () => {
      expect(looseEqual([1, 2, 3], [1, 2, 3])).toBe(true)
      expect(looseEqual([1, 2], [1, 2, 3])).toBe(false)
    })

    it('compares plain objects by own keys', () => {
      expect(looseEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
      expect(looseEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    })

    it('mixed types (array vs object) are not equal', () => {
      expect(looseEqual([1, 2], { 0: 1, 1: 2 })).toBe(false)
    })

    it('object vs primitive does NOT collapse via String() coercion', () => {
      // Without the early object/non-object short-circuit, this would
      // fall through to `String({}) === '[object Object]'` and return
      // true. Vue's @vue/shared makes the same early return.
      expect(looseEqual({}, '[object Object]')).toBe(false)
      expect(looseEqual({ a: 1 }, '[object Object]')).toBe(false)
      expect(looseEqual([], '')).toBe(false)
    })
  })

  describe('looseIndexOf', () => {
    it('finds with loose equality', () => {
      expect(looseIndexOf([1, 2, 3], '2')).toBe(1)
      expect(looseIndexOf([{ a: 1 }, { a: 2 }], { a: 2 })).toBe(1)
    })

    it('returns -1 on miss', () => {
      expect(looseIndexOf([1, 2], 99)).toBe(-1)
    })
  })

  describe('invokeArrayFns', () => {
    it('calls each function with args in order', () => {
      const calls: Array<[string, unknown[]]> = []
      invokeArrayFns(
        [
          ((...a: unknown[]) => {
            calls.push(['a', a])
          }) as (...args: unknown[]) => unknown,
          ((...a: unknown[]) => {
            calls.push(['b', a])
          }) as (...args: unknown[]) => unknown,
        ],
        1,
        'x'
      )
      expect(calls).toEqual([
        ['a', [1, 'x']],
        ['b', [1, 'x']],
      ])
    })
  })
})
