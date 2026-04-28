import { describe, expectTypeOf, it } from 'vitest'
import type { DefaultValuesShape } from '../../src/runtime/types/types-core'
import type { Unset } from '../../src/runtime/core/unset'

/**
 * Compile-time tests for `DefaultValuesShape<T>`. Mirrors the shape of
 * `write-shape.test.ts` but adds the `Unset` widening at every primitive
 * leaf. Non-primitive leaves stay strict — passing `unset` against
 * `z.date()` is a TS error.
 *
 * Used by `UseFormConfiguration.defaultValues`, `setValue`'s value
 * parameter, and `reset`'s parameter (commit 7 wires those).
 */

describe('DefaultValuesShape — primitive leaf widening', () => {
  it('widens string to string | Unset', () => {
    expectTypeOf<DefaultValuesShape<string>>().toEqualTypeOf<string | Unset>()
  })

  it('widens number to number | Unset', () => {
    expectTypeOf<DefaultValuesShape<number>>().toEqualTypeOf<number | Unset>()
  })

  it('widens boolean to boolean | Unset', () => {
    expectTypeOf<DefaultValuesShape<boolean>>().toEqualTypeOf<boolean | Unset>()
  })

  it('widens bigint to bigint | Unset', () => {
    expectTypeOf<DefaultValuesShape<bigint>>().toEqualTypeOf<bigint | Unset>()
  })

  it('widens string literals to string | Unset', () => {
    expectTypeOf<DefaultValuesShape<'red' | 'green'>>().toEqualTypeOf<string | Unset>()
  })

  it('widens number literals to number | Unset', () => {
    expectTypeOf<DefaultValuesShape<42>>().toEqualTypeOf<number | Unset>()
  })
})

describe('DefaultValuesShape — non-primitive leaves stay strict', () => {
  it('Date passes through unchanged', () => {
    expectTypeOf<DefaultValuesShape<Date>>().toEqualTypeOf<Date>()
  })

  it('RegExp passes through unchanged', () => {
    expectTypeOf<DefaultValuesShape<RegExp>>().toEqualTypeOf<RegExp>()
  })

  it('Map passes through unchanged', () => {
    expectTypeOf<DefaultValuesShape<Map<string, number>>>().toEqualTypeOf<Map<string, number>>()
  })

  it('Set passes through unchanged', () => {
    expectTypeOf<DefaultValuesShape<Set<string>>>().toEqualTypeOf<Set<string>>()
  })

  it('null and undefined pass through unchanged', () => {
    expectTypeOf<DefaultValuesShape<null>>().toEqualTypeOf<null>()
    expectTypeOf<DefaultValuesShape<undefined>>().toEqualTypeOf<undefined>()
  })
})

describe('DefaultValuesShape — recursion through containers', () => {
  it('object widens each primitive leaf independently', () => {
    type Input = { name: string; age: number; alive: boolean }
    type Output = {
      name: string | Unset
      age: number | Unset
      alive: boolean | Unset
    }
    expectTypeOf<DefaultValuesShape<Input>>().toEqualTypeOf<Output>()
  })

  it('nested objects recurse', () => {
    type Input = { user: { id: number; profile: { displayName: string } } }
    type Output = {
      user: {
        id: number | Unset
        profile: { displayName: string | Unset }
      }
    }
    expectTypeOf<DefaultValuesShape<Input>>().toEqualTypeOf<Output>()
  })

  it('unbounded array recurses on the element type', () => {
    expectTypeOf<DefaultValuesShape<number[]>>().toEqualTypeOf<Array<number | Unset>>()
  })

  it('tuple positions widen independently', () => {
    type Input = readonly [string, number, boolean]
    type Output = [string | Unset, number | Unset, boolean | Unset]
    expectTypeOf<DefaultValuesShape<Input>>().toEqualTypeOf<Output>()
  })

  it('Date inside an object stays strict', () => {
    type Input = { joinedAt: Date; income: number }
    type Output = { joinedAt: Date; income: number | Unset }
    expectTypeOf<DefaultValuesShape<Input>>().toEqualTypeOf<Output>()
  })
})

describe('DefaultValuesShape — assignability for backward compatibility', () => {
  it('plain number is assignable to widened number | Unset', () => {
    const value: DefaultValuesShape<number> = 42
    expectTypeOf(value).toMatchTypeOf<number | Unset>()
  })

  it('plain string is assignable to widened string | Unset', () => {
    const value: DefaultValuesShape<string> = 'hello'
    expectTypeOf(value).toMatchTypeOf<string | Unset>()
  })

  it('object with plain number is assignable to widened object', () => {
    const value: DefaultValuesShape<{ count: number }> = { count: 0 }
    expectTypeOf(value).toMatchTypeOf<{ count: number | Unset }>()
  })
})
