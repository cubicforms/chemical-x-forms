import { cloneDeep, isFunction, merge, set } from 'lodash-es'
// Imports zod v3 via the pnpm alias defined in devDependencies; the
// published bundle rewrites this specifier back to 'zod' via the build
// step (see build.config.ts). Consumers of `@chemical-x/forms/zod-v3`
// install zod@3 themselves and the resolved import works.
import { z } from 'zod-v3'
import type {
  AbstractSchema,
  FormKey,
  SlimPrimitiveKind,
  ValidationError,
} from '../../types/types-api'
import { getAtPath } from '../../core/path-walker'
import { slimKindOf } from '../../core/slim-primitive-gate'

// The adapter speaks the pre-rewrite dotted-string path format at the
// AbstractSchema boundary; core passes dotted strings to validateAtPath
// and getSchemasAtPath for now. Phase 4 migrates the adapter to
// `Path` (Segment[]) as part of the v3/v4 split.
const PATH_SEPARATOR = '.'

// Shared cap for every wrapper-peeling / unwrap helper in this file.
// Pathological schemas (deep `.refine()` chains, self-referential lazy
// loops) would otherwise stack-overflow or hang. 64 is generous for any
// realistic form schema; past it we bail conservatively rather than
// crash.
const MAX_UNWRAP_STEPS = 64

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

