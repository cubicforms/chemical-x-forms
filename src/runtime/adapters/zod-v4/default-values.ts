import type { z } from 'zod'
import { getAtPath, isPlainRecord, setAtPath } from '../../core/path-walker'
import { slimKindOf } from '../../core/slim-primitive-gate'
import { getDiscriminatedUnionFirstOption, unwrapToDiscriminatedUnion } from './discriminator'
import { slimPrimitivesOf } from './slim-primitives'
import {
  getCatchDefault,
  getDefaultValue,
  getDiscriminatedOptions,
  getEnumValues,
  getIntersectionLeft,
  getIntersectionRight,
  getLiteralValues,
  getObjectShape,
  getTupleItems,
  getUnionOptions,
  kindOf,
  unwrapInner,
  unwrapLazy,
  unwrapPipe,
  type ZodKind,
} from './introspect'
import { getNestedZodSchemasAtPath } from './path-walker'
import { getSlimSchema } from './strip'

/**
 * Derive a default value for any Zod v4 schema. Mirrors v3's walker but
 * routes through the introspect helpers so `def.*` access stays
 * chokepointed. When `useDefault` is false, `.default(x)` wrappers are
 * skipped so the walker produces the underlying leaf's empty value
 * instead — useful when the caller wants a "blank" initial state rather
 * than the schema's declared defaults.
 */
export function deriveDefault(schema: z.ZodType, useDefault: boolean): unknown {
  return defaultForKind(kindOf(schema), schema, useDefault)
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
    case 'set':
      return new Set()
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
      const first = getDiscriminatedUnionFirstOption(schema)
      return first === undefined ? undefined : deriveDefault(first, useDefault)
    }
    case 'string':
      return ''
    case 'number':
      return 0
    case 'bigint':
      // z.bigint() strictly rejects numbers; the default must be a bigint
      // literal. Using `0` here causes default-values derivation to fail
      // the schema's own validation.
      return 0n
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
    case 'lazy': {
      const inner = unwrapLazy(schema)
      return inner === undefined ? undefined : deriveDefault(inner, useDefault)
    }
    case 'intersection': {
      const left = getIntersectionLeft(schema)
      const right = getIntersectionRight(schema)
      const l = left === undefined ? undefined : deriveDefault(left, useDefault)
      const r = right === undefined ? undefined : deriveDefault(right, useDefault)
      // `mergeDeep` prefers `right` where both sides carry a plain-record
      // value at a key, and returns `right` wholesale when either side is
      // a leaf. That matches parse-time semantics: an intersection of
      // `{ a }` and `{ b }` must satisfy both, so the merged shape carries
      // both keys' defaults.
      return mergeDeep(l, r)
    }
    case 'catch': {
      // Catch wraps a schema with a fallback value used when parsing
      // fails. For `useDefault=true` the catch value *is* the best
      // default — it's the authoritative "fresh" value the consumer
      // declared. For `useDefault=false` fall through to the inner
      // walker so the leaf's empty value wins (matches the default/
      // prefault branch's semantics).
      if (useDefault) return getCatchDefault(schema)
      const inner = unwrapInner(schema)
      return inner === undefined ? undefined : deriveDefault(inner, useDefault)
    }
    case 'any':
    case 'unknown':
    case 'void':
    case 'never':
    case 'promise':
    case 'custom':
    case 'template-literal':
      // `promise`/`custom`/`template-literal` are rejected by
      // `assertSupportedKinds` at adapter construction, so this branch
      // is unreachable through the public surface. Kept for exhaustive
      // switch safety when `deriveDefault` is called directly in tests.
      return undefined
  }
}

/**
 * Merge `override` into `base` recursively, preferring override leaves.
 *
 * Leaf semantics (anything not a plain `{}` record is a leaf):
 *   - `undefined` override → no-op (don't drop the base value)
 *   - `null` override → replaces base (a deliberate "clear this field" signal)
 *   - primitives, arrays, `Date`, `Map`, class instances → replace wholesale
 *
 * Only plain records on BOTH sides recurse. The previous implementation
 * walked any `typeof === 'object'` value, which collapsed `Date`/`Map`
 * overrides into `{}` and silently swallowed `null` overrides intended
 * to clear a nullable default.
 */
export function mergeDeep(base: unknown, override: unknown): unknown {
  if (override === undefined) return base
  // Non-plain-record overrides are leaves and replace base wholesale.
  // (null, primitives, arrays, Date, Map, class instances all land here.)
  if (!isPlainRecord(override)) return override
  // Override is a plain record but base isn't — leaf-replacement again.
  if (!isPlainRecord(base)) return override

  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(override)) {
    const oVal = override[key]
    const bVal = base[key]
    // Recurse only when BOTH sides are plain records; otherwise treat the
    // override as a leaf. Preserves the historic quirk that an explicit
    // `undefined` does NOT evict the base key (consumers who want to
    // clear a field use `null`).
    if (isPlainRecord(oVal) && isPlainRecord(bVal)) {
      result[key] = mergeDeep(bVal, oVal)
    } else if (oVal !== undefined) {
      result[key] = oVal
    }
  }
  return result
}

export type GetDefaultValuesOptions = {
  schema: z.ZodObject
  useDefaultSchemaValues: boolean
  constraints: unknown
}

export type DefaultValuesResult<Form> = {
  data: Form
  success: boolean
  slimSchema: z.ZodType
}

