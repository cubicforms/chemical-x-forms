import { z } from 'zod'
import {
  getArrayElement,
  getDiscriminatedOptions,
  getDiscriminator,
  getObjectShape,
  getRecordKeyType,
  getRecordValueType,
  getTupleItems,
  getUnionOptions,
  hasChecks,
  kindOf,
  unwrapInner,
  unwrapPipe,
} from './introspect'

/**
 * stripRefinements: rebuild the schema tree with all refinement checks
 * (`z.string().min(3)`, `z.number().multipleOf(2)`, etc.) removed. The
 * validate-then-fix loop uses this so a default like `''` can satisfy a
 * `z.string().email()` during initial-state construction in lax mode.
 *
 * The semantics match v3's `stripRefinements`: descend through container
 * types and rebuild leaves without their checks.
 */
export function stripRefinements(schema: z.ZodType): z.ZodType {
  const kind = kindOf(schema)
  switch (kind) {
    case 'string':
      return hasChecks(schema) ? z.string() : schema
    case 'number':
      return hasChecks(schema) ? z.number() : schema
    case 'bigint':
      return hasChecks(schema) ? z.bigint() : schema
    case 'array': {
      const element = getArrayElement(schema as z.ZodArray)
      return z.array(stripRefinements(element))
    }
    case 'tuple': {
      const items = getTupleItems(schema).map(stripRefinements)
      // z.tuple requires [T, ...T[]] but the runtime accepts an array.
      return z.tuple(items as unknown as [z.ZodType, ...z.ZodType[]]) as unknown as z.ZodType
    }
    case 'object': {
      const shape = getObjectShape(schema as z.ZodObject)
      const next: Record<string, z.ZodType> = {}
      for (const [k, v] of Object.entries(shape)) {
        next[k] = stripRefinements(v)
      }
      return z.object(next)
    }
    case 'record': {
      const keyType = getRecordKeyType(
        schema
      ) as unknown as z.core.$ZodRecord['_zod']['def']['keyType']
      const valueType = stripRefinements(getRecordValueType(schema))
      return z.record(keyType as z.ZodType<string | number | symbol>, valueType)
    }
    case 'union': {
      const options = getUnionOptions(schema).map(stripRefinements)
      return z.union(options as unknown as readonly [z.ZodType, z.ZodType, ...z.ZodType[]])
    }
    case 'discriminated-union': {
      const options = getDiscriminatedOptions(schema).map(
        (opt) => stripRefinements(opt) as z.ZodObject
      )
      const discriminator = getDiscriminator(schema)
      if (discriminator === undefined) return schema
      return z.discriminatedUnion(
        discriminator,
        options as unknown as readonly [z.ZodObject, ...z.ZodObject[]]
      )
    }
    // Wrappers: strip the inner, preserve the wrapper semantics where
    // possible. For stripping refinements we typically want wrappers to
    // survive (optional/nullable/default), so leave them alone.
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
    case 'pipe':
      // These wrappers are handled by getSlimSchema below per stripConfig.
      return schema
    // Leaf types without refinements, or Zod features we don't rewrite.
    case 'boolean':
    case 'date':
    case 'enum':
    case 'literal':
    case 'null':
    case 'undefined':
    case 'any':
    case 'unknown':
    case 'nan':
    case 'void':
    case 'never':
      return schema
  }
}

export type StripConfig = {
  /** Strip `.default(v)` wrappers so the walker produces the leaf's empty value. */
  stripDefaultValues?: boolean
  /** Strip `.optional()` so `undefined` values are rejected. */
  stripOptional?: boolean
  /** Strip `.nullable()` so `null` values are rejected. */
  stripNullable?: boolean
  /** Strip refinement checks (email, min, etc.). Same semantic as v3's stripZodRefinements. */
  stripRefinements?: boolean
  /** Strip pipe transforms (refine/transform). Same semantic as v3's stripZodEffects. */
  stripPipe?: boolean
}

