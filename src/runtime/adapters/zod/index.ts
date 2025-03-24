import { cloneDeep, isFunction, merge, set } from 'lodash-es'
import { z } from 'zod'
import { PATH_SEPARATOR } from '../../lib/core/utils/constants'
import { isPrimitive } from '../../lib/core/utils/helpers'
import type { AbstractSchema, FormKey, ValidationError } from '../../types/types-api'
import type { NestedType } from '../../types/types-core'
import type { TypeWithNullableDynamicKeys, ZodTypeWithInnerType } from '../../types/types-zod'
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
      const [_schema, stripped] = stripRootSchema(_zodSchema, {
        stripDefaultValues: true,
        stripNullable: true,
        stripOptional: true,
        stripZodEffects: true,
        stripZodRefinements: true,
      })
      if (!isZodSchemaType(_schema, 'ZodObject')) {
        const actualUnwrappedSchemaName = (_schema as ZodTypeWithInnerType)?._def?.typeName
        const actualOriginalSchemaName = (_zodSchema as unknown as ZodTypeWithInnerType)?._def
          ?.typeName
        const actualSchemaName = actualUnwrappedSchemaName ?? actualOriginalSchemaName
        const unwrappedMessage = actualUnwrappedSchemaName ? 'unwrapped' : ''

        const expectedUnwrappedMessage = stripped ? ' unwrapped ' : ' '
        const actualSchemaMessage = actualSchemaName
          ? `, got ${unwrappedMessage} schema of type '${actualSchemaName}' instead.`
          : '.'

        throw new Error(
          `Programming error: ZodAdapter expected${expectedUnwrappedMessage}schema of type 'ZodObject'${actualSchemaMessage}`
        )
      }
    }
    const abstractSchema: AbstractSchema<Form, GetValueFormType> = {
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

        if (!success) {
          // use error messages to dynamically construct correct initial state
          for (const issue of error.issues) {
            const path = issue.path.join(PATH_SEPARATOR)
            const schemasAtPath = getNestedZodSchemasAtPath(slimSchema, path)
            if (!schemasAtPath.length) {
              console.error(
                `Could not find any nested schemas belonging to form with key '${_formKey}' at path '${path}'`
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

        // yes, throw if we genuinely can't construct the initial state!
        const parsedData = slimSchema.parse(fixedData)

        return {
          data: parsedData as Form,
          errors: error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path,
            formKey: _formKey,
          })),
          success,
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

        if (!nestedZodSchemas.length) {
          console.error(
            `Programming Error: Could not calculate nested schema at path '${path}' for form with key '${_formKey}'`
          )
          return []
        }

        return nestedZodSchemas.map((n) =>
          getAbstractSchema(_formKey, n as NestedType<Form, typeof path>, false)
        )
      },
      validateAtPath(data, path) {
        if (path === undefined) {
          const { success, data: successData, error } = _zodSchema.safeParse(data)
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

        if (!nestedZodSchemas.length) {
          console.error(
            `Programming Error: Could not calculate nested schema at path '${path}' for form with key '${_formKey}'`
          )

          return {
            data: undefined,
            errors: NO_SCHEMAS_FOUND_AT_PATH_OF_CONCRETE_SCHEMA(
              path.split(PATH_SEPARATOR),
              _formKey
            ),
            success: false,
            formKey: _formKey,
          }
        }

        const accumulatedErrors: z.ZodError<unknown>[] = []
        for (const nestedSchema of nestedZodSchemas) {
          const { data: successData, success, error } = nestedSchema.safeParse(data)

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

// Note: this function assumes a sufficiently stripped schema
function getNestedZodSchemasAtPath<Schema extends z.ZodSchema>(
  zodSchema: Schema,
  path: string
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
  const keys = path.split(PATH_SEPARATOR)

  let currentSchema: z.ZodSchema | undefined = zodSchema

  for (let index = 0; index < keys.length; index++) {
    const key = keys[index] ?? ''
    if (isZodSchemaType(currentSchema, 'ZodObject')) {
      const shape = currentSchema._def.shape() as z.ZodRawShape
      currentSchema = shape[key]
    } else if (isZodSchemaType(currentSchema, 'ZodArray')) {
      currentSchema = currentSchema._def.type
    } else if (isZodSchemaType(currentSchema, 'ZodRecord')) {
      currentSchema = currentSchema._def.valueType
    } else if (isZodSchemaType(currentSchema, 'ZodDiscriminatedUnion')) {
      const optionalSchemas = getOptionSchemasFromDiscriminatorByArbitraryKey(currentSchema, key)

      const remainingKeys = keys.slice(index)
      const remainingPath = remainingKeys.join(PATH_SEPARATOR)
      if (!remainingKeys.length) return optionalSchemas

      // recursively check the option schemas
      const foundSchemas: z.ZodType<unknown, z.ZodTypeDef, unknown>[] = []
      for (const optionSchema of optionalSchemas) {
        getNestedZodSchemasAtPath(optionSchema, remainingPath).forEach((schema) => {
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
  let currentSchema: z.ZodTypeAny | undefined = schema

  while (currentSchema) {
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

    // If the schema is any other type, return undefined
    break
  }

  return undefined
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
      throw new Error('Programming error: discriminatorContext.schema is unspecified.')
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
      throw new Error('Programming error: ZodDiscriminatedUnion default option schema not found.')
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
  if (expected === 'bigint') return 0
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
  if (expected === 'never' || expected === 'void') return undefined
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
      return Object.keys(shape).reduce(
        (acc, key) => {
          acc[key] = generateValue(shape[key])
          return acc
        },
        {} as Record<string, unknown>
      )
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

    console.warn(
      `Unsupported schema type: ${schema.constructor.name}. Check form schema with key '${formKey}'.`
    )
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
    return discriminator && discriminator._def.value === key
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
  if (!schema || !('checks' in schemaDef)) return false

  const checks = schemaDef['checks'] as unknown

  if (!Array.isArray(checks)) return false

  return !!checks.length
}

function stripRefinements<T extends z.ZodTypeAny>(schema: T) {
  function _stripRefinements(_schema: z.ZodTypeAny): z.ZodTypeAny {
    if (isZodSchemaType(_schema, 'ZodString') && _schema._def.checks?.length) {
      // Rebuild a ZodString without checks
      return z.string()
    }

    if (isZodSchemaType(_schema, 'ZodNumber') && _schema._def.checks?.length) {
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

    if (!_schema) {
      throw new Error(
        "Form schema is falsy after attempting to remove ZodNullable, ZodNullish, and/or ZodEffects classes recursively in the 'recursion' function, called by 'stripRootSchema'. Is your schema valid?"
      )
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
  if (!stripValueOrCallback) return false

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
        if (!slimmedSchema) continue

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
