import type { z } from 'zod'
import type { AbstractSchema, FormKey, ValidationError } from '../../types/types-api'
import type { DeepPartial, GenericForm } from '../../types/types-core'
import { zodIssuesToValidationErrors } from './errors'
import { deriveDefault, getInitialStateFromZodSchema } from './initial-state'
import { assertZodVersion } from './introspect'
import { getNestedZodSchemasAtPath } from './path-walker'

/**
 * Zod v4 adapter — implements `AbstractSchema` against Zod v4's public
 * surface. Internal (`def.*`) access is quarantined to introspect.ts and
 * the co-located modules (initial-state, strip, path-walker, discriminator,
 * errors). This file is the wiring layer between those modules and the
 * framework's AbstractSchema contract.
 *
 * Feature parity with the v3 adapter:
 * - getInitialState: validate-then-fix loop (delegated to initial-state.ts)
 *   with refinement stripping in lax mode; discriminated-union-aware
 *   first-option fallback for invalid_type issues.
 * - getSchemasAtPath: discriminated-union-aware path walker.
 * - validateAtPath: per-union-branch parse with aggregated errors.
 */

const PATH_SEPARATOR = '.'

export function zodV4Adapter<FormSchema extends z.ZodObject, Form extends z.infer<FormSchema>>(
  rootSchema: FormSchema
): (formKey: FormKey) => AbstractSchema<Form, Form> {
  assertZodVersion(rootSchema)

  return (formKey: FormKey): AbstractSchema<Form, Form> => {
    return {
      getInitialState(config): ReturnType<AbstractSchema<Form, Form>['getInitialState']> {
        const { data } = getInitialStateFromZodSchema<Form>({
          schema: rootSchema,
          useDefaultSchemaValues: config.useDefaultSchemaValues,
          validationMode: config.validationMode ?? 'lax',
          constraints: config.constraints,
          formKey,
        })

        if (config.validationMode === 'strict') {
          // Strict mode: run the *full* schema (not the slim one) so
          // refinement-level errors surface. If that passes, we're fine.
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
        }

        // Lax mode: the validate-then-fix loop has done everything it can;
        // a partially-valid initial state is preferable to a mount-time
        // exception. Matches v3's lax semantics.
        return { data, errors: undefined, success: true, formKey }
      },

      getSchemasAtPath(path) {
        const resolved = getNestedZodSchemasAtPath(rootSchema, path)
        return resolved.map(
          (schema) =>
            ({
              getInitialState: () => ({
                data: deriveDefault(schema, true),
                errors: undefined,
                success: true,
                formKey,
              }),
              getSchemasAtPath: () => [],
              validateAtPath: (data: unknown) => {
                const result = schema.safeParse(data)
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

      validateAtPath(data, path): ReturnType<AbstractSchema<Form, Form>['validateAtPath']> {
        if (path === undefined) {
          const result = rootSchema.safeParse(data) as z.ZodSafeParseResult<Form>
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
                message: `Path '${path}' did not resolve to any schema`,
                path: path.split(PATH_SEPARATOR),
                formKey,
              },
            ],
            success: false,
            formKey,
          }
        }
        // Try each candidate (union branches); first success wins.
        const aggregated: ValidationError[] = []
        for (const candidate of resolved) {
          const result = candidate.safeParse(data)
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
