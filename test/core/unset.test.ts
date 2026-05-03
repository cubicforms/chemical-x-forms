import { describe, expect, it } from 'vitest'
import { isUnset, unset } from '../../src/runtime/core/unset'

describe('unset symbol', () => {
  it('is a registry-keyed symbol so cross-realm equality holds', () => {
    expect(typeof unset).toBe('symbol')
    expect(unset).toBe(Symbol.for('attaform/unset'))
  })

  it('is a stable reference — two reads return the same value', () => {
    const a = unset
    const b = unset
    expect(a).toBe(b)
  })

  it('isUnset returns true only for the sentinel', () => {
    expect(isUnset(unset)).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['0 (slim default for z.number())', 0],
    ['empty string (slim default for z.string())', ''],
    ['false (slim default for z.boolean())', false],
    ['0n (slim default for z.bigint())', 0n],
    ['arbitrary symbol', Symbol('not-unset')],
    ['arbitrary registry symbol', Symbol.for('something-else')],
    ['object', {}],
    ['array', []],
  ])('isUnset returns false for %s', (_name, value) => {
    expect(isUnset(value)).toBe(false)
  })
})
