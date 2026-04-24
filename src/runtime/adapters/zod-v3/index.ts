import { cloneDeep, isFunction, merge, set } from 'lodash-es'
// Imports zod v3 via the pnpm alias defined in devDependencies; the
// published bundle rewrites this specifier back to 'zod' via the build
// step (see build.config.ts). Consumers of `@chemical-x/forms/zod-v3`
// install zod@3 themselves and the resolved import works.
import { z } from 'zod-v3'
import type { AbstractSchema, FormKey, ValidationError } from '../../types/types-api'

// The adapter speaks the pre-rewrite dotted-string path format at the
// AbstractSchema boundary; core passes dotted strings to validateAtPath
// and getSchemasAtPath for now. Phase 4 migrates the adapter to
// `Path` (Segment[]) as part of the v3/v4 split.
const PATH_SEPARATOR = '.'

function isPrimitive(input: unknown): boolean {
  const type = typeof input
  if (
    type === 'string' ||
    type === 'number' ||
    type === 'boolean' ||
    type === 'bigint' ||
    type === 'undefined'
  )
    return true
  return input === null
}

import type { TypeWithNullableDynamicKeys, ZodTypeWithInnerType } from './types-zod'
import { fingerprintZodSchema } from './fingerprint'
import { isZodSchemaType } from './helpers'

export function zodAdapter<
  FormSchema extends z.ZodSchema,
  Form extends z.infer<FormSchema>,
  GetValueFormType extends TypeWithNullableDynamicKeys<FormSchema>,
