import { fc, test } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { parseApiErrors } from '../../src/runtime/core/parse-api-errors'

/**
 * Properties for the API-error parser. The important invariants: any
 * plausible payload must be a total function (no throws), well-formed
 * envelopes always parse successfully, the formKey always propagates
 * onto the produced errors, and the per-entry `code` flows verbatim
 * from the wire onto the produced ValidationError.
 */

// A single `{ message, code }` entry — the strict wire shape.
const arbEntry = fc.record({
  message: fc.string({ minLength: 1, maxLength: 12 }),
  code: fc
    .tuple(
      fc.constantFrom('api', 'auth', 'srv', 'app'),
      fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /^[a-z][a-z0-9-]*$/.test(s))
    )
    .map(([scope, ident]) => `${scope}:${ident}`),
})

// A "well-formed details record": string keys → entry | entry[].
const arbDetails = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }).filter((s) => !s.includes('.')),
  fc.oneof(arbEntry, fc.array(arbEntry, { maxLength: 3 })),
  { maxKeys: 4 }
)

// The three envelope shapes parseApiErrors accepts for well-formed input.
const arbValidPayload = fc.oneof(
  // Raw details.
  arbDetails,
  // Unwrapped envelope.
  arbDetails.map((details) => ({ details })),
  // Wrapped envelope.
  arbDetails.map((details) => ({ error: { details } }))
)

// A "random junk" payload generator — any JSON-ish value. Used to prove
// parseApiErrors is total (never throws) rather than that it succeeds.
const arbJunkPayload = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.array(fc.string(), { maxLength: 4 }),
  fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.jsonValue(), { maxKeys: 4 })
)

describe('parseApiErrors — properties', () => {
  test.prop([arbJunkPayload, fc.string({ minLength: 1, maxLength: 8 })])(
    'total function: never throws for plausible payloads',
    (payload, formKey) => {
      expect(() => parseApiErrors(payload, { formKey })).not.toThrow()
    }
  )

  test.prop([arbValidPayload, fc.string({ minLength: 1, maxLength: 8 })])(
    'valid-envelope invariant: well-formed inputs always produce ok:true',
    (payload, formKey) => {
      const result = parseApiErrors(payload, { formKey })
      expect(result.ok).toBe(true)
    }
  )

  test.prop([arbDetails, fc.string({ minLength: 1, maxLength: 8 })])(
    'formKey propagation: every produced error carries the input formKey',
    (details, formKey) => {
      const result = parseApiErrors(details, { formKey })
      expect(result.ok).toBe(true)
      for (const err of result.errors) {
        expect(err.formKey).toBe(formKey)
      }
    }
  )

  test.prop([arbDetails, fc.string({ minLength: 1, maxLength: 8 })])(
    'every produced error carries a well-formed scoped code',
    (details, formKey) => {
      const result = parseApiErrors(details, { formKey })
      expect(result.ok).toBe(true)
      for (const err of result.errors) {
        // Convention: `<scope>:<kebab>`. Allow uppercase + digits in
        // the identifier slice so consumer-defined codes like
        // `api:HTTP_409` or `auth:Token-Expired` aren't rejected.
        expect(err.code).toMatch(/^[a-z][a-z0-9-]*:[A-Za-z0-9_-]+$/)
      }
    }
  )

  test.prop([arbDetails, fc.string({ minLength: 1, maxLength: 8 })])(
    'message count matches the input expansion (entry → 1, array → len)',
    (details, formKey) => {
      const expected = Object.values(details).reduce<number>((sum, v) => {
        if (Array.isArray(v)) return sum + v.filter((entry) => entry.message.length > 0).length
        return sum + (v.message.length > 0 ? 1 : 0)
      }, 0)
      const { errors } = parseApiErrors(details, { formKey })
      expect(errors.length).toBe(expected)
    }
  )
})
