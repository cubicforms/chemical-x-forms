import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import type { KeysOf, FormKeyOf, AnyForm } from '../../src/runtime/types/types-stepper'

/**
 * Type-level checks for the stepper's key-union machinery. The motivating
 * use case is multistep navigation typed by the union of all participating
 * form keys — `stepper.current.value` is `'a' | 'b'`, `goTo('a')`
 * autocompletes, `goTo('typo')` is a type error.
 *
 * Tests run at typecheck time. `expectTypeOf` chain methods are no-ops
 * at runtime. The `_neverInvoked` wrappers declare real `useForm` calls
 * so TypeScript exercises call-site inference; no Vue app context is
 * needed because the functions are never called.
 */

const schema = z.object({ email: z.string() })

describe('stepper key-union types', () => {
  it('FormKeyOf extracts the literal key from a form return type', () => {
    function _neverInvoked() {
      const _form = useForm({ schema, key: 'signup' })
      expectTypeOf<FormKeyOf<typeof _form>>().toEqualTypeOf<'signup'>()
    }
    void _neverInvoked
  })

  it('KeysOf builds a union across an array of forms', () => {
    function _neverInvoked() {
      const a = useForm({ schema, key: 'signup' })
      const b = useForm({ schema, key: 'cargo' })
      const c = useForm({ schema, key: 'review' })
      const _forms = [a, b, c] as const
      expectTypeOf<KeysOf<typeof _forms>>().toEqualTypeOf<'signup' | 'cargo' | 'review'>()
    }
    void _neverInvoked
  })

  it('KeysOf collapses to the same literal for a single-form tuple', () => {
    function _neverInvoked() {
      const a = useForm({ schema, key: 'only' })
      const _forms = [a] as const
      expectTypeOf<KeysOf<typeof _forms>>().toEqualTypeOf<'only'>()
    }
    void _neverInvoked
  })

  it('AnyForm accepts any keyed useForm return type', () => {
    function _neverInvoked() {
      const a = useForm({ schema, key: 'signup' })
      expectTypeOf(a).toMatchTypeOf<AnyForm>()
    }
    void _neverInvoked
  })
})