// Probe whether a primitive constraint passes the slim schema. Wrapped
// in try/catch because strict mode keeps refinements on the slim schema,
// and `safeParse` throws synchronously if any refine on the root is
// async.
function constraintsAreSlimValid(slimSchema: z.ZodSchema, constraints: unknown): boolean {
  try {
    return slimSchema.safeParse(constraints).success
  } catch {
    return false
  }
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
      getDefaultValues(config) {
        const defaultValuesWithoutConstraints = getDefaultValuesFromZodSchema(
          _zodSchema,
          config.useDefaultSchemaValues,
          _formKey
        )

        const slimSchema = getSlimSchema({
          schema: _zodSchema,
          stripConfig: {
            stripZodEffects: true,
            stripDefaultValues: true,
            // Lax strips refinements (so empty defaults pass); strict
            // keeps them so the slim parse below surfaces refinement
            // errors. Async refines are guarded by the try/catch
            // below — they can't be surfaced synchronously regardless.
            stripZodRefinements: (config.validationMode ?? 'lax') === 'lax',
          },
        })

        let rawDefaultValues = defaultValuesWithoutConstraints
        if (!isPrimitive(rawDefaultValues)) {
          rawDefaultValues = merge(defaultValuesWithoutConstraints, config.constraints)
        } else if (constraintsAreSlimValid(slimSchema, config.constraints)) {
          rawDefaultValues = config.constraints
        }

        // `safeParse` throws synchronously when the schema contains an
        // async refine ("Async refinement encountered during synchronous
        // parse"). Async refines can't be surfaced synchronously
        // regardless — the abstract `getDefaultValues` contract is sync.
        // Degrade gracefully: treat the schema as if it parsed cleanly,
        // so the form mounts. The first user mutation kicks off
        // `validateAtPath`, which uses `safeParseAsync`.
        let parseResult: ReturnType<typeof slimSchema.safeParse>
        try {
          parseResult = slimSchema.safeParse(rawDefaultValues)
        } catch {
          return {
            data: rawDefaultValues as Form,
            errors: undefined,
            success: true,
            formKey: _formKey,
          }
        }
        const { data, success, error } = parseResult

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
        //
        // Under the slim-primitive write contract, the validate-then-fix
        // loop only patches issues that violate STRUCTURAL or PRIMITIVE-TYPE
        // shape. Refinement-level issues (invalid_enum_value, invalid_literal,
        // invalid_string, too_small, too_big, custom, unrecognized_keys)
        // pass THROUGH unchanged — the user's defaultValues are preserved
        // verbatim and the strict-mode validation pass downstream surfaces
        // the error at construction.
        //
        // The classifier: look up the actual offending value at the issue's
        // path and check its slim primitive kind against the candidate
        // schema's slim primitive set. If the value's kind IS in the set,
        // the issue is refinement-level → skip. If it's NOT in the set,
        // the issue is primitive/structural → fix. Unifies every issue
        // code under one check.
        {
          for (const issue of error.issues) {
            const schemasAtPath = getNestedZodSchemasAtPath(slimSchema, issue.path)
            // `set` from lodash accepts a Segment[] directly; keeps the
            // literal-dot case (`['user.name']`) from being flattened
            // into two key accesses. Coerce in case a custom check
            // smuggled a Symbol — `path.join` would throw on it.
            const path = coercePathSegments(issue.path)
            if (!schemasAtPath.length) {
              console.error(
                `No schemas at path '${path.join(PATH_SEPARATOR)}' for key '${_formKey}'`
              )
              continue
            }

            // Refinement-vs-primitive classification.
            const candidate = schemasAtPath[0]
            if (candidate !== undefined) {
              const valueAtPath = getAtPath(rawDefaultValues, path)
              const slimKinds = slimPrimitivesV3(candidate as z.ZodTypeAny)
              if (slimKinds.size > 0 && slimKinds.has(slimKindOf(valueAtPath))) {
                // Refinement-level: pass through unchanged.
                continue
              }
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

              // Wrong-primitive issues with non-invalid_type codes (e.g.,
              // invalid_enum_value where the offending value is a number
              // against a string-enum). Fall back to the schema's default.
              const [defaultValue, found] = unwrapDefault(schemaAtPath)
              if (found) {
                set(fixedData, path, defaultValue)
                continue
              }
              // Last-ditch: derive a default for the schema kind at this
              // path. Skips if no useful default emerges.
              const ctx: DefaultValueContext = {
                formKey: _formKey,
                discriminator: {
                  isDiscriminatorKey: false,
                  schema: undefined,
                  useDefaultSchemaValues: false,
                },
              }
              // Use the slim primitive's first kind to derive a default.
              const slimKinds = slimPrimitivesV3(schemaAtPath as z.ZodTypeAny)
              const firstKind = [...slimKinds][0]
              if (firstKind !== undefined) {
                const expected =
                  firstKind === 'string'
                    ? 'string'
                    : firstKind === 'number'
                      ? 'number'
                      : firstKind === 'boolean'
                        ? 'boolean'
                        : firstKind === 'bigint'
                          ? 'bigint'
                          : firstKind === 'date'
                            ? 'date'
                            : firstKind === 'array'
                              ? 'array'
                              : firstKind === 'object'
                                ? 'object'
                                : null
                if (expected !== null) {
                  set(fixedData, path, getDefaultValue(expected, ctx))
                }
              }
            }
          }
          fixedData = merge(rawDefaultValues, fixedData)
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
            path: coercePathSegments(issue.path),
            formKey: _formKey,
          })),
          success: false,
          formKey: _formKey,
        }
      },
      getDefaultAtPath(path) {
        // Empty path → root default. Reuses the same generator used at
        // form construction so refines / wrappers behave consistently.
        if (path.length === 0) {
          return getDefaultValuesFromZodSchema(_zodSchema, true, _formKey)
        }
        const leaf = walkV3ToLeafSchema(_zodSchema, path)
        if (!leaf) return undefined
        // STRUCTURAL default: peel `.optional()` / `.nullable()` at the
        // leaf so partial-object writes through optional sub-schemas
        // (`{ profile: z.object({...}).optional() }`) get the inner
        // shape's defaults filled in. `.default(x)` is preserved so
        // `getDefaultValuesFromZodSchema` returns the explicit default.
        const peeled = unwrapStructuralLeafV3(leaf)
        return getDefaultValuesFromZodSchema(peeled as z.ZodSchema, true, _formKey)
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
      getSlimPrimitiveTypesAtPath(path) {
        if (path.length === 0) return new Set(['object'])
        const [strippedSchema] = stripRootSchema(_zodSchema, {
          stripDefaultValues: true,
          stripNullable: true,
          stripOptional: true,
          stripZodEffects: true,
        })
        const slimSchema = getSlimSchema({
          schema: strippedSchema,
          stripConfig: { stripDefaultValues: true, stripZodEffects: true },
        })
        const resolved = getNestedZodSchemasAtPath(slimSchema, path)
        if (resolved.length === 0) return new Set(PERMISSIVE_V3)
        const out = new Set<SlimPrimitiveKind>()
        for (const candidate of resolved) {
          for (const k of slimPrimitivesV3(candidate as z.ZodTypeAny)) out.add(k)
        }
        return out
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
      // `ValidationError.path` is `(string | number)[]` per the
      // public type. v3's `issue.path` is the same in the standard
      // case, but a custom check via `ctx.addIssue({ path: [...] })`
      // can smuggle a Symbol through — the public surface promised
      // strings/numbers, so coerce defensively to keep the contract.
      // Mirrors v4's behaviour at the same site.
      path: coercePathSegments(issue.path),
      formKey: formKey,
    })
  }

  return validationErrors
}

