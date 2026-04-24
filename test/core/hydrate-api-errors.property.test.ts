import { fc, test } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { hydrateApiErrors } from '../../src/runtime/core/hydrate-api-errors'

/**
 * Properties for the API-error hydration normaliser. The important
 * invariants: any plausible payload must be a total function (no throws),
 * well-formed envelopes always hydrate successfully, and the formKey
 * always propagates onto the produced errors.
 */

// A "well-formed details record": string keys → string | string[] values.
// These are the payloads backend teams write on purpose.
const arbDetails = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }).filter((s) => !s.includes('.')),
  fc.oneof(
    fc.string({ minLength: 1, maxLength: 12 }),
    fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 3 })
  ),
  { maxKeys: 4 }
)

// The three envelope shapes hydrateApiErrors accepts for well-formed input.
const arbValidPayload = fc.oneof(
  // Raw details.
  arbDetails,
  // Unwrapped envelope.
  arbDetails.map((details) => ({ details })),
  // Wrapped envelope.
  arbDetails.map((details) => ({ error: { details } }))
)

// A "random junk" payload generator — any JSON-ish value. Used to prove
// hydrateApiErrors is total (never throws) rather than that it succeeds.
const arbJunkPayload = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.array(fc.string(), { maxLength: 4 }),
  fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.jsonValue(), { maxKeys: 4 })
)

describe('hydrateApiErrors — properties', () => {
  test.prop([arbJunkPayload, fc.string({ minLength: 1, maxLength: 8 })])(
    'total function: never throws for plausible payloads',
    (payload, formKey) => {
      expect(() => hydrateApiErrors(payload, { formKey })).not.toThrow()
    }
  )

  test.prop([arbValidPayload, fc.string({ minLength: 1, maxLength: 8 })])(
    'valid-envelope invariant: well-formed inputs always produce ok:true',
    (payload, formKey) => {
      const result = hydrateApiErrors(payload, { formKey })
      expect(result.ok).toBe(true)
    }
  )

  test.prop([arbDetails, fc.string({ minLength: 1, maxLength: 8 })])(
    'formKey propagation: every produced error carries the input formKey',
    (details, formKey) => {
      const result = hydrateApiErrors(details, { formKey })
      expect(result.ok).toBe(true)
      for (const err of result.errors) {
        expect(err.formKey).toBe(formKey)
      }
    }
  )

  test.prop([arbDetails, fc.string({ minLength: 1, maxLength: 8 })])(
    'message count matches the input expansion (string → 1, array → len)',
    (details, formKey) => {
      const expected = Object.values(details).reduce<number>((sum, v) => {
        if (typeof v === 'string') return sum + (v.length > 0 ? 1 : 0)
        return sum + v.filter((s) => s.length > 0).length
      }, 0)
      const { errors } = hydrateApiErrors(details, { formKey })
      expect(errors.length).toBe(expected)
    }
  )
})
