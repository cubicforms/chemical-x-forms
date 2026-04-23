import type { z } from 'zod'
import type { AbstractSchema, FormKey, ValidationError } from '../../types/types-api'
import type { DeepPartial, GenericForm } from '../../types/types-core'
import {
  assertZodVersion,
  getArrayElement,
  getDefaultValue,
  getEnumValues,
  getLiteralValues,
  getObjectShape,
  getRecordValueType,
  getTupleItems,
  getUnionOptions,
  kindOf,
  unwrapInner,
  unwrapPipe,
  type ZodKind,
} from './introspect'

/**
 * Zod v4 adapter — implements the AbstractSchema contract using Zod v4's
 * public APIs where possible, with internal-shape access quarantined to
 * introspect.ts.
 *
 * Scope of this first cut:
 * - getInitialState: walks the schema tree, emits defaults per leaf. Honors
 *   `.default(v)` wrappers; optional → undefined; nullable → null; enum →
 *   first entry; literal → the value; array/record → empty.
 * - getSchemasAtPath: recursive descent by dotted path (core still speaks
 *   dotted strings at the AbstractSchema boundary — structured paths land
 *   in a later phase).
 * - validateAtPath: calls safeParse at the root or the resolved subschema.
 *
 * Not yet supported (TODOs):
 * - Discriminated unions with first-option fallback for initial state.
 * - Pipe (refine/transform) — treated as a pass-through; initial state
 *   walks the inner schema.
 * - Intersection (z.intersection).
 */

const PATH_SEPARATOR = '.'