const PERMISSIVE_V3: ReadonlySet<SlimPrimitiveKind> = new Set<SlimPrimitiveKind>([
  'string',
  'number',
  'boolean',
  'bigint',
  'date',
  'null',
  'undefined',
  'object',
  'array',
  'symbol',
  'function',
  'map',
  'set',
])

const MAX_LAZY_DEPTH_V3 = 64

/**
 * Slim-primitive walker for v3. Returns the set of `SlimPrimitiveKind`s
 * a schema accepts at write time. Wrappers (ZodOptional / ZodNullable /
 * ZodDefault / ZodEffects / ZodPipeline / ZodReadonly / ZodBranded /
 * ZodCatch / ZodLazy) are peeled; refinement-level constraints are
 * ignored.
 *
 * Mirrors the v4 implementation in `src/runtime/adapters/zod-v4/slim-primitives.ts`.
 */
function slimPrimitivesV3(schema: z.ZodTypeAny, depth = 0): Set<SlimPrimitiveKind> {
  if (depth > MAX_LAZY_DEPTH_V3) return new Set(PERMISSIVE_V3)
  const def = (
    schema as {
      _def?: {
        typeName?: string
        innerType?: z.ZodTypeAny
        type?: z.ZodTypeAny
        schema?: z.ZodTypeAny
        in?: z.ZodTypeAny
        out?: z.ZodTypeAny
        getter?: () => z.ZodTypeAny
        options?: readonly z.ZodTypeAny[]
        left?: z.ZodTypeAny
        right?: z.ZodTypeAny
      }
    }
  )._def
  const typeName = def?.typeName

  if (isZodSchemaType(schema, 'ZodString')) return new Set(['string'])
  if (isZodSchemaType(schema, 'ZodNumber')) return new Set(['number'])
  if (isZodSchemaType(schema, 'ZodBoolean')) return new Set(['boolean'])
  if (isZodSchemaType(schema, 'ZodBigInt')) return new Set(['bigint'])
  if (isZodSchemaType(schema, 'ZodDate')) return new Set(['date'])
  if (isZodSchemaType(schema, 'ZodNull')) return new Set(['null'])
  if (isZodSchemaType(schema, 'ZodUndefined')) return new Set(['undefined'])
  if (typeName === 'ZodVoid') return new Set(['undefined'])
  if (typeName === 'ZodNaN') return new Set(['number'])

  if (isZodSchemaType(schema, 'ZodEnum')) {
    const options = (schema as z.ZodEnum<[string, ...string[]]>).options
    const out = new Set<SlimPrimitiveKind>()
    for (const v of options) {
      if (typeof v === 'string') out.add('string')
      else if (typeof v === 'number') out.add('number')
    }
    return out.size === 0 ? new Set(['string']) : out
  }
  if (isZodSchemaType(schema, 'ZodLiteral')) {
    const value = (schema as z.ZodLiteral<unknown>).value
    return new Set([slimKindOfRawV3(value)])
  }
  if (isZodSchemaType(schema, 'ZodObject') || typeName === 'ZodRecord') {
    return new Set(['object'])
  }
  if (isZodSchemaType(schema, 'ZodArray') || typeName === 'ZodTuple') {
    return new Set(['array'])
  }
  if (isZodSchemaType(schema, 'ZodOptional')) {
    const inner = def?.innerType
    const innerSet =
      inner === undefined ? new Set<SlimPrimitiveKind>() : slimPrimitivesV3(inner, depth + 1)
    innerSet.add('undefined')
    return innerSet
  }
  if (isZodSchemaType(schema, 'ZodNullable')) {
    const inner = def?.innerType
    const innerSet =
      inner === undefined ? new Set<SlimPrimitiveKind>() : slimPrimitivesV3(inner, depth + 1)
    innerSet.add('null')
    return innerSet
  }
  if (
    isZodSchemaType(schema, 'ZodDefault') ||
    isZodSchemaType(schema, 'ZodReadonly') ||
    isZodSchemaType(schema, 'ZodCatch') ||
    isZodSchemaType(schema, 'ZodBranded')
  ) {
    const inner = def?.innerType ?? def?.type
    return inner === undefined ? new Set(PERMISSIVE_V3) : slimPrimitivesV3(inner, depth + 1)
  }
  if (isZodSchemaType(schema, 'ZodEffects')) {
    // ZodEffects wraps refinements/transforms. Use the inner schema
    // type — writes are pre-transform values.
    const inner = def?.schema
    return inner === undefined ? new Set(PERMISSIVE_V3) : slimPrimitivesV3(inner, depth + 1)
  }
  if (isZodSchemaType(schema, 'ZodPipeline')) {
    // Pipeline: input side ('in').
    const inner = def?.in
    return inner === undefined ? new Set(PERMISSIVE_V3) : slimPrimitivesV3(inner, depth + 1)
  }
  if (typeName === 'ZodLazy') {
    const getter = def?.getter
    if (typeof getter !== 'function') return new Set(PERMISSIVE_V3)
    return slimPrimitivesV3(getter(), depth + 1)
  }
  if (isZodSchemaType(schema, 'ZodUnion') || isZodSchemaType(schema, 'ZodDiscriminatedUnion')) {
    const options = def?.options ?? []
    const out = new Set<SlimPrimitiveKind>()
    for (const opt of options) {
      for (const k of slimPrimitivesV3(opt, depth + 1)) out.add(k)
    }
    return out.size === 0 ? new Set(PERMISSIVE_V3) : out
  }
  if (typeName === 'ZodIntersection') {
    const left = def?.left
    const right = def?.right
    const leftSet = left === undefined ? new Set(PERMISSIVE_V3) : slimPrimitivesV3(left, depth + 1)
    const rightSet =
      right === undefined ? new Set(PERMISSIVE_V3) : slimPrimitivesV3(right, depth + 1)
    const out = new Set<SlimPrimitiveKind>()
    for (const k of leftSet) if (rightSet.has(k)) out.add(k)
    return out
  }
  if (typeName === 'ZodNever') return new Set()
  if (typeName === 'ZodAny' || typeName === 'ZodUnknown') return new Set(PERMISSIVE_V3)

  return new Set(PERMISSIVE_V3)
}

