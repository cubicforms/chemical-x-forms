import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { z as zV3 } from 'zod-v3'
import { useForm as useFormZ } from '../../src/zod'
import { useForm as useFormV3 } from '../../src/zod-v3'
import { useForm as useFormV4 } from '../../src/zod-v4'
import type { FormKey } from '../../src'

/**
 * Type-level test for `form.key` literal preservation through the
 * `useForm` overloads. Threading `K extends FormKey` lets the stepper
 * (and any other consumer) discriminate on the literal — `goTo('signup')`
 * autocompletes the known keys, `stepper.statuses.signup` resolves to
 * the matching form.
 *
 * Three entry points each get the same treatment:
 *  - `attaform/zod` (unified runtime dispatch)
 *  - `attaform/zod-v3`
 *  - `attaform/zod-v4`
 *
 * Tests run at typecheck time. The `_neverInvoked` wrappers declare real
 * `useForm` calls so TypeScript exercises call-site inference, but the
 * functions are never called — no Vue app context is needed.
 * `expectTypeOf` chain methods are no-ops at runtime.
 */

const schemaV4 = z.object({ email: z.string() })
const schemaV3 = zV3.object({ email: zV3.string() })

describe('useForm — form.key literal preservation', () => {
  describe('attaform/zod (unified)', () => {
    it('captures literal key string', () => {
      function _neverInvoked() {
        const form = useFormZ({ schema: schemaV4, key: 'signup' })
        expectTypeOf(form.key).toEqualTypeOf<'signup'>()
      }
      void _neverInvoked
    })

    it('falls back to FormKey when key is omitted', () => {
      function _neverInvoked() {
        const form = useFormZ({ schema: schemaV4 })
        expectTypeOf(form.key).toEqualTypeOf<FormKey>()
      }
      void _neverInvoked
    })
  })

  describe('attaform/zod-v3', () => {
    it('captures literal key string', () => {
      function _neverInvoked() {
        const form = useFormV3({ schema: schemaV3, key: 'cargo' })
        expectTypeOf(form.key).toEqualTypeOf<'cargo'>()
      }
      void _neverInvoked
    })

    it('falls back to FormKey when key is omitted', () => {
      function _neverInvoked() {
        const form = useFormV3({ schema: schemaV3 })
        expectTypeOf(form.key).toEqualTypeOf<FormKey>()
      }
      void _neverInvoked
    })
  })

  describe('attaform/zod-v4', () => {
    it('captures literal key string', () => {
      function _neverInvoked() {
        const form = useFormV4({ schema: schemaV4, key: 'review' })
        expectTypeOf(form.key).toEqualTypeOf<'review'>()
      }
      void _neverInvoked
    })

    it('falls back to FormKey when key is omitted', () => {
      function _neverInvoked() {
        const form = useFormV4({ schema: schemaV4 })
        expectTypeOf(form.key).toEqualTypeOf<FormKey>()
      }
      void _neverInvoked
    })
  })
})