>(zodSchema: FormSchema): (formKey: FormKey) => AbstractSchema<Form, GetValueFormType> {
  function getAbstractSchema(
    _formKey: FormKey,
    _zodSchema: FormSchema,
    _isRootSchema: boolean
  ): AbstractSchema<Form, GetValueFormType> {
    if (_isRootSchema) {
      const [_schema] = stripRootSchema(_zodSchema, {
        stripDefaultValues: true,
        stripNullable: true,
        stripOptional: true,
        stripZodEffects: true,
        stripZodRefinements: true,
      })
      if (!isZodSchemaType(_schema, 'ZodObject')) {
        const name = (_schema as ZodTypeWithInnerType)._def.typeName
        throw new Error(`ZodAdapter: expected ZodObject, got ${name}`)
      }
    }
    const abstractSchema: AbstractSchema<Form, GetValueFormType> = {
      fingerprint: () => fingerprintZodSchema(_zodSchema),
      getInitialState(config) {
        const initialStateWithoutConstraints = getInitialStateFromZodSchema(
          _zodSchema,
          config.useDefaultSchemaValues,
          _formKey
        )

        const slimSchema = getSlimSchema({
          schema: _zodSchema,
          stripConfig: {
            stripZodEffects: true,
            stripDefaultValues: true,
            stripZodRefinements: (config.validationMode ?? 'lax') === 'lax', // default to lax (strip refinements like string.min etc)
          },
        })

        let rawInitialState = initialStateWithoutConstraints
        if (!isPrimitive(rawInitialState)) {
          rawInitialState = merge(initialStateWithoutConstraints, config.constraints)
        } else if (slimSchema.safeParse(config.constraints).success) {
          // updated rawInitialState with config.constraints, which is compatible with the _zodSchema
          rawInitialState = config.constraints
        }

        const { data, success, error } = slimSchema.safeParse(rawInitialState)

        if (success) {
          return {
            data: data as Form,
            errors: undefined,
            success,
            formKey: _formKey,
          }
        }

        let fixedData = {}

        // `if (success) return ...` above handles the happy path; below we're
        // always in the failure case.
        {
          // use error messages to dynamically construct correct initial state
          for (const issue of error.issues) {
            const schemasAtPath = getNestedZodSchemasAtPath(slimSchema, issue.path)
            // `set` from lodash accepts a Segment[] directly; keeps the
            // literal-dot case (`['user.name']`) from being flattened
            // into two key accesses.
            const path = [...issue.path]
            if (!schemasAtPath.length) {
              console.error(
                `No schemas at path '${issue.path.join(PATH_SEPARATOR)}' for key '${_formKey}'`
              )
              continue
            }

            for (const schemaAtPath of schemasAtPath) {
              if (issue.code === 'invalid_type') {
                const isDiscriminatedUnion = isZodSchemaType(schemaAtPath, 'ZodDiscriminatedUnion')
                const defaultValueContext: DefaultValueContext = isDiscriminatedUnion
                  ? {
                      formKey: _formKey,
                      discriminator: {
                        isDiscriminatorKey: true,
                        schema: schemaAtPath,
                        useDefaultSchemaValues: false,
                      },
                    }
                  : {
                      formKey: _formKey,
                      discriminator: {
                        isDiscriminatorKey: false,
                        schema: undefined,
                        useDefaultSchemaValues: false,
                      },
                    }
                const defaultValue = getDefaultValue(issue.expected, defaultValueContext)
                set(fixedData, path, defaultValue)
                continue
              }

              if (issue.code === 'invalid_enum_value') {
                const [defaultValue, found] = unwrapDefault(schemaAtPath)
                set(fixedData, path, found ? defaultValue : issue.options[0])
                continue
              }

              if (issue.code === 'invalid_literal') {
                set(fixedData, path, issue.expected)
                continue
              }

              const { success, data } = slimSchema.safeParse(fixedData)
              if (success) {
                fixedData = data // nested state resolved at path!
                break
              }
            }
          }
          fixedData = merge(rawInitialState, fixedData)
        }

        // Best-effort re-parse: if the fix-up loop couldn't fully
        // reconcile the data (nested unions whose branches don't match
        // the defaulted shape, bigint edge cases), return the partial
        // data instead of throwing. Matches the v4 adapter's lax
        // semantics — a partially-valid initial state is preferable
        // to a mount-time exception.
        const secondParse = slimSchema.safeParse(fixedData)
        const finalData = secondParse.success ? secondParse.data : fixedData

        if ((config.validationMode ?? 'lax') === 'lax') {
          return {
            data: finalData as Form,
            errors: undefined,
            success: true,
            formKey: _formKey,
          }
        }

        // Strict mode: if the second parse succeeded, the fix-up loop
        // reconciled the data and the issues from the first parse no
        // longer apply. Report success. Only surface the first-parse
        // issues when the fix-up couldn't resolve them.
        if (secondParse.success) {
          return {
            data: finalData as Form,
            errors: undefined,
            success: true,
            formKey: _formKey,
          }
        }

        return {
          data: finalData as Form,
          errors: error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path,
            formKey: _formKey,
          })),
          success: false,
          formKey: _formKey,
        }
      },
      getSchemasAtPath(path) {
        const [strippedSchema] = stripRootSchema(_zodSchema, {
          stripDefaultValues: true,
          stripNullable: true,
          stripOptional: true,
          stripZodEffects: true,
        })
        const slimSchema = getSlimSchema({
          schema: strippedSchema,
          stripConfig: {
            stripDefaultValues: true,
            stripZodEffects: true,
          },
        })
        const nestedZodSchemas = getNestedZodSchemasAtPath(slimSchema, path)

        // Empty list is a valid result for paths the schema doesn't
        // declare — callers (getValue / register / custom introspection)
        // treat `[]` as "no sub-schema here". No warning needed.
        if (!nestedZodSchemas.length) return []

        return nestedZodSchemas.map((n) =>
          getAbstractSchema(_formKey, n as unknown as FormSchema, false)
        ) as unknown as AbstractSchema<unknown, GetValueFormType>[]
      },
      async validateAtPath(data, path) {
        if (path === undefined) {
          // safeParseAsync accepts both sync and async refinements —
          // matches the v4 adapter's contract so .refine(async ...) is a
          // first-class schema feature for both adapters.
          const { success, data: successData, error } = await _zodSchema.safeParseAsync(data)
          if (success) {
            return {
              data: successData,
              success,
              errors: undefined,
              formKey: _formKey,
            }
          }

          return {
            success,
            data: undefined,
            errors: zodIssuesToValidationErrors(error.issues, _formKey),
            formKey: _formKey,
          }
        }

        const [strippedSchema] = stripRootSchema(_zodSchema, {
          stripDefaultValues: true,
          stripNullable: true,
          stripOptional: true,
        })
        const slimSchema = getSlimSchema({
          schema: strippedSchema,
          stripConfig: {
            stripDefaultValues: true,
          },
        })
        const nestedZodSchemas = getNestedZodSchemasAtPath(slimSchema, path)

        // The structured ValidationError in the return already tells
        // the caller the path didn't resolve — no extra console noise.
        if (!nestedZodSchemas.length) {
          return {
            data: undefined,
            errors: NO_SCHEMAS_FOUND_AT_PATH_OF_CONCRETE_SCHEMA([...path], _formKey),
            success: false,
            formKey: _formKey,
          }
        }

        // Branch-by-branch sequential await — parallelising would run
        // every branch's async side effects on a value only one branch
        // should see. See the v4 adapter's matching comment.
        const accumulatedErrors: z.ZodError<unknown>[] = []
        for (const nestedSchema of nestedZodSchemas) {
          const { data: successData, success, error } = await nestedSchema.safeParseAsync(data)

          if (!success) {
            accumulatedErrors.push(error)
            continue // try with remaining nested schemas
          }

          return {
            data: successData,
            errors: undefined,
            success: true,
            formKey: _formKey,
          }
        }

        // no nested schemas matched, this is a failure mode
        const allIssues = accumulatedErrors.reduce<z.ZodIssue[]>(
          (accumulator, _error) => [...accumulator, ..._error.issues],
          []
        )
        return {
          data: undefined,
          errors: zodIssuesToValidationErrors(allIssues, _formKey),
          success: false,
          formKey: _formKey,
        }
      },
    }

    return abstractSchema
  }

  return (formKey: FormKey) => getAbstractSchema(formKey, zodSchema, true)
}