function slimKindOfRawV3(value: unknown): SlimPrimitiveKind {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  const t = typeof value
  switch (t) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'bigint':
      return 'bigint'
    case 'symbol':
      return 'symbol'
    case 'function':
      return 'function'
    case 'undefined':
      return 'undefined'
    case 'object':
      return 'object'
    default:
      return 'object'
  }
}

function coercePathSegments(path: readonly (string | number | symbol)[]): (string | number)[] {
  const out: (string | number)[] = []
  for (const seg of path) {
    out.push(typeof seg === 'number' ? seg : typeof seg === 'string' ? seg : String(seg))
  }
  return out
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

/**
 * Peel `.optional()` / `.nullable()` wrappers off a leaf schema ONLY
 * when the inner type is structurally fillable (object, array, tuple,
 * record, discriminated/plain union — or itself a peelable wrapper
 * that resolves to one of those). For primitive inner (ZodString,
 * ZodNumber, etc.), the wrapper IS the meaningful schema:
 * `.optional()` means "absent is allowed" → undefined; peeling to
 * the inner string default `''` would let mergeStructural overwrite
 * the optional's honest "absent" with a non-empty marker when filling
 * sibling keys at the parent object. See v4's matching helper for
 * the long-form rationale.
 */
function unwrapStructuralLeafV3(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema
  for (let i = 0; i < MAX_UNWRAP_STEPS; i++) {
    if (!(isZodSchemaType(current, 'ZodOptional') || isZodSchemaType(current, 'ZodNullable'))) {
      break
    }
    const inner = current._def.innerType as z.ZodTypeAny | undefined
    if (!inner) return current
    if (!isStructuralV3Kind(inner)) break
    current = inner
  }
  return current
}

/**
 * v3 mirror of v4's `isStructuralKind` — kinds for which the inner is
 * recursable by mergeStructural. Anything else is a primitive leaf
 * where the wrapper carries the meaningful default semantic.
 */
function isStructuralV3Kind(schema: z.ZodTypeAny): boolean {
  return (
    isZodSchemaType(schema, 'ZodObject') ||
    isZodSchemaType(schema, 'ZodArray') ||
    isZodSchemaType(schema, 'ZodRecord') ||
    isZodSchemaType(schema, 'ZodTuple') ||
    isZodSchemaType(schema, 'ZodUnion') ||
    isZodSchemaType(schema, 'ZodDiscriminatedUnion') ||
    // Wrappers that themselves resolve to a structural type — keep
    // peeling at the next iteration.
    isZodSchemaType(schema, 'ZodOptional') ||
    isZodSchemaType(schema, 'ZodNullable') ||
    isZodSchemaType(schema, 'ZodDefault') ||
    isZodSchemaType(schema, 'ZodEffects') ||
    // Newer transparent wrappers (v3.23+). Each wraps a single inner
    // schema with no structural impact — `peelV3Wrappers` resolves them.
    isZodSchemaType(schema, 'ZodPipeline') ||
    isZodSchemaType(schema, 'ZodReadonly') ||
    isZodSchemaType(schema, 'ZodBranded')
  )
}

/**
 * Peel transparent wrappers off a v3 schema to reach the structural
 * "core" — used by the schema-aware path walker that powers
 * `getDefaultAtPath`. Mirrors v4's `unwrapInner` chain so `getDefaultAtPath`
 * resolves the same sub-schemas across both adapters for shapes like
 * `{ profile: z.object({...}).optional() }`.
 *
 * Bounded by `MAX_UNWRAP_STEPS` as a cycle/runaway guard. Returns the
 * original schema unchanged if it has no peelable wrapper.
 *
 * Peeled wrappers:
 *   - `ZodOptional` / `ZodNullable` / `ZodDefault` — `_def.innerType`
 *   - `ZodEffects` — `_def.schema` (the structural source)
 *   - `ZodPipeline` — `_def.in` (input shape; consumers see structural form)
 *   - `ZodReadonly` — `_def.innerType`
 *   - `ZodBranded` — `_def.type`
 *
 * `ZodCatch` is intentionally NOT peeled here — its presence carries
 * load-bearing semantic (the caught fallback), and `unwrapDefault`
 * reads it directly. See A3 fix.
 */
function peelV3Wrappers(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema
  for (let i = 0; i < MAX_UNWRAP_STEPS; i++) {
    if (
      isZodSchemaType(current, 'ZodOptional') ||
      isZodSchemaType(current, 'ZodNullable') ||
      isZodSchemaType(current, 'ZodDefault')
    ) {
      const inner = (current._def as { innerType?: z.ZodTypeAny }).innerType
      if (!inner) return current
      current = inner
      continue
    }
    if (isZodSchemaType(current, 'ZodEffects')) {
      // v3 ZodEffects: source schema is at `_def.schema`; v4 parity'd
      // helpers also expose `.innerType()` on some shapes. Prefer the
      // structural source.
      const inner = (current._def as { schema?: z.ZodTypeAny }).schema
      if (!inner) return current
      current = inner
      continue
    }
    if (isZodSchemaType(current, 'ZodPipeline')) {
      // ZodPipeline transforms `in -> out`; for default extraction and
      // structural traversal, the input schema is the right anchor —
      // it's what the consumer wrote, and the output is a derived
      // shape they don't construct values for directly.
      const inner = (current._def as { in?: z.ZodTypeAny }).in
      if (!inner) return current
      current = inner
      continue
    }
    if (isZodSchemaType(current, 'ZodReadonly')) {
      const inner = (current._def as { innerType?: z.ZodTypeAny }).innerType
      if (!inner) return current
      current = inner
      continue
    }
    if (isZodSchemaType(current, 'ZodBranded')) {
      // ZodBranded annotates a brand at the type level; runtime is the
      // wrapped schema unchanged.
      const inner = (current._def as { type?: z.ZodTypeAny }).type
      if (!inner) return current
      current = inner
      continue
    }
    break
  }
  return current
}

/**
 * Walk a structured path through a v3 schema, peeling wrappers at each
 * step before descending. Returns the schema at the final segment, or
 * `undefined` if the path doesn't exist in the schema (object key
 * missing, tuple index out of range, leaf with segments remaining).
 *
 * Discriminated and plain unions: takes the first matching option (or
 * first option when no match). Matches `validateAtPath`'s first-success
 * semantic at the path-walker layer.
 */
function walkV3ToLeafSchema(
  schema: z.ZodTypeAny,
  segments: readonly (string | number)[]
): z.ZodTypeAny | undefined {
  let current: z.ZodTypeAny | undefined = schema
  let i = 0
  // Iteration cap prevents pathological unions / lazy loops from hanging.
  let safetyTicks = 0
  while (
    i < segments.length &&
    current &&
    safetyTicks < segments.length * MAX_UNWRAP_STEPS + MAX_UNWRAP_STEPS
  ) {
    safetyTicks++
    current = peelV3Wrappers(current)
    const key = String(segments[i] ?? '')

    if (isZodSchemaType(current, 'ZodObject')) {
      const shape = current._def.shape() as z.ZodRawShape
      current = shape[key]
      i++
      continue
    }
    if (isZodSchemaType(current, 'ZodArray')) {
      current = current._def.type as z.ZodTypeAny
      i++
      continue
    }
    if (isZodSchemaType(current, 'ZodRecord')) {
      current = current._def.valueType as z.ZodTypeAny
      i++
      continue
    }
    if (isZodSchemaType(current, 'ZodTuple')) {
      const idx = Number(key)
      if (!Number.isInteger(idx) || idx < 0) return undefined
      const items = current._def.items as readonly z.ZodTypeAny[]
      const item = items[idx]
      if (!item) return undefined
      current = item
      i++
      continue
    }
    if (isZodSchemaType(current, 'ZodDiscriminatedUnion')) {
      const options = current._def.options as readonly z.AnyZodObject[]
      const matching = options.filter((o) => key in o.shape)
      const candidates = matching.length > 0 ? matching : options
      const first = candidates[0]
      if (!first) return undefined
      current = first
      // Don't advance i — re-process this segment within the option.
      continue
    }
    if (isZodSchemaType(current, 'ZodUnion')) {
      const options = current._def.options as readonly z.ZodTypeAny[]
      const first = options[0]
      if (!first) return undefined
      current = first
      // Don't advance i — re-process this segment within the option.
      continue
    }
    // Leaf type with segments remaining — can't descend.
    return undefined
  }
  return current
}

function unwrapToDiscriminatedUnion(
  schema: z.ZodTypeAny
): z.ZodDiscriminatedUnion<string, readonly z.ZodDiscriminatedUnionOption<string>[]> | undefined {
  let currentSchema: z.ZodTypeAny = schema

  // Bounded by MAX_UNWRAP_STEPS so a pathological lazy self-reference
  // can't hang the lookup. `innerType` on ZodDefault/Optional/Nullable
  // is a ZodType (non-nullable); the cap is a soundness guard.
  for (let i = 0; i < MAX_UNWRAP_STEPS; i++) {
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
      currentSchema = (currentSchema._def as { innerType: z.ZodTypeAny }).innerType
      continue
    }
    // Newer transparent wrappers — peel through to expose any
    // discriminated union that lives at the structural core.
    if (isZodSchemaType(currentSchema, 'ZodReadonly')) {
      const inner = (currentSchema._def as { innerType?: z.ZodTypeAny }).innerType
      if (!inner) return undefined
      currentSchema = inner
      continue
    }
    if (isZodSchemaType(currentSchema, 'ZodBranded')) {
      const inner = (currentSchema._def as { type?: z.ZodTypeAny }).type
      if (!inner) return undefined
      currentSchema = inner
      continue
    }
    if (isZodSchemaType(currentSchema, 'ZodPipeline')) {
      const inner = (currentSchema._def as { in?: z.ZodTypeAny }).in
      if (!inner) return undefined
      currentSchema = inner
      continue
    }

    // Any other type: give up.
    return undefined
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

    return getDefaultValuesFromZodSchema(
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
  // Iterative peel: a chain of `.refine()` calls produces a deep
  // ZodEffects(ZodEffects(...)) tree, and stack-based recursion runs
  // out before MAX_UNWRAP_STEPS does. The bound also acts as a
  // self-reference guard for pathological lazy loops.
  let current: z.ZodTypeAny = schema
  for (let i = 0; i < MAX_UNWRAP_STEPS; i++) {
    if (isZodSchemaType(current, 'ZodDefault')) {
      const defaultValue = (current._def as { defaultValue: () => unknown }).defaultValue()
      return [defaultValue, true]
    }
    if (isZodSchemaType(current, 'ZodCatch')) {
      // ZodCatch supplies a fallback value when its inner schema rejects
      // parse. For default extraction the caught fallback IS the
      // construction-time default — it's the consumer's explicit
      // statement of "this is what to render when nothing else fits."
      // Preserves the value across submit failures, hydration, and
      // history (a `.catch()` should resurface the same fallback).
      const catchValue = (current._def as { catchValue?: (ctx: unknown) => unknown }).catchValue
      if (typeof catchValue === 'function') {
        return [catchValue({ error: null, input: undefined }), true]
      }
      // Defensive: fall through to the inner schema if the field is
      // missing on this v3 minor version.
      const inner = (current._def as { innerType?: z.ZodTypeAny }).innerType
      if (!inner) break
      current = inner
      continue
    }
    if (isZodSchemaType(current, 'ZodNullable') || isZodSchemaType(current, 'ZodOptional')) {
      current = (current._def as { innerType: z.ZodTypeAny }).innerType
      continue
    }
    if (isZodSchemaType(current, 'ZodReadonly')) {
      const inner = (current._def as { innerType?: z.ZodTypeAny }).innerType
      if (!inner) break
      current = inner
      continue
    }
    if (isZodSchemaType(current, 'ZodBranded')) {
      const inner = (current._def as { type?: z.ZodTypeAny }).type
      if (!inner) break
      current = inner
      continue
    }
    if (isZodSchemaType(current, 'ZodPipeline')) {
      const inner = (current._def as { in?: z.ZodTypeAny }).in
      if (!inner) break
      current = inner
      continue
    }
    if (isZodSchemaType(current, 'ZodEffects')) {
      // ZodEffects's structural source lives at `_def.effect` when the
      // effect itself was constructed from a ZodType (older v3 shape),
      // otherwise at `.innerType()` (newer v3). Probe both — whichever
      // resolves to a ZodTypeAny is the schema we keep unwrapping.
      const effect = (current._def as { effect?: unknown }).effect
      if (effect !== null && typeof effect === 'object' && '_def' in effect) {
        current = effect as z.ZodTypeAny
        continue
      }
      const inner = (current as { innerType?: () => z.ZodTypeAny }).innerType?.()
      if (inner) {
        current = inner
        continue
      }
      break
    }
    break
  }
  return [null, false]
}

function getDefaultValuesFromZodSchema<
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

    // ZodCatch — even when default extraction is suppressed
    // (`useDefaultSchemaValues=false`), the consumer-supplied fallback
    // is the most reasonable construction-time value to surface; the
    // alternative is the inner schema's bare default, which the
    // .catch() author specifically chose to override.
    if (isZodSchemaType(schema, 'ZodCatch')) {
      const catchValue = (schema._def as { catchValue?: (ctx: unknown) => unknown }).catchValue
      if (typeof catchValue === 'function') {
        return catchValue({ error: null, input: undefined })
      }
      const inner = (schema._def as { innerType?: z.ZodTypeAny }).innerType
      if (inner) return generateValue(inner)
    }

    // Newer transparent wrappers (v3.23+ for Pipeline/Readonly; Branded
    // pre-existed). Each wraps a single inner schema with no structural
    // impact at value-construction time.
    if (isZodSchemaType(schema, 'ZodReadonly')) {
      const inner = (schema._def as { innerType?: z.ZodTypeAny }).innerType
      if (inner) return generateValue(inner)
    }
    if (isZodSchemaType(schema, 'ZodBranded')) {
      const inner = (schema._def as { type?: z.ZodTypeAny }).type
      if (inner) return generateValue(inner)
    }
    if (isZodSchemaType(schema, 'ZodPipeline')) {
      // Pipeline transforms in -> out; pre-transform default is the
      // input schema's natural default.
      const inner = (schema._def as { in?: z.ZodTypeAny }).in
      if (inner) return generateValue(inner)
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
  // `depth` bounds the recursion at MAX_UNWRAP_STEPS (per branch). For
  // realistic form schemas the structural depth is in single digits;
  // the bound only matters for pathological chains
  // (`z.string().refine().refine()...` produces nested ZodEffects whose
  // depth is exactly the chain length).
  function _stripRefinements(_schema: z.ZodTypeAny, depth: number): z.ZodTypeAny {
    if (depth >= MAX_UNWRAP_STEPS) return _schema as T
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
      return z.array(_stripRefinements(_schema._def.type, depth + 1))
    }

    if (isZodSchemaType(_schema, 'ZodObject')) {
      // Recursively process each property of the object
      const shape = _schema.shape
      const strippedShape = Object.fromEntries(
        Object.entries(shape).map(([key, value]) => [
          key,
          _stripRefinements(value as z.ZodTypeAny, depth + 1),
        ])
      )
      return z.object(strippedShape)
    }

    if (isZodSchemaType(_schema, 'ZodEffects')) {
      // Unwrap the inner schema and strip refinements
      return _stripRefinements(_schema.innerType(), depth + 1)
    }

    if (isZodSchemaType(_schema, 'ZodOptional')) {
      // Recursively strip optional's inner type
      return z.optional(_stripRefinements(_schema.unwrap(), depth + 1))
    }

    if (isZodSchemaType(_schema, 'ZodNullable')) {
      // Recursively strip nullable's inner type
      return z.nullable(_stripRefinements(_schema.unwrap(), depth + 1))
    }

    // Newer transparent wrappers — descend into their inner schema and
    // return that. We don't reconstruct the wrapper because its
    // refinement/branding/pipeline metadata isn't load-bearing for the
    // slim-parse pass that consumes the stripped schema.
    if (isZodSchemaType(_schema, 'ZodReadonly')) {
      const inner = (_schema._def as { innerType?: z.ZodTypeAny }).innerType
      if (!inner) return _schema
      return _stripRefinements(inner, depth + 1)
    }

    if (isZodSchemaType(_schema, 'ZodBranded')) {
      const inner = (_schema._def as { type?: z.ZodTypeAny }).type
      if (!inner) return _schema
      return _stripRefinements(inner, depth + 1)
    }

    if (isZodSchemaType(_schema, 'ZodPipeline')) {
      const inner = (_schema._def as { in?: z.ZodTypeAny }).in
      if (!inner) return _schema
      return _stripRefinements(inner, depth + 1)
    }

    // Return other schema types as-is
    return _schema as T
  }

  return _stripRefinements(schema, 0) as T
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
