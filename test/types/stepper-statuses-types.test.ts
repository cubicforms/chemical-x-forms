import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import type {
  AggregateError,
  FormStatus,
  Statuses,
  StepperStatusesProxy,
} from '../../src/runtime/types/types-stepper'

/**
 * Type-level checks for PR3's status surface. `FormStatus` is the
 * per-form summary derived from `form.meta`. `Statuses<Forms>` is the
 * keyed record used by `stepper.statuses` and by the
 * `defaultStatuses` seed option. `AggregateError` is the flattened
 * shape returned by `stepper.allErrors`. `StepperStatusesProxy` mirrors
 * the call-or-read pattern from `form.values` but at a single depth.
 */

const schema = z.object({ email: z.string() })

describe('stepper status types', () => {
  it('FormStatus has isValid / isDirty / isSubmitted / errorCount fields', () => {
    expectTypeOf<FormStatus>().toEqualTypeOf<{
      readonly isValid: boolean
      readonly isDirty: boolean
      readonly isSubmitted: boolean
      readonly errorCount: number
    }>()
  })

  it('Statuses<Forms> is a keyed record over each form key', () => {
    function _neverInvoked() {
      const a = useForm({ schema, key: 'a' })
      const b = useForm({ schema, key: 'b' })
      const _forms = [a, b] as const
      expectTypeOf<Statuses<typeof _forms>>().toEqualTypeOf<{
        readonly a: FormStatus
        readonly b: FormStatus
      }>()
    }
    void _neverInvoked
  })

  it('AggregateError carries formKey / path / message / optional code', () => {
    expectTypeOf<AggregateError>().toEqualTypeOf<{
      readonly formKey: string
      readonly path: ReadonlyArray<string | number>
      readonly message: string
      readonly code?: string
    }>()
  })

  it('StepperStatusesProxy carries both call and read surfaces', () => {
    type StatusMap = { readonly a: FormStatus; readonly b: FormStatus }
    type Proxy = StepperStatusesProxy<StatusMap>
    function _neverInvoked() {
      const proxy = {} as Proxy
      const status = proxy.a
      expectTypeOf(status satisfies FormStatus).toMatchTypeOf<FormStatus>()
      const _fromCall = proxy('a')
      expectTypeOf<typeof _fromCall>().toMatchTypeOf<FormStatus | StatusMap>()
      const _all = proxy()
      expectTypeOf<typeof _all>().toMatchTypeOf<FormStatus | StatusMap>()
    }
    void _neverInvoked
  })
})
