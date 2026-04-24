import { z } from 'zod'
import {
  getArrayElement,
  getCatchDefault,
  getChecks,
  getDefaultValue,
  getDiscriminatedOptions,
  getDiscriminator,
  getIntersectionLeft,
  getIntersectionRight,
  getObjectShape,
  getRecordKeyType,
  getRecordValueType,
  getTupleItems,
  getUnionOptions,
  hasChecks,
  kindOf,
  unwrapInner,
  unwrapLazy,
  unwrapPipe,
} from './introspect'

type StripConfigInternal = Pick<StripConfig, 'stripRefinements'>

/**
 * Re-apply the container-level checks from `original` to `rebuilt`.
 * Container constructors (`z.object`, `z.array`, `z.tuple`, `z.record`,
 * `z.union`) don't accept checks in their factory signature, so
 * rebuilding a container drops `.min(1)` / `.max(3)` / `.strict()` /
 * etc. silently. Without this, a schema like
 * `z.array(z.string()).min(1)` in strict mode (where
 * `stripRefinements !== true`) would accept `[]` — the bug CR
 * reported.
 *
 * `.check(...)` accepts raw check instances, which is exactly what
 * the internal `def.checks` array holds. Skipping when
 * `stripRefinements === true` matches the leaf branches at the bottom
 * of `getSlimSchema`.
 */
function carryChecks<Rebuilt extends z.ZodType>(
  rebuilt: Rebuilt,
  original: z.ZodType,
  stripConfig: StripConfigInternal
): Rebuilt {
  if (stripConfig.stripRefinements === true) return rebuilt
  if (!hasChecks(original)) return rebuilt
  const checks = getChecks(original)
  // `.check` on a concrete ZodType accepts instances of `$ZodCheck`
  // in Zod v4; the introspection helper returns exactly that shape,
  // so the cast is the boundary between adapter-internal typing and
  // Zod's public API.
  return (rebuilt as z.ZodType<unknown>).check(
    ...(checks as Parameters<z.ZodType<unknown>['check']>)
  ) as Rebuilt
}

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
    case 'lazy': {
      const inner = unwrapLazy(schema)
      if (inner === undefined) return schema
      const slimmedInner = stripRefinements(inner)
      return z.lazy(() => slimmedInner)
    }
    case 'intersection': {
      const left = getIntersectionLeft(schema)
      const right = getIntersectionRight(schema)
      if (left === undefined || right === undefined) return schema
      return z.intersection(stripRefinements(left), stripRefinements(right))
    }
    case 'catch': {
      const inner = unwrapInner(schema)
      if (inner === undefined) return schema
      const slimmedInner = stripRefinements(inner)
      return (slimmedInner as z.ZodType).catch(getCatchDefault(schema) as never)
    }
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
    case 'promise':
    case 'custom':
    case 'template-literal':
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
      if (stripConfig.stripDefaultValues === true) return slimmedInner
      // Re-apply the default to the slimmed inner. Returning `schema`
      // unchanged would skip nested stripping (refinements / pipe inside
      // a `.default()` wrapper would survive, breaking parity with the
      // optional / nullable cases above). The default value lives on
      // the wrapper at `_zod.def.defaultValue`; introspect.getDefaultValue
      // reads it through the v4 getter and resolves to the materialised
      // value (lazy `.default(() => x)` getters fire here — we rewrap
      // as a fixed value, which is correct for the slim schema's
      // single-shot use during initial-state derivation).
      const defaultValue = getDefaultValue(schema)
      return (slimmedInner as z.ZodType).default(defaultValue as never)
    }
    case 'readonly': {
      // `.readonly()` wraps the output in `Object.freeze` — dropping the
      // wrapper after slimming would hand callers a mutable default,
      // which breaks invariants inside refinements that rely on the
      // frozen shape. Re-wrap the slimmed inner so the observable parse
      // behaviour matches the unstripped schema.
      const inner = unwrapInner(schema)
      return inner === undefined
        ? schema
        : (getSlimSchema(inner, stripConfig) as z.ZodType).readonly()
    }
    case 'pipe': {
      // `.pipe(...)` chains schemas sequentially — the output of one
      // feeds the input of the next — and typically carries a
      // `.transform(...)` that mutates the runtime shape. Slimming the
      // inner and dropping the pipe wrapper would lose that
      // transformation, so by default we return the original schema
      // unchanged. Consumers who explicitly opt in via `stripPipe`
      // (e.g. initial-state derivation, where a transform doesn't make
      // sense) get the upstream leg of the pipe only.
      if (stripConfig.stripPipe === true) {
        const inner = unwrapPipe(schema) ?? schema
        return getSlimSchema(inner, stripConfig)
      }
      return schema
    }
    case 'object': {
      const shape = getObjectShape(schema as z.ZodObject)
      const next: Record<string, z.ZodType> = {}
      for (const [k, v] of Object.entries(shape)) {
        next[k] = getSlimSchema(v, stripConfig)
      }
      return carryChecks(z.object(next), schema, stripConfig)
    }
    case 'array': {
      const element = getArrayElement(schema as z.ZodArray)
      return carryChecks(z.array(getSlimSchema(element, stripConfig)), schema, stripConfig)
    }
    case 'tuple': {
      const items = getTupleItems(schema).map((it) => getSlimSchema(it, stripConfig))
      const rebuilt = z.tuple(
        items as unknown as [z.ZodType, ...z.ZodType[]]
      ) as unknown as z.ZodType
      return carryChecks(rebuilt, schema, stripConfig)
    }
    case 'record': {
      const keyType = getRecordKeyType(schema)
      const valueType = getSlimSchema(getRecordValueType(schema), stripConfig)
      const rebuilt = z.record(keyType as z.ZodType<string | number | symbol>, valueType)
      return carryChecks(rebuilt, schema, stripConfig)
    }
    case 'union': {
      const options = getUnionOptions(schema).map((opt) => getSlimSchema(opt, stripConfig))
      const rebuilt = z.union(options as unknown as readonly [z.ZodType, z.ZodType, ...z.ZodType[]])
      return carryChecks(rebuilt, schema, stripConfig)
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
    case 'promise':
    case 'custom':
    case 'template-literal':
      return schema
    case 'lazy': {
      const inner = unwrapLazy(schema)
      if (inner === undefined) return schema
      const slimmedInner = getSlimSchema(inner, stripConfig)
      return z.lazy(() => slimmedInner)
    }
    case 'intersection': {
      const left = getIntersectionLeft(schema)
      const right = getIntersectionRight(schema)
      if (left === undefined || right === undefined) return schema
      return z.intersection(getSlimSchema(left, stripConfig), getSlimSchema(right, stripConfig))
    }
    case 'catch': {
      const inner = unwrapInner(schema)
      if (inner === undefined) return schema
      const slimmedInner = getSlimSchema(inner, stripConfig)
      // Preserve the catch wrapper so downstream safeParse still uses
      // the declared fallback — stripping it would discard user intent.
      return (slimmedInner as z.ZodType).catch(getCatchDefault(schema) as never)
    }
  }
}