function zodIssuesToValidationErrors(issues: z.ZodIssue[], formKey: FormKey): ValidationError[] {
  const validationErrors: ValidationError[] = []
  for (const issue of issues) {
    validationErrors.push({
      message: issue.message,
      path: issue.path,
      formKey: formKey,
    })
  }

  return validationErrors
}

const NO_SCHEMAS_FOUND_AT_PATH_OF_CONCRETE_SCHEMA = (path: (string | number)[], formKey: FormKey) =>
  [
    {
      message: `Programming Error: useForm.validateAtPath failed to find 1 or more schemas corresponding to the path ${path} in the concrete schema. Does the nested schema exist on form with key '${formKey}'?`,
      path,
      formKey,
    },
  ] satisfies ValidationError[]

// Note: this function assumes a sufficiently stripped schema.
// Walks a canonical `Segment[]` directly — every literal-dot key is
// treated as a single segment, so a field named `"user.email"` no
// longer collides with the sibling pair `['user', 'email']`.
function getNestedZodSchemasAtPath<Schema extends z.ZodSchema>(
  zodSchema: Schema,
  segments: readonly (string | number)[]
): z.ZodType<unknown, z.ZodTypeDef, unknown>[] {
  // ZodDiscriminator has multiple schemas in the options array
  // Check all of them for the key, and probe all possibilities
  function getOptionSchemasFromDiscriminatorByArbitraryKey<
    Discriminator extends string,
    Options extends readonly z.ZodDiscriminatedUnionOption<Discriminator>[],
  >(schema: z.ZodDiscriminatedUnion<Discriminator, Options>, key: string) {
    const successfulOptions = []
    const options = schema._def.options
    for (const option of options) {
      if (!(key in option.shape)) continue
      successfulOptions.push(option)
    }

    return successfulOptions
  }

  let currentSchema: z.ZodSchema | undefined = zodSchema

  for (let index = 0; index < segments.length; index++) {
    const key = String(segments[index] ?? '')
    if (isZodSchemaType(currentSchema, 'ZodObject')) {
      const shape = currentSchema._def.shape() as z.ZodRawShape
      currentSchema = shape[key]
    } else if (isZodSchemaType(currentSchema, 'ZodArray')) {
      currentSchema = currentSchema._def.type
    } else if (isZodSchemaType(currentSchema, 'ZodRecord')) {
      currentSchema = currentSchema._def.valueType
    } else if (isZodSchemaType(currentSchema, 'ZodDiscriminatedUnion')) {
      const optionalSchemas = getOptionSchemasFromDiscriminatorByArbitraryKey(currentSchema, key)

      const remainingSegments = segments.slice(index)
      if (!remainingSegments.length) return optionalSchemas

      // recursively check the option schemas
      const foundSchemas: z.ZodType<unknown, z.ZodTypeDef, unknown>[] = []
      for (const optionSchema of optionalSchemas) {
        getNestedZodSchemasAtPath(optionSchema, remainingSegments).forEach((schema) => {
          foundSchemas.push(schema)
        })
      }

      return foundSchemas
    }
  }

  if (!currentSchema) return []
  return [currentSchema]
}