export function zodV4Adapter<FormSchema extends z.ZodObject, Form extends z.infer<FormSchema>>(
  rootSchema: FormSchema
): (formKey: FormKey) => AbstractSchema<Form, Form> {
  assertZodVersion(rootSchema)

  return (formKey: FormKey): AbstractSchema<Form, Form> => {
    return {
      getInitialState(config): ReturnType<AbstractSchema<Form, Form>['getInitialState']> {
        const rootValue = deriveDefault(rootSchema, config.useDefaultSchemaValues) as Form
        const merged = mergeDeep(rootValue, config.constraints) as Form
        // Validate via safeParse (strict mode only). Lax mode skips validation
        // and returns whatever the walker produced.
        if (config.validationMode === 'strict') {
          const result = rootSchema.safeParse(merged) as z.ZodSafeParseResult<Form>
          if (result.success) {
            return { data: result.data, errors: undefined, success: true, formKey }
          }
          return {
            data: merged,
            errors: zodIssuesToValidationErrors(result.error.issues, formKey),
            success: false,
            formKey,
          }
        }
        return { data: merged, errors: undefined, success: true, formKey }
      },
      getSchemasAtPath(path) {
        const resolved = walkPath(rootSchema, path.split(PATH_SEPARATOR))
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
        const resolved = walkPath(rootSchema, path.split(PATH_SEPARATOR))
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

/**
 * Walk a path segment list through a schema, returning the subschema(s) at
 * that path. Unions return multiple candidates.
 */
function walkPath(schema: z.ZodType, segments: readonly string[]): z.ZodType[] {
  if (segments.length === 0) return [schema]
  const [head, ...rest] = segments
  if (head === undefined) return [schema]
  const kind = kindOf(schema)
  switch (kind) {
    case 'object': {
      const shape = getObjectShape(schema as z.ZodObject)
      const next = shape[head]
      return next === undefined ? [] : walkPath(next, rest)
    }
    case 'array':
      return walkPath(getArrayElement(schema as z.ZodArray), rest)
    case 'record':
      return walkPath(getRecordValueType(schema), rest)
    case 'tuple': {
      const index = Number(head)
      if (!Number.isInteger(index)) return []
      const items = getTupleItems(schema)
      const item = items[index]
      return item === undefined ? [] : walkPath(item, rest)
    }
    case 'union':
      return getUnionOptions(schema).flatMap((opt) => walkPath(opt, segments))
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly': {
      const inner = unwrapInner(schema)
      return inner === undefined ? [] : walkPath(inner, segments)
    }
    case 'pipe': {
      const inner = unwrapPipe(schema)
      return inner === undefined ? [] : walkPath(inner, segments)
    }
    // Leaf types — can't descend further. Also `discriminated-union` is
    // handled the same way (returns empty for now; TODO for proper
    // discriminator-aware traversal).
    case 'string':
    case 'number':
    case 'bigint':
    case 'boolean':
    case 'undefined':
    case 'null':
    case 'void':
    case 'never':
    case 'any':
    case 'unknown':
    case 'date':
    case 'enum':
    case 'literal':
    case 'nan':
    case 'discriminated-union':
      return []
  }
}

/**
 * Derive a default value for a schema. Used for form initial state. When
 * `useDefault` is false, wrappers like `.default(x)` are skipped so the
 * walker produces the underlying leaf's empty value instead.
 */
function deriveDefault(schema: z.ZodType, useDefault: boolean): unknown {
  const kind = kindOf(schema)
  return defaultForKind(kind, schema, useDefault)
}

function defaultForKind(kind: ZodKind, schema: z.ZodType, useDefault: boolean): unknown {
  switch (kind) {
    case 'object': {
      const shape = getObjectShape(schema as z.ZodObject)
      const out: Record<string, unknown> = {}
      for (const [key, subSchema] of Object.entries(shape)) {
        out[key] = deriveDefault(subSchema, useDefault)
      }
      return out
    }
    case 'default': {
      if (useDefault) return getDefaultValue(schema)
      const inner = unwrapInner(schema)
      return inner === undefined ? undefined : deriveDefault(inner, useDefault)
    }
    case 'optional':
      return undefined
    case 'nullable':
      return null
    case 'readonly': {
      const inner = unwrapInner(schema)
      return inner === undefined ? undefined : deriveDefault(inner, useDefault)
    }
    case 'pipe': {
      const inner = unwrapPipe(schema)
      return inner === undefined ? undefined : deriveDefault(inner, useDefault)
    }
    case 'array':
      return []
    case 'record':
      return {}
    case 'tuple': {
      const items = getTupleItems(schema)
      return items.map((item) => deriveDefault(item, useDefault))
    }
    case 'union': {
      const options = getUnionOptions(schema)
      const first = options[0]
      return first === undefined ? undefined : deriveDefault(first, useDefault)
    }
    case 'discriminated-union': {
      // TODO: proper discriminator handling. For now, first option.
      const options = getUnionOptions(schema)
      const first = options[0]
      return first === undefined ? undefined : deriveDefault(first, useDefault)
    }
    case 'string':
      return ''
    case 'number':
    case 'bigint':
      return 0
    case 'boolean':
      return false
    case 'date':
      return new Date(0)
    case 'null':
      return null
    case 'undefined':
      return undefined
    case 'enum': {
      const values = getEnumValues(schema)
      return values[0]
    }
    case 'literal': {
      const values = getLiteralValues(schema)
      return values[0]
    }
    case 'nan':
      return NaN
    case 'any':
    case 'unknown':
    case 'void':
    case 'never':
      return undefined
    default:
      return undefined
  }
}

function mergeDeep(base: unknown, override: unknown): unknown {
  if (override === undefined || override === null) return base
  if (typeof base !== 'object' || base === null) return override
  if (Array.isArray(base) || Array.isArray(override)) {
    return Array.isArray(override) ? override : base
  }
  const result = { ...(base as Record<string, unknown>) }
  for (const key of Object.keys(override as Record<string, unknown>)) {
    const oVal = (override as Record<string, unknown>)[key]
    const bVal = (base as Record<string, unknown>)[key]
    if (
      typeof oVal === 'object' &&
      oVal !== null &&
      !Array.isArray(oVal) &&
      typeof bVal === 'object' &&
      bVal !== null &&
      !Array.isArray(bVal)
    ) {
      result[key] = mergeDeep(bVal, oVal)
    } else if (oVal !== undefined) {
      result[key] = oVal
    }
  }
  return result
}

function zodIssuesToValidationErrors(
  issues: readonly z.core.$ZodIssue[],
  formKey: FormKey
): ValidationError[] {
  return issues.map((issue) => ({
    message: issue.message,
    // v4 types path as PropertyKey[]; cast to (string|number)[] at boundary.
    path: issue.path.map((seg) => (typeof seg === 'number' ? seg : String(seg))),
    formKey,
  }))
}

// Type-only re-export so downstream code can reference the Form shape.
export type { DeepPartial, GenericForm }
