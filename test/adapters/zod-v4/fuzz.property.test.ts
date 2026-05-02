import { fc, test } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { z } from 'zod'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v4'
import { buildZodRootObjectArbitrary } from '../../utils/zod-arbitraries'

/**
 * Property tests: the v4 adapter is total and consistent over arbitrary
 * supported schemas. Depth is capped at 3 (so the largest generated tree
 * has three layers of containers below the root ZodObject) to keep runs
 * cheap while still exercising every wrapper / container combination.
 *
 * numRuns defaults to fast-check's 100 — the schema arbitrary is a
 * reasonable mix of leaves vs. containers, so 100 samples exercise each
 * shape. If these tests become a pain point in CI wall-time, drop to 50.
 */

const arbRootSchema = buildZodRootObjectArbitrary(z, 3, (inner) => z.record(z.string(), inner))

describe('zod v4 adapter — fuzz over arbitrary supported schemas', () => {
  test.prop([arbRootSchema])('adapter construction never throws on supported schemas', (schema) => {
    expect(() => zodAdapter(schema as z.ZodObject)('f')).not.toThrow()
  })

  test.prop([arbRootSchema])('getDefaultValues returns a success response', (schema) => {
    const adapter = zodAdapter(schema as z.ZodObject)('f')
    const result = adapter.getDefaultValues({
      useDefaultSchemaValues: true,
      strict: false,
    })
    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
  })

  test.prop([arbRootSchema])(
    'validateAtPath(defaultValues, undefined) passes in lax mode',
    async (schema) => {
      // Lax mode round-trip: the shape the adapter derives for defaults
      // must validate against the slimmed (refinement-stripped) schema.
      // Since the arbitrary doesn't produce refinements, this reduces to
      // "does the shape match the shape" — any failure is a bug in the
      // default-values derivation.
      const adapter = zodAdapter(schema as z.ZodObject)('f')
      const initial = adapter.getDefaultValues({
        useDefaultSchemaValues: true,
        strict: false,
      })
      expect(initial.success).toBe(true)
      const validation = await adapter.validateAtPath(initial.data, undefined)
      expect(validation.success).toBe(true)
    }
  )

  test.prop([arbRootSchema, fc.string({ minLength: 1, maxLength: 8 })])(
    'every produced ValidationError (when constraints violate strict mode) carries the right formKey',
    (schema, formKey) => {
      const adapter = zodAdapter(schema as z.ZodObject)(formKey)
      // Strict-mode getDefaultValues may surface errors for refinements that
      // a derived blank shape doesn't satisfy. Since we don't generate
      // refinements the success path is the common outcome, but if the
      // adapter ever produces errors here they must carry our key.
      const result = adapter.getDefaultValues({
        useDefaultSchemaValues: true,
        strict: true,
      })
      if (!result.success) {
        for (const err of result.errors) {
          expect(err.formKey).toBe(formKey)
        }
      }
    }
  )
})