function unwrapToDiscriminatedUnion(
  schema: z.ZodTypeAny
): z.ZodDiscriminatedUnion<string, readonly z.ZodDiscriminatedUnionOption<string>[]> | undefined {
  let currentSchema: z.ZodTypeAny = schema

  // `innerType` on ZodDefault/Optional/Nullable is a ZodType (non-nullable),
  // so we loop unconditionally and exit via `return`.
  for (;;) {
    // If the schema is a discriminated union, return it
    if (isZodSchemaType(currentSchema, 'ZodDiscriminatedUnion')) {
      return currentSchema
    }

    // Handle ZodDefault, ZodOptional, and ZodNullable
    if (
      isZodSchemaType(currentSchema, 'ZodDefault') ||
      isZodSchemaType(currentSchema, 'ZodOptional') ||
      isZodSchemaType(currentSchema, 'ZodNullable')
    ) {
      currentSchema = currentSchema._def.innerType
      continue
    }

    // Any other type: give up.
    return undefined
  }
}

type DefaultValueContext = {
  formKey: FormKey
  discriminator: { useDefaultSchemaValues: boolean } & {
    isDiscriminatorKey: boolean
    schema:
      | z.ZodDiscriminatedUnion<string, readonly z.ZodDiscriminatedUnionOption<string>[]>
      | undefined
  }
}

function getDefaultValue(
  expected: z.ZodInvalidTypeIssue['expected'],
  context: DefaultValueContext
) {
  // special default value for discriminated unions:
  const discriminatorContext = context.discriminator
  if (discriminatorContext.isDiscriminatorKey) {
    if (!discriminatorContext.schema) {
      throw new Error('discriminatorContext.schema unspecified')
    }

    if (!isZodSchemaType(discriminatorContext.schema, 'ZodDiscriminatedUnion')) {
      throw new TypeError(
        'Programming error: discriminatorContext.schema is not a ZodDiscriminatedUnion schema.'
      )
    }

    const defaultDiscriminatorKey = undefined
    const optionDiscriminator = getSchemaByDiscriminatorKey(
      discriminatorContext.schema,
      defaultDiscriminatorKey
    )

    if (!optionDiscriminator) {
      throw new Error('ZodDiscriminatedUnion: default option not found')
    }

    return getInitialStateFromZodSchema(
      optionDiscriminator,
      discriminatorContext.useDefaultSchemaValues,
      context.formKey
    )
  }

  if (expected === 'string') return ''
  if (expected === 'number') return 0
  if (expected === 'array') return []
  if (expected === 'boolean') return false
  if (expected === 'bigint') return 0n
  if (expected === 'float') return 0.0
  if (expected === 'integer') return 0
  if (expected === 'null') return null
  if (expected === 'object') return {}
  if (expected === 'set') return new Set()
  if (expected === 'date') return new Date()
  if (expected === 'map') return new Map()
  if (expected === 'promise') return new Promise((res) => res(undefined))
  if (expected === 'symbol') return Symbol()
  if (expected === 'function') return () => undefined
  if (expected === 'undefined') return undefined
  if (expected === 'unknown') return undefined
  if (expected === 'nan') return Number('nan')
  // 'never' and 'void' fall through to the default below.
  return undefined
}

function unwrapDefault(schema: z.ZodTypeAny): [unknown, boolean] {
  // If it's a ZodDefault, return its default value
  if (isZodSchemaType(schema, 'ZodDefault')) {
    const defaultValue = schema._def.defaultValue()
    return [defaultValue, true]
  }

  // Handle nullable, optional types: unwrap their inner type
  if (isZodSchemaType(schema, 'ZodNullable') || isZodSchemaType(schema, 'ZodOptional')) {
    return unwrapDefault(schema._def.innerType)
  }

  // Handle ZodEffects - check its effect property
  if (isZodSchemaType(schema, 'ZodEffects')) {
    // If the effect is a ZodType, we continue unwrapping it
    if (isZodSchemaType(schema._def.effect, 'ZodType')) {
      return unwrapDefault(schema._def.effect) // Continue unwrapping the schema wrapped by the effect
    } else {
      // If it's not a ZodType, recurse into the inner type and continue unwrapping
      return unwrapDefault(schema.innerType())
    }
  }

  // If no default found, return null
  return [null, false]
}

