import { fc, test } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { z } from 'zod-v3'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v3'
import { buildZodRootObjectArbitrary } from '../../utils/zod-arbitraries'

/**
 * Mirror of test/adapters/zod-v4/fuzz.property.test.ts, targeting the
 * v3 adapter. The only deliberate difference from the v4 fuzz: Zod v3's
 * `z.record` signature takes a single value type while v4 requires
 * both key and value — the `makeRecord` closure uses the v3 form.
 *
 * Properties mirror v4's post-fix shape (getDefaultValues is total in
 * lax mode, never throws, always returns success). The v3 adapter used
 * to throw a ZodError on nested unions + `z.bigint()` defaults; both
 * paths were fixed alongside these property tightenings.
 */

const arbRootSchema = buildZodRootObjectArbitrary(z, 3, (inner) => z.record(inner))

describe('zod v3 adapter — fuzz over arbitrary supported schemas', () => {
  test.prop([arbRootSchema])('adapter construction never throws on supported schemas', (schema) => {
    expect(() => zodAdapter(schema as z.ZodObject<z.ZodRawShape>)('f')).not.toThrow()
  })

  test.prop([arbRootSchema])(
    'getDefaultValues returns a success response in lax mode',
    (schema) => {
      const adapter = zodAdapter(schema as z.ZodObject<z.ZodRawShape>)('f')
      const result = adapter.getDefaultValues({
        useDefaultSchemaValues: true,
        strict: false,
      })
      expect(result.success).toBe(true)
      // After `success === true`, the result type narrows so `.data` is
      // present by construction — assert on shape instead of mere
      // existence.
      expect(typeof result.data).toBe('object')
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
      // `toHaveProperty('success')` is the contract — a ValidationResponse
      // — and is stronger than `toBeDefined()`, which would pass for any
      // non-undefined resolution.
      await expect(adapter.validateAtPath(probe, undefined)).resolves.toHaveProperty('success')
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
