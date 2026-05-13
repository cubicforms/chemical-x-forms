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
  getSetValueType,
  getTupleItems,
  getUnionOptions,
  hasChecks,
  isAsyncCheck,
  kindOf,
  unwrapInner,
  unwrapLazy,
  unwrapPipeIn,
  unwrapPipeOut,
} from './introspect'

type StripConfigInternal = Pick<StripConfig, 'stripRefinements'> & {
  /**
   * Optional per-check predicate. When provided, only checks for which
   * `shouldKeepCheck` returns `true` are re-applied to the rebuilt
   * schema. `stripAsyncChecks` uses this to filter async refines while
   * preserving every sync check verbatim. Absent → keep all checks
   * (existing behaviour for `getSlimSchema` callers).
   */
  shouldKeepCheck?: (check: unknown) => boolean
}

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
  const all = getChecks(original)
  const checks =
    stripConfig.shouldKeepCheck === undefined ? all : all.filter(stripConfig.shouldKeepCheck)
  if (checks.length === 0) return rebuilt
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
 * `z.string().email()` during default-values construction in lax mode.
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
    case 'set': {
      const valueType = getSetValueType(schema)
      return z.set(stripRefinements(valueType))
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
    case 'transform':
      return schema
    default: {
      // Compile-time exhaustiveness pin. If `ZodKind` grows a new
      // variant, this line breaks first — pointing at the offending
      // value — instead of a diffuse "function lacks return statement"
      // elsewhere in the file. Mirrors the pattern in assertSupportedKinds.
      const _exhaustive: never = kind
      throw new Error(`stripRefinements: unhandled ZodKind '${_exhaustive as string}'`)
    }
  }
}

/**
 * Walk the schema tree and rebuild each node with async refinement
 * checks removed. Sync `.refine` / `.superRefine` / built-in checks
 * (`min`, `max`, `email`, etc.) are preserved; wrappers (`.optional()`,
 * `.nullable()`, `.default(v)`, `.readonly()`, `.catch(v)`) are
 * preserved structurally and recursed into.
 *
 * Used by the construction-time `getDefaultValues` fallback in the
 * adapter: when `rootSchema.safeParse(data)` throws because the
 * schema contains an async refine, retrying against
 * `stripAsyncChecks(rootSchema)` surfaces every sync-refinement
 * violation that the original parse would have collected if the
 * async sibling weren't poisoning the sync entry point.
 *
 * Conceptually distinct from `stripRefinements` (drop-all, leaf
 * operation) and `getSlimSchema` (configurable peeling for default
 * derivation): this is a tree-walk that filters by sync/async at
 * every check site.
 */