function getInitialStateFromZodSchema<
  FormSchema extends z.ZodSchema,
  Form extends z.infer<FormSchema>,
>(formSchema: FormSchema, useDefaultSchemaValues: boolean, formKey: FormKey): Form {
  // Recursive function to generate the initial value based on schema type
  function generateValue(schema: z.ZodTypeAny): unknown {
    // Recursive helper to unwrap layers and detect ZodDefault
    // Check if the schema (or any wrapped version) has a ZodDefault
    if (useDefaultSchemaValues) {
      const [defaultValue, foundDefaultValue] = unwrapDefault(schema)
      if (foundDefaultValue) {
        return defaultValue // Prioritize the 1st default value (if it exists)
      }
    }

    // Handle nullable
    if (isZodSchemaType(schema, 'ZodNullable')) {
      return null // No default, so return null
    }

    // Handle objects
    if (isZodSchemaType(schema, 'ZodObject')) {
      const shape = schema.shape
      return Object.keys(shape).reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = generateValue(shape[key])
        return acc
      }, {})
    }

    // Handle arrays
    if (isZodSchemaType(schema, 'ZodArray')) {
      return []
    }

    // Handle strings
    if (isZodSchemaType(schema, 'ZodString')) {
      return ''
    }

    // Handle numbers
    if (isZodSchemaType(schema, 'ZodNumber')) {
      return 0
    }

    // Handle bigints — must be a bigint literal; z.bigint() rejects
    // number 0. Without this branch we fall through to the warn-path
    // and the fix-up loop has to reconcile it via getDefaultValue.
    if (isZodSchemaType(schema, 'ZodBigInt')) {
      return 0n
    }

    // Handle dates — matches v4's `new Date(0)` so SSR round-trip is
    // deterministic across server + client.
    if (isZodSchemaType(schema, 'ZodDate')) {
      return new Date(0)
    }

    // Handle booleans
    if (isZodSchemaType(schema, 'ZodBoolean')) {
      return false
    }

    // Handle enums
    if (isZodSchemaType(schema, 'ZodEnum')) {
      return schema.options[0]
    }

    // Handle null
    if (isZodSchemaType(schema, 'ZodNull')) {
      return null
    }

    // Handle undefined
    if (isZodSchemaType(schema, 'ZodUndefined')) {
      return undefined
    }

    // Handle literals
    if (isZodSchemaType(schema, 'ZodLiteral')) {
      return schema._def.value
    }

    // Handle optional
    if (isZodSchemaType(schema, 'ZodOptional')) {
      return undefined
    }

    // Handle unions (use the first option as the default)
    if (isZodSchemaType(schema, 'ZodUnion')) {
      return generateValue(schema._def.options[0])
    }

    // Handle tuples
    if (isZodSchemaType(schema, 'ZodTuple')) {
      return schema._def.items.map((item: z.ZodTypeAny) => generateValue(item))
    }

    // Handle records
    if (isZodSchemaType(schema, 'ZodRecord')) {
      return {}
    }

    // Finding ZodDefault here means we should suppress defaults
    // Can only happen if useDefaultSchemaValues is false
    if (isZodSchemaType(schema, 'ZodDefault')) {
      return generateValue(schema._def.innerType)
    }

    if (isZodSchemaType(schema, 'ZodEffects')) {
      return generateValue(schema.innerType())
    }

    if (isZodSchemaType(schema, 'ZodDiscriminatedUnion')) {
      const discriminantKey = undefined // select default option schema
      const discriminantSchema = getSchemaByDiscriminatorKey(schema, discriminantKey)
      return generateValue(discriminantSchema as z.ZodTypeAny)
    }

    console.warn(`Unsupported schema: ${schema.constructor.name} (key '${formKey}')`)
    return null
  }

  return generateValue(formSchema) as unknown as Form
}
// helpful tip: discriminator option schemas are always zod objects (because of discriminant key)
function getSchemaByDiscriminatorKey(
  unionSchema: z.ZodTypeAny | z.ZodSchema,
  key: string | undefined
): z.ZodObject<z.ZodRawShape> | undefined {
  // Check if the schema is a discriminated union
  if (!isZodSchemaType(unionSchema, 'ZodDiscriminatedUnion')) {
    throw new TypeError('Provided schema is not a discriminated union.')
  }

  // return first/default option schema if no key is provided
  if (key === undefined) {
    const options = unionSchema._def.options
    if (!options.length) {
      throw new TypeError('Provided ZodDiscriminatedUnion does not have any options')
    }
    return options[0]
  }

  // Find the schema with the matching discriminator value
  return unionSchema._def.options.find((schema: z.ZodObject<z.ZodRawShape>) => {
    const discriminator = schema.shape[unionSchema._def.discriminator]
    return discriminator?._def.value === key
  })
}

