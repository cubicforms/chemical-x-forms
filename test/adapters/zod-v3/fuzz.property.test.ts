import { fc, test } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { z } from 'zod-v3'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v3'
import { buildZodRootObjectArbitrary } from '../../utils/zod-arbitraries'

/**
 * Mirror of test/adapters/zod-v4/fuzz.property.test.ts, targeting the v3
 * adapter. Two deliberate differences from the v4 fuzz:
 *
 * 1. Zod v3's `z.record` signature differs from v4's — v3 accepts a
 *    single value type while v4 requires both key and value — so the
 *    `makeRecord` closure uses the v3 form.
 *
 * 2. Properties accommodate the v3 adapter's known partial behaviour on
 *    `getInitialState`. The v3 adapter intentionally throws (not returns
 *    errors) when default-derivation can't construct a value that
 *    satisfies the schema — see src/runtime/adapters/zod-v3/index.ts:164
 *    ("yes, throw if we genuinely can't construct the initial state!").
 *    Known cases include nested unions where neither branch matches the
 *    defaulted value, and `z.bigint()` defaults that didn't receive the
 *    same fix commit a69299e applied to v4.
 *
 *    Rather than whack each trigger case in the arbitrary, we assert the
 *    shape of the failure: the adapter either completes with success, or
 *    throws a ZodError (not a TypeError or any other unexpected throw).
 *    This catches genuine regressions while acknowledging the current
 *    contract. Phase 5.6's async rewrite unifies v3 + v4 behaviour; at
 *    that point these properties can tighten to match v4's.
 */

const arbRootSchema = buildZodRootObjectArbitrary(z, 3, (inner) => z.record(inner))

describe('zod v3 adapter — fuzz over arbitrary supported schemas', () => {
  test.prop([arbRootSchema])('adapter construction never throws on supported schemas', (schema) => {
    expect(() => zodAdapter(schema as z.ZodObject<z.ZodRawShape>)('f')).not.toThrow()
  })

  test.prop([arbRootSchema])(
    'getInitialState never throws anything other than a ZodError',
    (schema) => {
      const adapter = zodAdapter(schema as z.ZodObject<z.ZodRawShape>)('f')
      try {
        adapter.getInitialState({ useDefaultSchemaValues: true, validationMode: 'lax' })
      } catch (err) {
        // The only sanctioned throw-path is a ZodError raised by the
        // adapter when default-derivation can't construct a valid initial
        // state. TypeErrors / RangeErrors / any unexpected class surface
        // here as a fuzz fail. Phase 5.6's async rewrite tightens this
        // to a returns-errors-not-throws contract.
        expect(err).toBeInstanceOf(z.ZodError)
      }
    }
  )

  test.prop([arbRootSchema])('validateAtPath is total — never rejects', async (schema) => {
    const adapter = zodAdapter(schema as z.ZodObject<z.ZodRawShape>)('f')
    // Fuzz random values through validateAtPath without requiring a
    // valid initial state. The contract is "resolves to a
    // ValidationResponse (success or error), does not reject". Covers
    // the path where a consumer calls validate on partial / malformed
    // data. Post-5.6 the adapter method is Promise-returning, so the
    // property reads "never rejects" rather than "never throws".
    for (const probe of [undefined, null, 0, '', [], {}]) {
      await expect(adapter.validateAtPath(probe, undefined)).resolves.toBeDefined()
    }
  })

  test.prop([arbRootSchema, fc.string({ minLength: 1, maxLength: 8 })])(
    'validateAtPath error responses carry the right formKey',
    async (schema, formKey) => {
      const adapter = zodAdapter(schema as z.ZodObject<z.ZodRawShape>)(formKey)
      // Use a value guaranteed to fail shape-check — null — so we're on
      // the error branch of validateAtPath.
      const result = await adapter.validateAtPath(null, undefined)
      if (!result.success) {
        for (const err of result.errors) {
          expect(err.formKey).toBe(formKey)
        }
      }
    }
  )
})