/**
 * getSlimSchema: walk the schema tree and apply `stripConfig` transparently.
 * Wrappers get peeled when their corresponding flag is set; refinements get
 * rebuilt when `stripRefinements` is set. Every branch recurses so deeply
 * nested wrappers inside objects/arrays/unions all get the same treatment.
 */
export function getSlimSchema(schema: z.ZodType, stripConfig: StripConfig): z.ZodType {
  const kind = kindOf(schema)
  switch (kind) {
    case 'optional': {
      const inner = unwrapInner(schema) ?? schema
      const slimmedInner = getSlimSchema(inner, stripConfig)
      return stripConfig.stripOptional === true ? slimmedInner : slimmedInner.optional()
    }
    case 'nullable': {
      const inner = unwrapInner(schema) ?? schema
      const slimmedInner = getSlimSchema(inner, stripConfig)
      return stripConfig.stripNullable === true ? slimmedInner : slimmedInner.nullable()
    }
    case 'default': {
      const inner = unwrapInner(schema) ?? schema
      const slimmedInner = getSlimSchema(inner, stripConfig)
      // We can't easily re-apply `.default(...)` here because the default
      // value lives on the wrapper; stripping it when `stripDefaultValues`
      // is set is the more useful direction. When false, keep the original
      // wrapper — the walker will honour it.
      return stripConfig.stripDefaultValues === true ? slimmedInner : schema
    }
    case 'readonly':
    case 'pipe': {
      if (kind === 'pipe' && stripConfig.stripPipe === true) {
        const inner = unwrapPipe(schema) ?? schema
        return getSlimSchema(inner, stripConfig)
      }
      const inner = kind === 'pipe' ? unwrapPipe(schema) : unwrapInner(schema)
      return inner === undefined ? schema : getSlimSchema(inner, stripConfig)
    }
    case 'object': {
      const shape = getObjectShape(schema as z.ZodObject)
      const next: Record<string, z.ZodType> = {}
      for (const [k, v] of Object.entries(shape)) {
        next[k] = getSlimSchema(v, stripConfig)
      }
      return z.object(next)
    }
    case 'array': {
      const element = getArrayElement(schema as z.ZodArray)
      return z.array(getSlimSchema(element, stripConfig))
    }
    case 'tuple': {
      const items = getTupleItems(schema).map((it) => getSlimSchema(it, stripConfig))
      return z.tuple(items as unknown as [z.ZodType, ...z.ZodType[]]) as unknown as z.ZodType
    }
    case 'record': {
      const keyType = getRecordKeyType(schema)
      const valueType = getSlimSchema(getRecordValueType(schema), stripConfig)
      return z.record(keyType as z.ZodType<string | number | symbol>, valueType)
    }
    case 'union': {
      const options = getUnionOptions(schema).map((opt) => getSlimSchema(opt, stripConfig))
      return z.union(options as unknown as readonly [z.ZodType, z.ZodType, ...z.ZodType[]])
    }
    case 'discriminated-union': {
      const options = getDiscriminatedOptions(schema).map(
        (opt) => getSlimSchema(opt, stripConfig) as z.ZodObject
      )
      const discriminator = getDiscriminator(schema)
      if (discriminator === undefined) return schema
      return z.discriminatedUnion(
        discriminator,
        options as unknown as readonly [z.ZodObject, ...z.ZodObject[]]
      )
    }
    // Leaves: strip refinements if requested, otherwise pass through.
    case 'string':
    case 'number':
    case 'bigint':
      return stripConfig.stripRefinements === true && hasChecks(schema)
        ? stripRefinements(schema)
        : schema
    case 'boolean':
    case 'date':
    case 'enum':
    case 'literal':
    case 'null':
    case 'undefined':
    case 'any':
    case 'unknown':
    case 'nan':
    case 'void':
    case 'never':
      return schema
  }
}