type StripConfigCallback = (schema: z.ZodTypeAny | z.ZodSchema) => boolean

type StripConfig = {
  stripNullable?: boolean | StripConfigCallback
  stripOptional?: boolean | StripConfigCallback
  stripZodEffects?: boolean | StripConfigCallback
  stripZodRefinements?: boolean | StripConfigCallback
  stripDefaultValues?: boolean | StripConfigCallback
}

function hasChecks(schema: z.ZodTypeAny): boolean {
  if (!('_def' in schema)) return false

  const schemaDef = schema._def
  if (!('checks' in schemaDef)) return false

  const checks = schemaDef['checks'] as unknown

  if (!Array.isArray(checks)) return false

  return checks.length > 0
}

function stripRefinements<T extends z.ZodTypeAny>(schema: T) {
  function _stripRefinements(_schema: z.ZodTypeAny): z.ZodTypeAny {
    if (isZodSchemaType(_schema, 'ZodString') && _schema._def.checks.length > 0) {
      // Rebuild a ZodString without checks
      return z.string()
    }

    if (isZodSchemaType(_schema, 'ZodNumber') && _schema._def.checks.length > 0) {
      // Rebuild a ZodNumber without checks
      return z.number()
    }

    if (isZodSchemaType(_schema, 'ZodArray')) {
      // Recursively process the array's inner type
      return z.array(_stripRefinements(_schema._def.type))
    }

    if (isZodSchemaType(_schema, 'ZodObject')) {
      // Recursively process each property of the object
      const shape = _schema.shape
      const strippedShape = Object.fromEntries(
        Object.entries(shape).map(([key, value]) => [key, _stripRefinements(value as z.ZodTypeAny)])
      )
      return z.object(strippedShape)
    }

    if (isZodSchemaType(_schema, 'ZodEffects')) {
      // Unwrap the inner schema and strip refinements
      return _stripRefinements(_schema.innerType())
    }

    if (isZodSchemaType(_schema, 'ZodOptional')) {
      // Recursively strip optional's inner type
      return z.optional(_stripRefinements(_schema.unwrap()))
    }

    if (isZodSchemaType(_schema, 'ZodNullable')) {
      // Recursively strip nullable's inner type
      return z.nullable(_stripRefinements(_schema.unwrap()))
    }

    // Return other schema types as-is
    return _schema as T
  }

  return _stripRefinements(schema) as T
}

function stripRootSchema(schema: z.ZodSchema, stripConfig: StripConfig) {
  function recursion(_schema: z.ZodSchema, _stripped = false): [z.ZodSchema, boolean] {
    if (
      getStripInstruction(stripConfig.stripNullable, _schema) &&
      isZodSchemaType(_schema, 'ZodNullable')
    ) {
      return recursion(_schema.unwrap(), true)
    }

    if (
      getStripInstruction(stripConfig.stripOptional, _schema) &&
      isZodSchemaType(_schema, 'ZodOptional')
    ) {
      return recursion(_schema.unwrap(), true)
    }

    if (
      getStripInstruction(stripConfig.stripZodEffects, _schema) &&
      isZodSchemaType(_schema, 'ZodEffects')
    ) {
      return recursion(_schema.innerType(), true)
    }

    if (
      getStripInstruction(stripConfig.stripDefaultValues, _schema) &&
      isZodSchemaType(_schema, 'ZodDefault')
    ) {
      return recursion(_schema._def.innerType, true)
    }

    if (getStripInstruction(stripConfig.stripZodRefinements, _schema) && hasChecks(_schema)) {
      return recursion(stripRefinements(_schema))
    }

    return [_schema, _stripped]
  }

  return recursion(schema, false)
}

