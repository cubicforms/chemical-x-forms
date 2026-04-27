import type { z } from 'zod'
import type { AbstractSchema, FormKey, ValidationError } from '../../types/types-api'
import type { DeepPartial, GenericForm } from '../../types/types-core'
import { assertSupportedKinds } from './assert-supported'
import { zodIssuesToValidationErrors } from './errors'
import { fingerprintZodSchema } from './fingerprint'
import { deriveDefault, getDefaultValuesFromZodSchema } from './default-values'
import { assertZodVersion, kindOf, unwrapInner } from './introspect'
import { getNestedZodSchemasAtPath } from './path-walker'

/**
 * Zod v4 adapter — implements `AbstractSchema` against Zod v4's public
 * surface. Internal (`def.*`) access is quarantined to introspect.ts and
 * the co-located modules (default-values, strip, path-walker, discriminator,
 * errors). This file is the wiring layer between those modules and the
 * framework's AbstractSchema contract.
 *
 * Feature parity with the v3 adapter:
 * - getDefaultValues: validate-then-fix loop (delegated to default-values.ts)
 *   with refinement stripping in lax mode; discriminated-union-aware
 *   first-option fallback for invalid_type issues.
 * - getSchemasAtPath: discriminated-union-aware path walker.
 * - validateAtPath: per-union-branch parse with aggregated errors.
 */

const PATH_SEPARATOR = '.'

/**
 * Peel `.optional()` / `.nullable()` wrappers off a leaf schema so
 * `getDefaultAtPath` returns the STRUCTURAL inner default — the slim
 * shape the runtime needs for structural-completeness fill — rather
 * than the wrapper-aware `undefined`/`null`. `.default(x)` is left
 * intact so `deriveDefault` returns the explicit default value.
 * Bounded iteration cap as a runaway guard for pathological wrappers.
 */
function unwrapStructuralWrappers(schema: z.ZodType): z.ZodType {
  let current: z.ZodType = schema
  for (let i = 0; i < 64; i++) {
    const k = kindOf(current)
    if (k === 'optional' || k === 'nullable') {
      const inner = unwrapInner(current)
      if (inner === undefined) return current
      current = inner
      continue
    }
    break
  }
  return current
}

