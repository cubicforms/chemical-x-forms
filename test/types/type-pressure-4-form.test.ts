import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { useForm } from '../../src/zod-v4'
import { useStepper } from '../../src'
import type { FormStatus } from '../../src/zod-v4'

/**
 * Type-pressure regression test for the 4-form `useStepper` pattern
 * — the synthetic version of the shipment-demo restructure. Validates
 * that the type system holds together when consumers wire 3+ forms
 * with moderately-complex schemas (nested objects, arrays, tuples,
 * discriminated unions) in one scope.
 *
 * The acceptance test for the depth-efficiency refactor lives here.
 * If this file typechecks under `pnpm typecheck` AND under a separate
 * fixture importing from `dist/zod-v4`, the bundled types can
 * support real multistep wizards without tripping TS2589 ("Type
 * instantiation is excessively deep").
 *
 * `_neverInvoked` wrappers exercise call-site inference without
 * needing a Vue app context.
 */

const referenceSchema = z.object({
  shipperRef: z.string(),
  internalNotes: z.string(),
  customerCode: z.string(),
  poNumber: z.string(),
  contactName: z.string(),
})

const cargoSchema = z.object({
  items: z.array(
    z.object({
      sku: z.string(),
      quantity: z.number(),
      weightKg: z.number(),
    })
  ),
  details: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('dry'), fragile: z.boolean() }),
    z.object({ kind: z.literal('refrigerated'), tempMinC: z.number(), tempMaxC: z.number() }),
    z.object({
      kind: z.literal('hazmat'),
      unNumber: z.string(),
      hazardClass: z.enum(['1', '2', '3']),
    }),
    z.object({
      kind: z.literal('oversized'),
      lengthCm: z.number(),
      widthCm: z.number(),
      heightCm: z.number(),
    }),
  ]),
  declaredValueUsd: z.number(),
  insurance: z.object({
    insured: z.boolean(),
    coverageUsd: z.number(),
  }),
})

const serviceSchema = z.object({
  pickup: z.object({
    line1: z.string(),
    line2: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
  delivery: z.object({
    line1: z.string(),
    line2: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
  speed: z.enum(['standard', 'expedited', 'overnight']),
  scheduledDates: z.tuple([z.string(), z.string()]),
})

const reviewSchema = z.object({
  termsAccepted: z.boolean(),
  signature: z.string(),
  acknowledgements: z.array(z.string()),
})

describe('Type-pressure — 4 useForm calls + useStepper composition', () => {
  it('compiles each form with literal key inference preserved', () => {
    function _neverInvoked() {
      const refForm = useForm({ schema: referenceSchema, key: 'reference' as const })
      const cargoForm = useForm({ schema: cargoSchema, key: 'cargo' as const })
      const serviceForm = useForm({ schema: serviceSchema, key: 'service' as const })
      const reviewForm = useForm({ schema: reviewSchema, key: 'review' as const })

      expectTypeOf(refForm.key).toEqualTypeOf<'reference'>()
      expectTypeOf(cargoForm.key).toEqualTypeOf<'cargo'>()
      expectTypeOf(serviceForm.key).toEqualTypeOf<'service'>()
      expectTypeOf(reviewForm.key).toEqualTypeOf<'review'>()
    }
    void _neverInvoked
  })

  it('composes the four forms into a stepper with discriminated current/keys', () => {
    function _neverInvoked() {
      const refForm = useForm({ schema: referenceSchema, key: 'reference' as const })
      const cargoForm = useForm({ schema: cargoSchema, key: 'cargo' as const })
      const serviceForm = useForm({ schema: serviceSchema, key: 'service' as const })
      const reviewForm = useForm({ schema: reviewSchema, key: 'review' as const })

      const stepper = useStepper([refForm, cargoForm, serviceForm, reviewForm])

      expectTypeOf(stepper.current.value).toEqualTypeOf<
        'reference' | 'cargo' | 'service' | 'review'
      >()
      expectTypeOf(stepper.count).toEqualTypeOf<number>()
    }
    void _neverInvoked
  })

  it('preserves deep proxy access on each form (form.values)', () => {
    function _neverInvoked() {
      const refForm = useForm({ schema: referenceSchema, key: 'reference' as const })
      const cargoForm = useForm({ schema: cargoSchema, key: 'cargo' as const })
      const serviceForm = useForm({ schema: serviceSchema, key: 'service' as const })

      expectTypeOf(refForm.values.shipperRef).toEqualTypeOf<string>()
      expectTypeOf(cargoForm.values.declaredValueUsd).toEqualTypeOf<number>()
      expectTypeOf(cargoForm.values.insurance.coverageUsd).toEqualTypeOf<number>()
      expectTypeOf(serviceForm.values.pickup.city).toEqualTypeOf<string>()
      expectTypeOf(serviceForm.values.delivery.country).toEqualTypeOf<string>()
    }
    void _neverInvoked
  })

  it('threads discriminated-union lift through form.values per variant', () => {
    function _neverInvoked() {
      const cargoForm = useForm({ schema: cargoSchema, key: 'cargo' as const })
      expectTypeOf(cargoForm.values.details.fragile).toEqualTypeOf<boolean | undefined>()
      expectTypeOf(cargoForm.values.details.tempMinC).toEqualTypeOf<number | undefined>()
      expectTypeOf(cargoForm.values.details.unNumber).toEqualTypeOf<string | undefined>()
      expectTypeOf(cargoForm.values.details.lengthCm).toEqualTypeOf<number | undefined>()
    }
    void _neverInvoked
  })

  it('narrows setValue payload at each form (path narrowing intact)', () => {
    function _neverInvoked() {
      const refForm = useForm({ schema: referenceSchema, key: 'reference' as const })
      refForm.setValue('shipperRef', 'TRACK-001')
      // @ts-expect-error — number not assignable to string at shipperRef
      refForm.setValue('shipperRef', 42)
    }
    void _neverInvoked
  })

  it('exposes stepper.statuses with FormStatus typing per key', () => {
    function _neverInvoked() {
      const refForm = useForm({ schema: referenceSchema, key: 'reference' as const })
      const cargoForm = useForm({ schema: cargoSchema, key: 'cargo' as const })
      const serviceForm = useForm({ schema: serviceSchema, key: 'service' as const })
      const reviewForm = useForm({ schema: reviewSchema, key: 'review' as const })

      const stepper = useStepper([refForm, cargoForm, serviceForm, reviewForm])

      expectTypeOf(stepper.statuses.reference).toEqualTypeOf<FormStatus>()
      expectTypeOf(stepper.statuses.cargo.isValid).toEqualTypeOf<boolean>()
      expectTypeOf(stepper.statuses.service.errorCount).toEqualTypeOf<number>()
    }
    void _neverInvoked
  })

  it('handleSubmit data argument matches parsed output (z.output) per form', () => {
    function _neverInvoked() {
      const cargoForm = useForm({ schema: cargoSchema, key: 'cargo' as const })
      cargoForm.handleSubmit((data) => {
        expectTypeOf(data.items).toEqualTypeOf<
          Array<{ sku: string; quantity: number; weightKg: number }>
        >()
        expectTypeOf(data.declaredValueUsd).toEqualTypeOf<number>()
      })
    }
    void _neverInvoked
  })
})