/**
 * getDefaultValuesFromZodSchema — produces a form's starting value.
 *
 * The algorithm mirrors v3's: walk the schema to derive blank defaults,
 * merge constraints, then run the schema's `safeParse`. On failure, walk
 * the resulting issues and fill in issue-specific defaults at each
 * complaining path — e.g. `invalid_type` with `issue.expected === 'string'`
 * fills in `''`, `invalid_value` picks the first allowed value, etc. Re-
 * parse and return.
 *
 * Refinements are always stripped from the slim schema — this helper's
 * concern is producing usable starting data, not surfacing refinement
 * errors. Refinement enforcement (in strict mode) lives upstream in
 * `adapter.ts`'s `rootSchema.safeParse(data)` pass, which uses the full
 * schema. Stripping here is also what keeps `safeParse` from throwing
 * synchronously when the schema contains an async refine.
 */
export function getDefaultValuesFromZodSchema<Form>(
  opts: GetDefaultValuesOptions
): DefaultValuesResult<Form> {
  const { schema, useDefaultSchemaValues, constraints } = opts
  const initial = deriveDefault(schema, useDefaultSchemaValues)
  const merged = mergeDeep(initial, constraints) as unknown

  // Strip wrappers, including refinements. The slim schema is for
  // *default-value derivation* — its job is to produce usable starting
  // data, not to surface refinement errors. Refinement errors are the
  // domain of the strict-mode pass downstream (`adapter.ts`'s
  // `rootSchema.safeParse(data)`), which uses the full schema.
  //
  // Crucially, this also avoids `safeParse` throwing synchronously when
  // the schema contains an async refine (zod's "Encountered Promise
  // during synchronous parse" error) — which would otherwise crash
  // construction for any strict-mode form with `z.string().refine(async …)`.
  const slimSchema = getSlimSchema(schema, {
    stripDefaultValues: true,
    stripPipe: true,
    stripRefinements: true,
  })

  const firstParse = slimSchema.safeParse(merged)
  if (firstParse.success) {
    return { data: firstParse.data as Form, success: true, slimSchema }
  }

  // Validate-then-fix: walk issues and fill defaults per path. Under
  // the slim-primitive write contract, we only fix issues that violate
  // STRUCTURAL or PRIMITIVE-TYPE shape. Refinement-level issues (enum
  // membership, literal equality, .email/.min(N)/regex, custom
  // refines, unrecognized_keys) pass THROUGH unchanged — the user's
  // defaultValues are preserved verbatim and the strict-mode
  // validation pass downstream surfaces the error at construction.
  //
  // The discriminant: look up the actual offending value at the
  // issue's path and check its slim primitive kind against the
  // candidate schema's slim primitive set. If the value's kind IS in
  // the set, the issue is refinement-level → skip. If it's NOT in
  // the set, the issue is primitive/structural → fix. This unifies
  // every issue code under one check rather than enumerating refinement
  // codes (which differ between Zod versions and grow over time).
  let fixedData = merged as Record<string, unknown>
  for (const issue of firstParse.error.issues) {
    const pathSegments = issue.path.map((seg) => (typeof seg === 'number' ? seg : String(seg))) as (
      | string
      | number
    )[]
    // Pass the structured path directly — joining with '.' would merge
    // a literal-dot key (`['profile.name']`) into two segments and
    // target the wrong sub-schema during fix-up.
    const candidates = getNestedZodSchemasAtPath(slimSchema, pathSegments)
    if (candidates.length === 0) continue
    const candidate = candidates[0]
    if (candidate === undefined) continue

    // Refinement-vs-primitive classification.
    const valueAtPath = getAtPath(merged, pathSegments)
    const slimKinds = slimPrimitivesOf(candidate)
    if (slimKinds.size > 0 && slimKinds.has(slimKindOf(valueAtPath))) {
      // Refinement-level: pass through unchanged.
      continue
    }

    // Some issues don't carry a type path: fall back to deriving a default
    // for the schema at that location.
    const fixValue = defaultFromIssue(issue, candidate, useDefaultSchemaValues)
    if (fixValue === SKIP) continue
    fixedData = (
      pathSegments.length === 0 ? fixValue : setAtPath(fixedData, pathSegments, fixValue)
    ) as Record<string, unknown>
  }

  const secondParse = slimSchema.safeParse(fixedData)
  if (secondParse.success) {
    return { data: secondParse.data as Form, success: true, slimSchema }
  }

  // Last-resort: hand back what we constructed even if it still doesn't
  // parse. Better a partially-valid form than an exception at mount time.
  return { data: fixedData as unknown as Form, success: false, slimSchema }
}

const SKIP = Symbol('cx:skip-fix')

/**
 * Map a Zod v4 issue to a concrete replacement value for the path the
 * issue points at. Falls back to the candidate subschema's walker default
 * when the issue code doesn't carry enough info.
 */
function defaultFromIssue(
  issue: z.core.$ZodIssue,
  candidate: z.ZodType,
  useDefaultSchemaValues: boolean
): unknown {
  if (issue.code === 'invalid_type') {
    // If the candidate is (or wraps) a discriminated union, prefer the
    // first-option default over `undefined` — matches v3's behaviour.
    const du = unwrapToDiscriminatedUnion(candidate)
    if (du !== undefined) {
      const first = getDiscriminatedUnionFirstOption(du)
      if (first !== undefined) return deriveDefault(first, useDefaultSchemaValues)
    }
    return deriveDefault(candidate, useDefaultSchemaValues)
  }
  if (issue.code === 'invalid_value') {
    const values = (issue as unknown as { values?: readonly unknown[] }).values
    if (values !== undefined && values.length > 0) return values[0]
    return deriveDefault(candidate, useDefaultSchemaValues)
  }
  // Other issue codes (too_small/too_big/invalid_format) only fire in strict
  // mode since lax mode strips refinements. Fall back to the walker default.
  return deriveDefault(candidate, useDefaultSchemaValues)
}

/**
 * Exported for callers who want the discriminated-union option set for
 * path resolution (used by the adapter's getSchemasAtPath).
 */
export { getDiscriminatedOptions, getUnionOptions }
