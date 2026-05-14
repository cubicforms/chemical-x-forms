import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { useForm as useFormV4 } from '../../src/zod-v4'
import { unset } from '../../src'
import type { DefaultValuesInput, Unset } from '../../src'

/**
 * Type-level tests for `DefaultValuesInput<F>` — the single-walker
 * replacement for `DeepPartial<DefaultValuesShape<F>>`. Verifies
 * surface parity with the prior composition, plus the side fix on
 * opaque leaves (`Date`, `Map`, `Set`, `RegExp`, functions stay
 * intact instead of getting structurally destructured).
 *
 * Tests run at typecheck time. `_neverInvoked` wrappers exercise
 * call-site inference without needing a Vue app.
 */

describe('DefaultValuesInput — type-level parity tests', () => {
  describe('primitive leaves accept value, unset, and optional', () => {
    it('accepts string', () => {
      function _neverInvoked() {
        const form = useFormV4({
          schema: z.object({ email: z.string() }),
          defaultValues: { email: 'x' },
        })
        void form
      }
      void _neverInvoked
    })

    it('accepts unset at primitive leaf', () => {
      function _neverInvoked() {
        const form = useFormV4({
          schema: z.object({ email: z.string() }),
          defaultValues: { email: unset },
        })
        void form
      }
      void _neverInvoked
    })

    it('accepts the property being omitted', () => {
      function _neverInvoked() {
        const form = useFormV4({
          schema: z.object({ email: z.string(), name: z.string() }),
          defaultValues: { email: 'x' },
        })
        void form
      }
      void _neverInvoked
    })

    it('rejects wrong primitive type', () => {
      function _neverInvoked() {
        useFormV4({
          schema: z.object({ email: z.string() }),
          // @ts-expect-error — number not assignable to string | Unset | undefined
          defaultValues: { email: 42 },
        })
      }
      void _neverInvoked
    })
  })

  describe('opaque leaves stay intact (Date / Map / Set / RegExp / fn)', () => {
    it('accepts a real Date instance at a Date leaf', () => {
      function _neverInvoked() {
        const form = useFormV4({
          schema: z.object({ joinedAt: z.date() }),
          defaultValues: { joinedAt: new Date() },
        })
        void form
      }
      void _neverInvoked
    })

    it('accepts a typed Set instance at a Set<string> leaf', () => {
      function _neverInvoked() {
        const form = useFormV4({
          schema: z.object({ tags: z.set(z.string()) }),
          defaultValues: { tags: new Set<string>() },
        })
        void form
      }
      void _neverInvoked
    })
  })

  describe('nested objects walk recursively + each level optional', () => {
    it('accepts deep partial values', () => {
      function _neverInvoked() {
        const form = useFormV4({
          schema: z.object({
            profile: z.object({
              name: z.string(),
              age: z.number(),
            }),
          }),
          defaultValues: { profile: { name: 'Ada' } },
        })
        void form
      }
      void _neverInvoked
    })

    it('rejects wrong nested type', () => {
      function _neverInvoked() {
        useFormV4({
          schema: z.object({
            profile: z.object({ name: z.string() }),
          }),
          // @ts-expect-error — boolean not assignable to string at profile.name
          defaultValues: { profile: { name: true } },
        })
      }
      void _neverInvoked
    })
  })

  describe('tuple positions stay positional', () => {
    it('preserves position types in a tuple value', () => {
      function _neverInvoked() {
        const form = useFormV4({
          schema: z.object({
            tup: z.tuple([z.string(), z.number()]),
          }),
          defaultValues: { tup: ['hello', 42] },
        })
        void form
      }
      void _neverInvoked
    })

    it('rejects swapped tuple positions', () => {
      function _neverInvoked() {
        useFormV4({
          schema: z.object({
            tup: z.tuple([z.string(), z.number()]),
          }),
          // @ts-expect-error — swapped positions: number → string slot, string → number slot
          defaultValues: { tup: [42, 'hello'] },
        })
      }
      void _neverInvoked
    })
  })

  describe('arrays of objects walk through elements', () => {
    it('walks an array-of-objects element type', () => {
      type Walked = DefaultValuesInput<{ items: Array<{ sku: string }> }>
      expectTypeOf<Walked>().toMatchTypeOf<{
        items?: Array<{ sku?: string | Unset }>
      }>()
    })
  })

  describe('discriminated unions thread through optional', () => {
    it('preserves union narrowing at the discriminated property', () => {
      function _neverInvoked() {
        const schema = z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('standard'), weight: z.number() }),
          z.object({ kind: z.literal('oversized'), permitNumber: z.string() }),
        ])
        const form = useFormV4({
          schema: z.object({ cargo: schema }),
          defaultValues: { cargo: { kind: 'standard', weight: 10 } },
        })
        void form
      }
      void _neverInvoked
    })
  })
})