type SlimSchemaConfig<Schema> = {
  schema: Schema
  stripConfig: StripConfig
}

const getStripInstruction = (
  stripValueOrCallback: boolean | StripConfigCallback | undefined,
  schema: z.ZodTypeAny | z.ZodSchema
): boolean => {
  if (stripValueOrCallback === undefined || stripValueOrCallback === false) return false

  return isFunction(stripValueOrCallback) ? stripValueOrCallback(schema) : stripValueOrCallback
}

// make the schema more relaxed so we can construct a initial form state
// schema is based on ZodType in case we ever work with nested schemas
function getSlimSchema<RS extends z.ZodRawShape, Schema extends z.ZodSchema>(
  config: SlimSchemaConfig<Schema>
) {
  function _getSlimSchema(_schema: z.ZodSchema): z.ZodSchema {
    if (isZodSchemaType(_schema, 'ZodObject')) {
      const newShape: z.ZodRawShape = {}

      for (const key in _schema.shape) {
        const value = _schema.shape[key]
        newShape[key] = _getSlimSchema(value)
      }

      return z.object(newShape)
    }

    if (isZodSchemaType(_schema, 'ZodArray')) {
      return z.array(_getSlimSchema(_schema.element))
    }

    if (isZodSchemaType(_schema, 'ZodRecord')) {
      const key = _getSlimSchema(_schema._def.keyType)
      const value = _getSlimSchema(_schema._def.valueType)
      return z.record(key, value)
    }

    // same way we go into records, objects, and arrays, go into discriminated unions
    if (isZodSchemaType(_schema, 'ZodDiscriminatedUnion')) {
      const slimmedSchemas = []

      for (const option of _schema._def.options) {
        const slimmedSchema = _getSlimSchema(option)
        // slimmedSchema will be a structurally deep object, so break pointer refs to prevent recursion bugs
        const deepCloneSlimmedSchema = cloneDeep(slimmedSchema)
        slimmedSchemas.push(deepCloneSlimmedSchema)
      }

      return z.discriminatedUnion(
        _schema._def.discriminator,
        slimmedSchemas as unknown as readonly [
          z.ZodDiscriminatedUnionOption<string>,
          ...z.ZodDiscriminatedUnionOption<string>[],
        ]
      )
    }

    if (
      getStripInstruction(config.stripConfig.stripZodEffects, _schema) &&
      isZodSchemaType(_schema, 'ZodEffects')
    ) {
      return _getSlimSchema(_schema.innerType())
    }

    if (
      getStripInstruction(config.stripConfig.stripNullable, _schema) &&
      isZodSchemaType(_schema, 'ZodNullable')
    ) {
      return _getSlimSchema(_schema._def.innerType)
    }

    if (
      getStripInstruction(config.stripConfig.stripOptional, _schema) &&
      isZodSchemaType(_schema, 'ZodOptional')
    ) {
      return _getSlimSchema(_schema._def.innerType)
    }

    if (
      getStripInstruction(config.stripConfig.stripZodRefinements, _schema) &&
      hasChecks(_schema)
    ) {
      return stripRefinements(_schema)
    }

    if (
      getStripInstruction(config.stripConfig.stripDefaultValues, _schema) &&
      isZodSchemaType(_schema, 'ZodDefault')
    ) {
      return _getSlimSchema(_schema._def.innerType)
    }

    // Attempt to unwrap a schema to find a discriminated union (bail if you hit another valid schema type)
    const unionSchema = unwrapToDiscriminatedUnion(_schema)
    if (unionSchema && getStripInstruction(config.stripConfig.stripDefaultValues, unionSchema)) {
      return _getSlimSchema(unionSchema)
    }

    return _schema
  }

  const processedRootSchema = stripRootSchema(config.schema, config.stripConfig)[0]
  return _getSlimSchema(processedRootSchema) as unknown as z.ZodObject<RS>
}