export function stripAsyncChecks(schema: z.ZodType): z.ZodType {
  const config: StripConfigInternal = {
    stripRefinements: false,
    shouldKeepCheck: (c) => !isAsyncCheck(c),
  }
  // Cycle-detection set scoped to one strip pass. Mirrors the
  // pattern in `containsAsyncRefine` (introspect.ts) — pathological
  // `z.lazy(() => self)` schemas would otherwise infinite-recurse.
  const seen = new WeakSet<object>()

  function recurse(s: z.ZodType): z.ZodType {
    // ZodType instances are always objects — the WeakSet add/check
    // is unconditional once we're inside this function.
    if (seen.has(s)) return s
    seen.add(s)

    const kind = kindOf(s)
    switch (kind) {
      case 'string':
        return hasChecks(s) ? carryChecks(z.string(), s, config) : s
      case 'number':
        return hasChecks(s) ? carryChecks(z.number(), s, config) : s
      case 'bigint':
        return hasChecks(s) ? carryChecks(z.bigint(), s, config) : s

      case 'array': {
        const element = getArrayElement(s as z.ZodArray)
        return carryChecks(z.array(recurse(element)), s, config)
      }
      case 'set': {
        const valueType = getSetValueType(s)
        return carryChecks(z.set(recurse(valueType)), s, config)
      }
      case 'tuple': {
        const items = getTupleItems(s).map(recurse)
        const rebuilt = z.tuple(
          items as unknown as [z.ZodType, ...z.ZodType[]]
        ) as unknown as z.ZodType
        return carryChecks(rebuilt, s, config)
      }
      case 'object': {
        const shape = getObjectShape(s as z.ZodObject)
        const next: Record<string, z.ZodType> = {}
        for (const [k, v] of Object.entries(shape)) {
          next[k] = recurse(v as z.ZodType)
        }
        return carryChecks(z.object(next), s, config)
      }
      case 'record': {
        const keyType = getRecordKeyType(s)
        const valueType = recurse(getRecordValueType(s))
        const rebuilt = z.record(keyType as z.ZodType<string | number | symbol>, valueType)
        return carryChecks(rebuilt, s, config)
      }
      case 'union': {
        const options = getUnionOptions(s).map(recurse)
        const rebuilt = z.union(
          options as unknown as readonly [z.ZodType, z.ZodType, ...z.ZodType[]]
        )
        return carryChecks(rebuilt, s, config)
      }
      case 'discriminated-union': {
        const options = getDiscriminatedOptions(s).map((opt) => recurse(opt) as z.ZodObject)
        const discriminator = getDiscriminator(s)
        if (discriminator === undefined) return s
        return z.discriminatedUnion(
          discriminator,
          options as unknown as readonly [z.ZodObject, ...z.ZodObject[]]
        )
      }

      case 'optional': {
        const inner = unwrapInner(s)
        if (inner === undefined) return s
        return (recurse(inner) as z.ZodType).optional()
      }
      case 'nullable': {
        const inner = unwrapInner(s)
        if (inner === undefined) return s
        return (recurse(inner) as z.ZodType).nullable()
      }
      case 'default': {
        const inner = unwrapInner(s)
        if (inner === undefined) return s
        return (recurse(inner) as z.ZodType).default(getDefaultValue(s) as never)
      }
      case 'readonly': {
        const inner = unwrapInner(s)
        if (inner === undefined) return s
        return (recurse(inner) as z.ZodType).readonly()
      }

      case 'pipe':
        // Pipes carry transforms whose output shape would change if
        // we rebuilt them blindly; recursing through both halves of a
        // pipe also requires both halves to be addressable, which
        // `unwrapPipe` doesn't expose. If an async refine lives
        // inside a pipe, its throw surfaces from the inner
        // defensive catch in `getDefaultValues` — same observable
        // behaviour as today's pre-fix catch path. Common-case sync
        // siblings on flat object schemas are unaffected.
        return s

      case 'lazy': {
        const inner = unwrapLazy(s)
        if (inner === undefined) return s
        const stripped = recurse(inner)
        return z.lazy(() => stripped)
      }
      case 'intersection': {
        const left = getIntersectionLeft(s)
        const right = getIntersectionRight(s)
        if (left === undefined || right === undefined) return s
        return z.intersection(recurse(left), recurse(right))
      }
      case 'catch': {
        const inner = unwrapInner(s)
        if (inner === undefined) return s
        return (recurse(inner) as z.ZodType).catch(getCatchDefault(s) as never)
      }

      // Leaves with no checks — pass through unchanged.
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
      case 'transform':
        return s
      default: {
        const _exhaustive: never = kind
        throw new Error(`stripAsyncChecks: unhandled ZodKind '${_exhaustive as string}'`)
      }
    }
  }

  return recurse(schema)
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
 *
 * `maxRecursionDepth` caps descent through `z.lazy()`. At the cap, the
 * walker returns the original lazy unchanged — keeping the schema valid
 * for the consumer's actual data while bounding the slim-rebuild work.
 */
export function getSlimSchema(
  schema: z.ZodType,
  stripConfig: StripConfig,
  maxRecursionDepth: number
): z.ZodType {
  return walkSlim(schema, stripConfig, maxRecursionDepth, 0)
}

function walkSlim(
  schema: z.ZodType,
  stripConfig: StripConfig,
  maxDepth: number,
  lazyDepth: number
): z.ZodType {
  const kind = kindOf(schema)
  switch (kind) {
    case 'optional': {
      const inner = unwrapInner(schema) ?? schema
      const slimmedInner = walkSlim(inner, stripConfig, maxDepth, lazyDepth)
      return stripConfig.stripOptional === true ? slimmedInner : slimmedInner.optional()
    }
    case 'nullable': {
      const inner = unwrapInner(schema) ?? schema
      const slimmedInner = walkSlim(inner, stripConfig, maxDepth, lazyDepth)
      return stripConfig.stripNullable === true ? slimmedInner : slimmedInner.nullable()
    }
    case 'default': {
      const inner = unwrapInner(schema) ?? schema
      const slimmedInner = walkSlim(inner, stripConfig, maxDepth, lazyDepth)
      if (stripConfig.stripDefaultValues === true) return slimmedInner
      // Re-apply the default to the slimmed inner. Returning `schema`
      // unchanged would skip nested stripping (refinements / pipe inside
      // a `.default()` wrapper would survive, breaking parity with the
      // optional / nullable cases above). The default value lives on
      // the wrapper at `_zod.def.defaultValue`; introspect.getDefaultValue
      // reads it through the v4 getter and resolves to the materialised
      // value (lazy `.default(() => x)` getters fire here — we rewrap
      // as a fixed value, which is correct for the slim schema's
      // single-shot use during default-values derivation).
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
        : (walkSlim(inner, stripConfig, maxDepth, lazyDepth) as z.ZodType).readonly()
    }
    case 'pipe': {
      // `.pipe(...)` chains schemas sequentially — the output of one
      // feeds the input of the next — and typically carries a
      // `.transform(...)` that mutates the runtime shape. Slimming the
      // inner and dropping the pipe wrapper would lose that
      // transformation, so by default we return the original schema
      // unchanged. Consumers who explicitly opt in via `stripPipe`
      // (e.g. default-values derivation, where a transform doesn't make
      // sense) get the "real" leg of the pipe — the side that ISN'T
      // a ZodTransform. For `z.preprocess(fn, inner)` that's `def.out`
      // (the inner schema); for `someSchema.transform(fn)` that's
      // `def.in` (the source schema). Falling through to the transform
      // side would re-run the user's fn during default-values
      // derivation — for preprocess that means a throwing fn crashes
      // mount even though there's nothing to normalize at init time.
      if (stripConfig.stripPipe === true) {
        const pipeIn = unwrapPipeIn(schema)
        const pipeOut = unwrapPipeOut(schema)
        const real =
          pipeIn !== undefined && kindOf(pipeIn) !== 'transform'
            ? pipeIn
            : pipeOut !== undefined && kindOf(pipeOut) !== 'transform'
              ? pipeOut
              : (pipeIn ?? pipeOut ?? schema)
        return walkSlim(real, stripConfig, maxDepth, lazyDepth)
      }
      return schema
    }
    case 'object': {
      const shape = getObjectShape(schema as z.ZodObject)
      const next: Record<string, z.ZodType> = {}
      for (const [k, v] of Object.entries(shape)) {
        next[k] = walkSlim(v, stripConfig, maxDepth, lazyDepth)
      }
      return carryChecks(z.object(next), schema, stripConfig)
    }
    case 'array': {
      const element = getArrayElement(schema as z.ZodArray)
      return carryChecks(
        z.array(walkSlim(element, stripConfig, maxDepth, lazyDepth)),
        schema,
        stripConfig
      )
    }
    case 'set': {
      const valueType = getSetValueType(schema)
      return carryChecks(
        z.set(walkSlim(valueType, stripConfig, maxDepth, lazyDepth)),
        schema,
        stripConfig
      )
    }
    case 'tuple': {
      const items = getTupleItems(schema).map((it) =>
        walkSlim(it, stripConfig, maxDepth, lazyDepth)
      )
      const rebuilt = z.tuple(
        items as unknown as [z.ZodType, ...z.ZodType[]]
      ) as unknown as z.ZodType
      return carryChecks(rebuilt, schema, stripConfig)
    }
    case 'record': {
      const keyType = getRecordKeyType(schema)
      const valueType = walkSlim(getRecordValueType(schema), stripConfig, maxDepth, lazyDepth)
      const rebuilt = z.record(keyType as z.ZodType<string | number | symbol>, valueType)
      return carryChecks(rebuilt, schema, stripConfig)
    }
    case 'union': {
      const options = getUnionOptions(schema).map((opt) =>
        walkSlim(opt, stripConfig, maxDepth, lazyDepth)
      )
      const rebuilt = z.union(options as unknown as readonly [z.ZodType, z.ZodType, ...z.ZodType[]])
      return carryChecks(rebuilt, schema, stripConfig)
    }
    case 'discriminated-union': {
      const options = getDiscriminatedOptions(schema).map(
        (opt) => walkSlim(opt, stripConfig, maxDepth, lazyDepth) as z.ZodObject
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
      // Past the cap, leave the original lazy in place. The slim schema
      // is for default-derivation and structural shape checks; keeping
      // the raw lazy at the recursion frontier is safe — parsing reaches
      // the same downstream getter either way.
      if (lazyDepth >= maxDepth) return schema
      const inner = unwrapLazy(schema)
      if (inner === undefined) return schema
      const slimmedInner = walkSlim(inner, stripConfig, maxDepth, lazyDepth + 1)
      return z.lazy(() => slimmedInner)
    }
    case 'intersection': {
      const left = getIntersectionLeft(schema)
      const right = getIntersectionRight(schema)
      if (left === undefined || right === undefined) return schema
      return z.intersection(
        walkSlim(left, stripConfig, maxDepth, lazyDepth),
        walkSlim(right, stripConfig, maxDepth, lazyDepth)
      )
    }
    case 'catch': {
      const inner = unwrapInner(schema)
      if (inner === undefined) return schema
      const slimmedInner = walkSlim(inner, stripConfig, maxDepth, lazyDepth)
      // Preserve the catch wrapper so downstream safeParse still uses
      // the declared fallback — stripping it would discard user intent.
      return (slimmedInner as z.ZodType).catch(getCatchDefault(schema) as never)
    }
    case 'transform':
      // ZodTransform is the input side of `z.preprocess(fn, inner)` and
      // never appears as a top-level schema reachable from the slim path
      // (the surrounding pipe descends into `.out` for the inner shape).
      // Pass through unchanged for exhaustive switch safety.
      return schema
    default: {
      const _exhaustive: never = kind
      throw new Error(`getSlimSchema: unhandled ZodKind '${_exhaustive as string}'`)
    }
  }
}