export function zodV4Adapter<FormSchema extends z.ZodObject, Form extends z.infer<FormSchema>>(
  rootSchema: FormSchema
): (formKey: FormKey) => AbstractSchema<Form, Form> {
  assertZodVersion(rootSchema)
  // Fail fast at adapter construction if the schema uses kinds we can't
  // represent (z.promise / z.custom / z.templateLiteral) or a recursive
  // z.lazy(). Errors carry the dotted path to the offending node.
  assertSupportedKinds(rootSchema)

  return (formKey: FormKey): AbstractSchema<Form, Form> => {
    return {
      fingerprint: () => fingerprintZodSchema(rootSchema),

      getDefaultValues(config): ReturnType<AbstractSchema<Form, Form>['getDefaultValues']> {
        const { data } = getDefaultValuesFromZodSchema<Form>({
          schema: rootSchema,
          useDefaultSchemaValues: config.useDefaultSchemaValues,
          constraints: config.constraints,
        })

        if (config.validationMode === 'strict') {
          // Strict mode: run the *full* schema (not the slim one) so
          // refinement-level errors surface. If that passes, we're fine.
          //
          // `safeParse` throws synchronously when the schema contains an
          // async refine — `z.string().refine(async (v) => …)` produces a
          // Promise that the sync parser can't handle. Async refines
          // fundamentally can't seed errors at construction (the
          // `getDefaultValues` contract is sync); degrade gracefully and
          // let the runtime's first mutation kick off `validateAtPath`,
          // which uses `safeParseAsync`.
          try {
            const strictResult = rootSchema.safeParse(data) as z.ZodSafeParseResult<Form>
            if (strictResult.success) {
              return { data: strictResult.data, errors: undefined, success: true, formKey }
            }
            return {
              data,
              errors: zodIssuesToValidationErrors(strictResult.error.issues, formKey),
              success: false,
              formKey,
            }
          } catch {
            // Async-refine throw — fall through to the lax-mode return.
            // The form mounts cleanly; the user can call `validateAsync()`
            // after mount to surface async-refinement errors.
            return { data, errors: undefined, success: true, formKey }
          }
        }

        // Lax mode: the validate-then-fix loop has done everything it can;
        // a partially-valid initial state is preferable to a mount-time
        // exception. Matches v3's lax semantics.
        return { data, errors: undefined, success: true, formKey }
      },

      getDefaultAtPath(path) {
        // For empty path, the "default at root" is the schema's full
        // default — return the deriveDefault of the root, not the slim-
        // schema validate-then-fix loop (that's getDefaultValues' job).
        if (path.length === 0) return deriveDefault(rootSchema, true)
        const [first] = getNestedZodSchemasAtPath(rootSchema, path)
        if (first === undefined) return undefined
        // STRUCTURAL default: peel `.optional()` / `.nullable()` so the
        // result is the inner shape's default (`''` for an optional
        // string, `{ name: '' }` for an optional object). This is what
        // the runtime structural-completeness invariant needs: when a
        // consumer writes a partial object at an optional path, the lib
        // fills missing keys from the inner shape's structural defaults.
        // `.default(x)` is NOT peeled — the explicit default is the
        // canonical "fresh" value at that path. ZodReadonly / ZodCatch /
        // ZodPipe are handled inside `deriveDefault` itself.
        // First candidate matches validateAtPath's first-success semantic
        // and getDefaultValuesFromZodSchema's line-256 first-candidate
        // behavior.
        return deriveDefault(unwrapStructuralWrappers(first), true)
      },

      getSchemasAtPath(path) {
        const resolved = getNestedZodSchemasAtPath(rootSchema, path)
        return resolved.map(
          (schema) =>
            ({
              fingerprint: () => fingerprintZodSchema(schema),
              getDefaultValues: () => ({
                data: deriveDefault(schema, true),
                errors: undefined,
                success: true,
                formKey,
              }),
              getSchemasAtPath: () => [],
              validateAtPath: async (data: unknown) => {
                // safeParseAsync accepts both sync and async refinements —
                // sync check perf is a microtask slower than safeParse but
                // we trade that for the ability to express .refine(async).
                const result = await schema.safeParseAsync(data)
                if (result.success) {
                  return { data: result.data, errors: undefined, success: true, formKey }
                }
                return {
                  data: undefined,
                  errors: zodIssuesToValidationErrors(result.error.issues, formKey),
                  success: false,
                  formKey,
                }
              },
            }) as unknown as ReturnType<AbstractSchema<Form, Form>['getSchemasAtPath']>[number]
        )
      },

      async validateAtPath(data, path): ReturnType<AbstractSchema<Form, Form>['validateAtPath']> {
        if (path === undefined) {
          const result = (await rootSchema.safeParseAsync(data)) as z.ZodSafeParseResult<Form>
          if (result.success) {
            return { data: result.data, errors: undefined, success: true, formKey }
          }
          return {
            data: undefined,
            errors: zodIssuesToValidationErrors(result.error.issues, formKey),
            success: false,
            formKey,
          }
        }
        const resolved = getNestedZodSchemasAtPath(rootSchema, path)
        if (resolved.length === 0) {
          return {
            data: undefined,
            errors: [
              {
                message: `Path '${path.join(PATH_SEPARATOR)}' did not resolve to any schema`,
                path: [...path],
                formKey,
              },
            ],
            success: false,
            formKey,
          }
        }
        // Try each candidate (union branches); first success wins. The
        // loop awaits sequentially — parallel parses are tempting but
        // would run every branch's side effects (async refinements in
        // particular) on a value only one branch should see.
        const aggregated: ValidationError[] = []
        for (const candidate of resolved) {
          const result = await candidate.safeParseAsync(data)
          if (result.success) {
            return { data: result.data as Form, errors: undefined, success: true, formKey }
          }
          aggregated.push(...zodIssuesToValidationErrors(result.error.issues, formKey))
        }
        return {
          data: undefined,
          errors: aggregated,
          success: false,
          formKey,
        }
      },
    }
  }
}

// Type-only re-export so downstream code can reference the Form shape.
export type { DeepPartial, GenericForm }
