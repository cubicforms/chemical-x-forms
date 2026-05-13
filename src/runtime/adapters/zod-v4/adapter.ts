import type { z } from 'zod'
import type {
  AbstractSchema,
  FieldMetaPayload,
  FormKey,
  ResolvedFieldMeta,
  SlimPrimitiveKind,
  UnionDiscriminatorContext,
  ValidationError,
  ValidationResponse,
} from '../../types/types-api'
import { AttaformErrorCode } from '../../core/error-codes'
import { getFieldMeta, getFieldMetaList } from './field-meta'
import type { SchemaFactoryOptions } from '../../core/get-computed-schema'
import { humanize } from '../../core/humanize'
import { canonicalizePath, type Path, type PathKey } from '../../core/paths'
import type { DeepPartial, GenericForm } from '../../types/types-core'
import { assertSupportedKinds } from './assert-supported'
import { unwrapToDiscriminatedUnion } from './discriminator'
import { zodIssuesToValidationErrors } from './errors'
import { fingerprintZodSchema } from './fingerprint'
import { deriveDefault, getDefaultValuesFromZodSchema } from './default-values'
import {
  assertZodVersion,
  containsAsyncRefine,
  getArrayElement,
  getDiscriminatedOptions,
  getDiscriminator,
  getIntersectionLeft,
  getIntersectionRight,
  getLiteralValues,
  getObjectShape,
  getRecordValueType,
  getSetValueType,
  getTupleItems,
  getUnionOptions,
  kindOf,
  readTransformFn,
  unwrapInner,
  unwrapLazy,
  unwrapPipe,
  unwrapPipeIn,
  unwrapPipeOut,
} from './introspect'
import { getNestedZodSchemasAtPath } from './path-walker'
import { slimPrimitivesOf } from './slim-primitives'
import { stripAsyncChecks } from './strip'

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
 * Peel `.optional()` / `.nullable()` wrappers off a leaf schema ONLY
 * when the inner type is structurally fillable (object, array, tuple,
 * record, discriminated/plain union, intersection — or itself a
 * peelable wrapper that resolves to one of those). Peeling exposes
 * the inner shape's default so consumer-supplied partial writes
 * through optional sub-schemas (`{ profile: z.object({...}).optional() }`,
 * `setValue('profile', { name: 'X' })`) get the inner shape's
 * structural defaults filled in.
 *
 * For PRIMITIVE inner (ZodString, ZodNumber, ZodBoolean, ZodLiteral,
 * etc.), the wrapper IS the meaningful schema — `optional` means
 * "missing is allowed", `nullable` means "null is allowed". Peeling
 * an optional string to its inner string would default the leaf to
 * `''` and cause mergeStructural to write `notes: ''` instead of
 * `notes: undefined` when filling sibling keys at the parent object
 * — the runtime would silently overwrite the optional's "absent"
 * intent with a non-empty marker.
 *
 * `.default(x)` is left intact at every level so deriveDefault
 * returns the explicit default value. Bounded iteration cap as a
 * runaway guard for pathological wrappers.
 */
function unwrapStructuralWrappers(schema: z.ZodType): z.ZodType {
  let current: z.ZodType = schema
  for (let i = 0; i < 64; i++) {
    const outerKind = kindOf(current)
    if (outerKind !== 'optional' && outerKind !== 'nullable') break
    const inner = unwrapInner(current)
    if (inner === undefined) return current
    if (!isStructuralKind(kindOf(inner))) break
    current = inner
  }
  return current
}

/**
 * Peel every transparent wrapper (optional / nullable / default /
 * readonly / catch / pipe / lazy) off `schema`. Stops on the first
 * non-wrapper kind. Used by `arrayShapeAtPath` for shape
 * introspection where we want the inner kind regardless of what the
 * default-value semantic is — different from
 * `unwrapStructuralWrappers`, which preserves `.default()` so the
 * runtime fill returns the explicit default.
 *
 * Bounded iteration cap as a runaway guard for pathological wrappers.
 */
function peelAllWrappers(schema: z.ZodType): z.ZodType {
  let current: z.ZodType = schema
  for (let i = 0; i < 64; i++) {
    const k = kindOf(current)
    let inner: z.ZodType | undefined
    if (
      k === 'optional' ||
      k === 'nullable' ||
      k === 'default' ||
      k === 'readonly' ||
      k === 'catch'
    ) {
      inner = unwrapInner(current)
    } else if (k === 'pipe') {
      inner = unwrapPipe(current)
    } else if (k === 'lazy') {
      inner = unwrapLazy(current)
    } else {
      return current
    }
    if (inner === undefined) return current
    current = inner
  }
  return current
}

/**
 * Kinds for which mergeStructural can recurse to fill missing keys
 * or pad missing positions. Primitive leaves (string / number / etc.)
 * and opaque non-recursable wrappers fall outside this set, so
 * peeling Optional / Nullable around them would lose information
 * (the wrapper's "absent / null" semantic) without enabling any fill.
 *
 * Wrappers themselves count as structural — `unwrapStructuralWrappers`
 * recurses to re-check their inner kind.
 */
const STRUCTURAL_KINDS: ReadonlySet<ReturnType<typeof kindOf>> = new Set([
  'object',
  'array',
  'tuple',
  'record',
  'discriminated-union',
  'union',
  'intersection',
  'optional',
  'nullable',
  'default',
  'readonly',
  'catch',
  'pipe',
  'lazy',
])

function isStructuralKind(kind: ReturnType<typeof kindOf>): boolean {
  return STRUCTURAL_KINDS.has(kind)
}

const MAX_REQUIRED_DEPTH = 64

/**
 * `true` if the leaf is required — `false` if any wrapper layer admits
 * "empty" via `.optional()`, `.nullable()`, `.default(N)`, or
 * `.catch(N)`. See `AbstractSchema.isRequiredAtPath` for the full
 * semantic specification (union → permissive, intersection → strict,
 * readonly/pipe/lazy → transparent peel).
 */
function isLeafRequired(schema: z.ZodType, depth = 0): boolean {
  if (depth > MAX_REQUIRED_DEPTH) return true
  const kind = kindOf(schema)
  // Direct "schema accepts empty" wrappers and bare empty-marker leaves —
  // short-circuit. `z.undefined()` / `z.null()` / `z.void()` inside a
  // union (`z.union([z.number(), z.undefined()])`) are how schema authors
  // express "this field can be absent" without a wrapper, so they count
  // as not-required here.
  if (
    kind === 'optional' ||
    kind === 'nullable' ||
    kind === 'default' ||
    kind === 'catch' ||
    kind === 'undefined' ||
    kind === 'null' ||
    kind === 'void'
  ) {
    return false
  }
  // Transparent wrappers — peel and re-check.
  if (kind === 'readonly') {
    const inner = unwrapInner(schema)
    return inner === undefined ? true : isLeafRequired(inner, depth + 1)
  }
  if (kind === 'pipe') {
    // Use the input side: blank is a write-time concern.
    const inner = unwrapPipe(schema)
    return inner === undefined ? true : isLeafRequired(inner, depth + 1)
  }
  if (kind === 'lazy') {
    const inner = unwrapLazy(schema)
    return inner === undefined ? true : isLeafRequired(inner, depth + 1)
  }
  // Union — required only if EVERY branch is required (any permissive
  // branch makes the union permissive at parse time).
  if (kind === 'union' || kind === 'discriminated-union') {
    const options =
      kind === 'discriminated-union' ? getDiscriminatedOptions(schema) : getUnionOptions(schema)
    if (options.length === 0) return true
    return options.every((opt) => isLeafRequired(opt as z.ZodType, depth + 1))
  }
  // Intersection — required if EITHER side is required (a parse must
  // satisfy both; the strict side governs).
  if (kind === 'intersection') {
    const left = getIntersectionLeft(schema)
    const right = getIntersectionRight(schema)
    const leftReq = left === undefined ? true : isLeafRequired(left, depth + 1)
    const rightReq = right === undefined ? true : isLeafRequired(right, depth + 1)
    return leftReq || rightReq
  }
  // Direct primitive leaf or unsupported kind — required by default.
  return true
}

/**
 * Wrap a Zod v4 `ZodObject` schema in an `AbstractSchema` factory.
 *
 * Most consumers never call this directly — `useForm` from
 * `attaform/zod` does the wrapping automatically. Reach for
 * it when you need an adapter outside of `useForm` (e.g. validating
 * data with the same library used elsewhere in the form runtime, or
 * exposing the adapter to a custom integration).
 *
 * The returned factory accepts per-form `SchemaFactoryOptions` (notably
 * `maxRecursionDepth`); the adapter closure bakes them into every
 * downstream walk so a per-form override can lift the cap without
 * touching the app-level default.
 *
 * Throws if the schema isn't Zod v4 or contains kinds the adapter
 * cannot represent (`z.promise`, `z.custom`, `z.templateLiteral`).
 * Recursive `z.lazy(...)` is supported — the runtime walks bound their
 * descent via `maxRecursionDepth`.
 */
export function zodV4Adapter<
  FormSchema extends z.ZodObject,
  Form extends z.input<FormSchema>,
  GetValueFormType extends z.output<FormSchema> = z.output<FormSchema>,
>(
  rootSchema: FormSchema
): (formKey: FormKey, options: SchemaFactoryOptions) => AbstractSchema<Form, GetValueFormType> {
  assertZodVersion(rootSchema)
  // Fail fast at adapter construction if the schema uses kinds we can't
  // represent (z.promise / z.custom / z.templateLiteral). Errors carry
  // the dotted path to the offending node. Recursive lazies pass — the
  // runtime walks cap their descent via `maxRecursionDepth`.
  assertSupportedKinds(rootSchema)

  return (
    formKey: FormKey,
    options: SchemaFactoryOptions
  ): AbstractSchema<Form, GetValueFormType> => {
    const maxRecursionDepth = options.maxRecursionDepth
    // Per-adapter `isLeafAtPath` cache. Lifetime = one adapter instance
    // (one per `useForm()` call). Memoises the slim-primitive walk so the
    // leaf-aware proxy traps don't re-walk the schema on every read.
    const leafCache = new Map<PathKey, boolean>()
    // Memoised one-shot walk; `needsAsyncValidation` is queried at
    // construction and possibly again from devtools, so a single tree
    // traversal earns its keep across the adapter's lifetime.
    let asyncValidationFlag: boolean | null = null

    return {
      fingerprint: () => fingerprintZodSchema(rootSchema),

      needsAsyncValidation(): boolean {
        asyncValidationFlag ??= containsAsyncRefine(rootSchema)
        return asyncValidationFlag
      },

      getDefaultValues(
        config
      ): ReturnType<AbstractSchema<Form, GetValueFormType>['getDefaultValues']> {
        const { data } = getDefaultValuesFromZodSchema<Form>({
          schema: rootSchema,
          useDefaultSchemaValues: config.useDefaultSchemaValues,
          constraints: config.constraints,
          maxRecursionDepth,
        })

        if (config.strict !== false) {
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
            const strictResult = rootSchema.safeParse(
              data
            ) as z.ZodSafeParseResult<GetValueFormType>
            if (strictResult.success) {
              // Storage holds the pre-transform `z.input` view, so we
              // return the original `data` (already filled by
              // `getDefaultValuesFromZodSchema`) rather than
              // `strictResult.data` (the post-transform `z.output`).
              // For schemas without `.transform()` the two coincide;
              // for schemas with one the storage stays the honest input
              // view that `form.values` reflects.
              return { data, errors: undefined, success: true, formKey }
            }
            return {
              data,
              errors: zodIssuesToValidationErrors(strictResult.error.issues, formKey),
              success: false,
              formKey,
            }
          } catch {
            // Async-refine threw the sync parser. Retry against a
            // sync-only variant of the schema so sync-refinement
            // errors on the supplied defaults still seed at
            // construction. Async-only errors stay deferred to the
            // post-mount one-shot async validation that
            // `create-form-store` schedules when
            // `needsAsyncValidation()` is true (the contract here is
            // sync, so async verdicts cannot land in this code path
            // regardless).
            try {
              const syncOnly = stripAsyncChecks(rootSchema)
              const syncResult = syncOnly.safeParse(data) as z.ZodSafeParseResult<GetValueFormType>
              if (syncResult.success) {
                // Sync portion is clean; only async refines could
                // fail. Mount cleanly and let the post-mount async
                // pass surface those — same observable behaviour as
                // the pre-fix catch path for schemas with no sync
                // refines on their defaults.
                return { data, errors: undefined, success: true, formKey }
              }
              return {
                data,
                errors: zodIssuesToValidationErrors(syncResult.error.issues, formKey),
                success: false,
                formKey,
              }
            } catch {
              // Defensive floor — same as the pre-fix behaviour. The
              // strip walker covers every ZodKind, but a future zod
              // construct or a user-defined sync refine that itself
              // throws would land here. Mount cleanly; the post-mount
              // async pass is still the source of truth for any
              // verdict the construction-time parse can't surface.
              return { data, errors: undefined, success: true, formKey }
            }
          }
        }

        // Lax mode: the validate-then-fix loop has done everything it can;
        // a partially-valid initial state is preferable to a mount-time
        // exception. Matches v3's lax semantics.
        return { data, errors: undefined, success: true, formKey }
      },

      normalizeWriteValueAtPath(value, path) {
        // Zod expresses input normalization as `z.preprocess(fn,
        // inner)`, which desugars to a pipe whose `def.in` is a bare
        // ZodTransform (no schema constraint) and `def.out` is the
        // inner schema. We walk to the schema at `path` and apply
        // each preprocess wrapper found there, descending through
        // nested stacks. Post-validation transforms (e.g.
        // `z.string().transform(fn)`) have `def.out` as the transform
        // and `def.in` as the real schema — those aren't input
        // normalizations and are left untouched.
        const candidates =
          path.length === 0
            ? [rootSchema]
            : getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
        // Multi-candidate paths (union descent) — pick the first; the
        // adapter's first-success convention matches getDefaultAtPath.
        const [first] = candidates
        if (first === undefined) return value
        let current: z.ZodType = first
        let result: unknown = value
        // Bounded loop matches unwrapToDiscriminatedUnion's 64-step
        // cap — a deeper preprocess stack is almost certainly a
        // recursive z.lazy cycle, not legitimate.
        for (let i = 0; i < 64; i++) {
          if (kindOf(current) !== 'pipe') break
          const pipeIn = unwrapPipeIn(current)
          if (pipeIn === undefined || kindOf(pipeIn) !== 'transform') break
          const fn = readTransformFn(pipeIn)
          if (typeof fn !== 'function') break
          let next: unknown
          try {
            next = fn(result)
          } catch (cause) {
            // User's normalization fn threw. Don't silently swallow —
            // wrap with a path-tagged message and re-raise so the
            // caller (setValueAtPath) sees it. The user wrote the
            // fn, they own the bug; we just make it diagnosable.
            throw new Error(
              `[attaform] input normalization at path "${path.join('.')}" threw — write rejected.`,
              { cause }
            )
          }
          if (next instanceof Promise) {
            // Async preprocess can't run at write time (setValue is
            // sync). Leave the input as-is; validation will run the
            // preprocess properly during parse.
            return value
          }
          result = next
          const out = unwrapPipeOut(current)
          if (out === undefined) break
          current = out
        }
        return result
      },

      getDefaultAtPath(path) {
        // For empty path, the "default at root" is the schema's full
        // default — return the deriveDefault of the root, not the slim-
        // schema validate-then-fix loop (that's getDefaultValues' job).
        if (path.length === 0) return deriveDefault(rootSchema, true, maxRecursionDepth)
        const [first] = getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
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
        return deriveDefault(unwrapStructuralWrappers(first), true, maxRecursionDepth)
      },

      getEmptyValueAtPath(path) {
        // `clear`'s underlying value lookup. Same path-resolution flow
        // as `getDefaultAtPath` (root for empty path, first candidate
        // for unions), but `useDefault=false` so `.default(x)` /
        // `.prefault(x)` / `.catch(x)` wrappers are skipped — the
        // walker yields the inner-schema's empty/falsy concrete
        // instead. Structural wrappers (`.optional()` / `.nullable()`)
        // are NOT peeled: clearing an `.optional()` slot is
        // legitimately `undefined`, clearing a `.nullable()` slot is
        // `null` — that's the user's "this slot is empty" signal at
        // those wrapper types.
        if (path.length === 0) return deriveDefault(rootSchema, false, maxRecursionDepth)
        const [first] = getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
        if (first === undefined) return undefined
        return deriveDefault(first, false, maxRecursionDepth)
      },

      arrayShapeAtPath(path) {
        if (path.length === 0) return undefined
        const [first] = getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
        if (first === undefined) return undefined
        const peeled = peelAllWrappers(first)
        const kind = kindOf(peeled)
        if (kind === 'tuple') return getTupleItems(peeled).length
        if (kind === 'array') return null
        return undefined
      },

      getSchemasAtPath(path) {
        const resolved = getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
        return resolved.map(
          (schema) =>
            ({
              fingerprint: () => fingerprintZodSchema(schema),
              needsAsyncValidation: () => containsAsyncRefine(schema),
              getDefaultValues: () => ({
                data: deriveDefault(schema, true, maxRecursionDepth),
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
            }) as unknown as ReturnType<
              AbstractSchema<Form, GetValueFormType>['getSchemasAtPath']
            >[number]
        )
      },

      getSlimPrimitiveTypesAtPath(path): Set<SlimPrimitiveKind> {
        // Resolve every leaf candidate at the path (unions return
        // multiple) and union their slim-primitive sets. Empty path
        // is the root form: always an object.
        if (path.length === 0) return new Set(['object'])
        const resolved = getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
        // Path doesn't resolve in the schema → no kinds accepted.
        // The gate's membership check rejects every kind against an
        // empty set, blocking writes to typo / unknown paths.
        if (resolved.length === 0) return new Set()
        const out = new Set<SlimPrimitiveKind>()
        for (const candidate of resolved) {
          for (const k of slimPrimitivesOf(candidate, maxRecursionDepth)) out.add(k)
        }
        return out
      },

      isLeafAtPath(path): boolean {
        const cacheKey = canonicalizePath(path).key
        const cached = leafCache.get(cacheKey)
        if (cached !== undefined) return cached
        const prim = this.getSlimPrimitiveTypesAtPath(path)
        // Empty set → path doesn't exist in schema → descend
        // permissively (treat as container so schema-named reserved keys
        // at depth 2+ don't shadow). Any container kind in the set →
        // descend. Otherwise every kind is a primitive → leaf.
        const isLeaf =
          prim.size > 0 &&
          !prim.has('object') &&
          !prim.has('array') &&
          !prim.has('map') &&
          !prim.has('set')
        leafCache.set(cacheKey, isLeaf)
        return isLeaf
      },

      isRequiredAtPath(path): boolean {
        // Root form is always "required" in the structural sense — it's
        // the object we're parsing. Submit/validate's required-empty
        // check never sees the root path in `blankPaths`
        // (the set tracks primitive leaves), so the value is academic.
        if (path.length === 0) return true
        const resolved = getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
        if (resolved.length === 0) return false
        // Every candidate must be required for the path overall to be
        // required — matches the union "any-branch-permissive" rule
        // when the path traverses a union.
        return resolved.every((candidate) => isLeafRequired(candidate))
      },

      getFieldMetaAtPath(path): ResolvedFieldMeta {
        return resolveFieldMetaAtPath(rootSchema, path, maxRecursionDepth)
      },

      getUnionDiscriminatorAtPath(path): UnionDiscriminatorContext | undefined {
        // Resolve every candidate at `path`; pick the unique one that
        // is (or wraps) a discriminated union. Wrappers
        // (`.optional()` / `.default(...)` / etc.) are peeled by
        // `unwrapToDiscriminatedUnion`. Ambiguous resolutions (two
        // distinct DUs both reachable) bail — the runtime then falls
        // back to a plain write.
        const candidates =
          path.length === 0
            ? [rootSchema as z.ZodType]
            : getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
        let matchedUnion: z.ZodType | undefined
        for (const candidate of candidates) {
          const du = unwrapToDiscriminatedUnion(candidate)
          if (du === undefined) continue
          if (matchedUnion !== undefined && matchedUnion !== du) return undefined
          matchedUnion = du
        }
        if (matchedUnion === undefined) return undefined
        const discKey = getDiscriminator(matchedUnion)
        if (discKey === undefined) return undefined
        const options = getDiscriminatedOptions(matchedUnion)
        const literalSet = new Set<unknown>()
        for (const opt of options) {
          const shape = getObjectShape(opt)
          const litSchema = shape[discKey]
          if (litSchema === undefined) continue
          if (kindOf(litSchema) !== 'literal') continue
          for (const v of getLiteralValues(litSchema)) literalSet.add(v)
        }
        return {
          discriminatorKey: discKey,
          getVariantDefault(value: unknown): unknown {
            for (const opt of options) {
              const shape = getObjectShape(opt)
              const litSchema = shape[discKey]
              if (litSchema === undefined) continue
              if (kindOf(litSchema) !== 'literal') continue
              const literalValues = getLiteralValues(litSchema)
              if (literalValues.includes(value)) return deriveDefault(opt, true, maxRecursionDepth)
            }
            return undefined
          },
          isVariantSelected(value: unknown): boolean {
            return literalSet.has(value)
          },
        }
      },

      validateAtPath(
        data,
        path,
        options
      ): ReturnType<AbstractSchema<Form, GetValueFormType>['validateAtPath']> {
        // Sync attempt: when `options.sync === true`, try `safeParse`
        // (synchronous). It throws on async refines / pipes /
        // transforms; we catch and fall through to `safeParseAsync`.
        // Without the flag the adapter goes straight to async — the
        // historical contract every non-reshape callsite expects.
        const trySync = options?.sync === true
        if (trySync) {
          try {
            return runSync()
          } catch {
            // Async-only schema. Fall through to the async path.
          }
        }
        return runAsync()

        function runSync(): ValidationResponse<GetValueFormType> {
          if (path === undefined) {
            const result = rootSchema.safeParse(data) as z.ZodSafeParseResult<GetValueFormType>
            return result.success
              ? { data: result.data, errors: undefined, success: true, formKey }
              : {
                  data: undefined,
                  errors: zodIssuesToValidationErrors(result.error.issues, formKey),
                  success: false,
                  formKey,
                }
          }
          const resolved = getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
          if (resolved.length === 0) return pathNotFound(path)
          const aggregated: ValidationError[] = []
          for (const candidate of resolved) {
            const result = candidate.safeParse(data)
            if (result.success) {
              return {
                data: result.data as GetValueFormType,
                errors: undefined,
                success: true,
                formKey,
              }
            }
            aggregated.push(...zodIssuesToValidationErrors(result.error.issues, formKey))
          }
          return { data: undefined, errors: aggregated, success: false, formKey }
        }

        async function runAsync(): Promise<ValidationResponse<GetValueFormType>> {
          if (path === undefined) {
            const result = (await rootSchema.safeParseAsync(
              data
            )) as z.ZodSafeParseResult<GetValueFormType>
            return result.success
              ? { data: result.data, errors: undefined, success: true, formKey }
              : {
                  data: undefined,
                  errors: zodIssuesToValidationErrors(result.error.issues, formKey),
                  success: false,
                  formKey,
                }
          }
          const resolved = getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
          if (resolved.length === 0) return pathNotFound(path)
          // Sequential await — parallel parses would run every
          // branch's async side effects on a value only one branch
          // should see.
          const aggregated: ValidationError[] = []
          for (const candidate of resolved) {
            const result = await candidate.safeParseAsync(data)
            if (result.success) {
              return {
                data: result.data as GetValueFormType,
                errors: undefined,
                success: true,
                formKey,
              }
            }
            aggregated.push(...zodIssuesToValidationErrors(result.error.issues, formKey))
          }
          return { data: undefined, errors: aggregated, success: false, formKey }
        }

        function pathNotFound(p: Path): ValidationResponse<GetValueFormType> {
          return {
            data: undefined,
            errors: [
              {
                message: `Path '${p.join(PATH_SEPARATOR)}' did not resolve to any schema`,
                path: [...p],
                formKey,
                code: AttaformErrorCode.PathNotFound,
              },
            ],
            success: false,
            formKey,
          }
        }
      },
    }
  }
}

// Per-rootSchema cache of path → payload maps. Build is a single
// tree-walk; lookups are O(1) thereafter. WeakMap keyed on the root
// schema so entries GC with the form.
const pathMetaCache = new WeakMap<z.ZodType, Map<PathKey, FieldMetaPayload>>()

function getPathMetaMap(rootSchema: z.ZodType): Map<PathKey, FieldMetaPayload> {
  const cached = pathMetaCache.get(rootSchema)
  if (cached !== undefined) return cached
  const map = new Map<PathKey, FieldMetaPayload>()
  const counters = new Map<z.ZodType, number>()
  // Track the LAST path each schema was visited at — used after the
  // walk to absorb any "surplus" registrations (cases where the
  // registration list is longer than the schema is visited, e.g. a
  // chain like `withMeta(s, {label}).register(fieldMeta, {desc})`
  // where one path consumes list[0] and list[1] would otherwise go
  // unread). Surplus entries get merged into the schema's last-
  // visited path so chained registrations accumulate as expected.
  const lastPathPerSchema = new Map<z.ZodType, PathKey>()
  const inProgress = new WeakSet<z.ZodType>()
  walkForMeta(rootSchema, [], map, counters, lastPathPerSchema, inProgress)
  for (const [schema, lastPath] of lastPathPerSchema) {
    const list = getFieldMetaList(schema)
    const consumed = counters.get(schema) ?? 0
    if (list.length <= consumed) continue
    const surplus = list
      .slice(consumed)
      .reduce<FieldMetaPayload>((acc, p) => ({ ...acc, ...p }), {})
    const existing = map.get(lastPath) ?? {}
    map.set(lastPath, { ...existing, ...surplus })
  }
  pathMetaCache.set(rootSchema, map)
  return map
}

/**
 * Walk the schema tree from `rootSchema`, emitting a payload for
 * each path that has registered metadata. For schemas registered at
 * multiple paths (shared instance), the per-schema counter advances
 * each visit and selects the i-th payload from the schema's
 * registration list — when registrations happen inline in the
 * schema literal (the canonical pattern), declaration order matches
 * walk order, so each path lands on its intended payload.
 *
 * Visits the schema first (terminal-position registration), then
 * the peeled inner if different (inner-then-wrap registration). At
 * each point the FIRST list-payload found wins for that path.
 */
function walkForMeta(
  schema: z.ZodType,
  path: Path,
  map: Map<PathKey, FieldMetaPayload>,
  counters: Map<z.ZodType, number>,
  lastPathPerSchema: Map<z.ZodType, PathKey>,
  inProgress: WeakSet<z.ZodType>
): void {
  if (inProgress.has(schema)) return
  inProgress.add(schema)
  try {
    const pathKey = canonicalizePath(path).key
    // Pull a payload off the target schema's list (counter-indexed).
    if (!map.has(pathKey)) {
      const payload = consumePayload(schema, counters)
      if (payload !== undefined) {
        map.set(pathKey, payload)
        lastPathPerSchema.set(schema, pathKey)
      }
    }
    // Also try the peeled inner — covers `withMeta(z.string(), {...}).optional()`
    // where the registration sits on the inner before wrapping.
    const peeled = peelAllWrappers(schema)
    if (peeled !== schema && !map.has(pathKey)) {
      const payload = consumePayload(peeled, counters)
      if (payload !== undefined) {
        map.set(pathKey, payload)
        lastPathPerSchema.set(peeled, pathKey)
      }
    }
    // Descend.
    const kind = kindOf(schema)
    switch (kind) {
      case 'object': {
        const shape = getObjectShape(schema as z.ZodObject)
        for (const [key, child] of Object.entries(shape)) {
          walkForMeta(child, [...path, key], map, counters, lastPathPerSchema, inProgress)
        }
        return
      }
      case 'array': {
        // Visit the element schema with a synthetic '0' index so leaf
        // metadata under array elements gets registered per the array's
        // canonical "first slot" path. Per-index instantiations of the
        // array element share the same schema instance, so the
        // resolver's fallback (getFieldMeta on the schema) picks up
        // anything not captured here.
        walkForMeta(
          getArrayElement(schema as z.ZodArray),
          [...path, 0],
          map,
          counters,
          lastPathPerSchema,
          inProgress
        )
        return
      }
      case 'tuple': {
        const items = getTupleItems(schema)
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item !== undefined)
            walkForMeta(item, [...path, i], map, counters, lastPathPerSchema, inProgress)
        }
        return
      }
      case 'set':
        walkForMeta(
          getSetValueType(schema),
          [...path, 0],
          map,
          counters,
          lastPathPerSchema,
          inProgress
        )
        return
      case 'record':
        walkForMeta(
          getRecordValueType(schema),
          [...path, '*'],
          map,
          counters,
          lastPathPerSchema,
          inProgress
        )
        return
      case 'union': {
        for (const opt of getUnionOptions(schema)) {
          walkForMeta(opt, path, map, counters, lastPathPerSchema, inProgress)
        }
        return
      }
      case 'discriminated-union': {
        for (const opt of getDiscriminatedOptions(schema)) {
          walkForMeta(opt, path, map, counters, lastPathPerSchema, inProgress)
        }
        return
      }
      case 'optional':
      case 'nullable':
      case 'default':
      case 'readonly':
      case 'catch': {
        const inner = unwrapInner(schema)
        if (inner !== undefined)
          walkForMeta(inner, path, map, counters, lastPathPerSchema, inProgress)
        return
      }
      case 'pipe': {
        const inner = unwrapPipe(schema)
        if (inner !== undefined)
          walkForMeta(inner, path, map, counters, lastPathPerSchema, inProgress)
        return
      }
      case 'lazy': {
        const inner = unwrapLazy(schema)
        if (inner !== undefined)
          walkForMeta(inner, path, map, counters, lastPathPerSchema, inProgress)
        return
      }
      case 'intersection': {
        // Descend into both sides at the same path — registrations
        // on either side surface for the same path.
        const left = getIntersectionLeft(schema)
        const right = getIntersectionRight(schema)
        if (left !== undefined)
          walkForMeta(left, path, map, counters, lastPathPerSchema, inProgress)
        if (right !== undefined)
          walkForMeta(right, path, map, counters, lastPathPerSchema, inProgress)
        return
      }
      // Leaf kinds — no children to descend into; metadata for the
      // path itself was captured above. Listed explicitly so the
      // exhaustiveness check catches any new kind landing in Zod
      // without a corresponding decision here.
      case 'string':
      case 'number':
      case 'bigint':
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
        return
    }
  } finally {
    inProgress.delete(schema)
  }
}

function consumePayload(
  schema: z.ZodType,
  counters: Map<z.ZodType, number>
): FieldMetaPayload | undefined {
  const list = getFieldMetaList(schema)
  if (list.length === 0) return undefined
  const idx = counters.get(schema) ?? 0
  // Clamp to last entry — schemas reused MORE times than they're
  // registered (e.g. an array element schema registered once,
  // visited per-index) all share the single registration.
  const payload = list[Math.min(idx, list.length - 1)]
  counters.set(schema, idx + 1)
  return payload
}

/**
 * Resolve the field metadata for the schema node at `path`. Reads
 * the `fieldMeta` registry on the resolved Zod schema and applies
 * the precedence rules in `getFieldMetaAtPath`'s docblock:
 *
 *   - label: registry → humanize(lastSegment)
 *   - description: registry → schema.description (.describe()) → undefined
 *   - placeholder: registry → undefined
 *   - meta: registry payload (frozen) — empty object when absent
 *
 * Returns the empty resolution when the path doesn't resolve in the
 * schema. DU branches: first candidate wins (matches the existing
 * first-success precedent in `getDefaultAtPath` / `validateAtPath`).
 *
 * For shared schemas registered at multiple paths (the canonical
 * `addressSchema.register(fieldMeta, A); addressSchema.register(fieldMeta, B)`
 * footgun), the path-resolver builds a per-rootSchema path → payload
 * map by walking the schema tree once, counting per-schema
 * occurrences and pairing them with the registration list in
 * declaration order. Object literals evaluate left-to-right, so
 * registration order matches tree-walk order, and the mapping pairs
 * correctly.
 */
function resolveFieldMetaAtPath(
  rootSchema: z.ZodType,
  path: Path,
  maxRecursionDepth: number
): ResolvedFieldMeta {
  const lastSegment = path.length === 0 ? '' : (path[path.length - 1] as string | number)
  const candidates =
    path.length === 0
      ? [rootSchema]
      : getNestedZodSchemasAtPath(rootSchema, path, maxRecursionDepth)
  const target = candidates[0]
  if (target === undefined) {
    return {
      label: humanize(lastSegment),
      description: undefined,
      placeholder: undefined,
      meta: Object.freeze({}),
    }
  }
  // Path-keyed payload map (built once per rootSchema) disambiguates
  // shared schemas. Falls back to the schema-keyed registry for paths
  // not visited by the walker (e.g. dynamic discriminated-union
  // sub-paths the walker can't statically enumerate).
  const pathMap = getPathMetaMap(rootSchema)
  const pathKey = canonicalizePath(path).key
  const peeled = peelAllWrappers(target)
  const payload =
    pathMap.get(pathKey) ??
    getFieldMeta(target) ??
    (peeled !== target ? getFieldMeta(peeled) : undefined)
  // `description` is exposed as a public property on Zod 4 schemas;
  // when set via `.describe('...')` or `.meta({ description })`, it
  // reads back as a string. Read from the target first; fall back to
  // the peeled inner so a `.describe()` on `z.string()` is still
  // visible when wrapped in `.optional()`.
  const targetDescription = readDescription(target)
  const peeledDescription = peeled !== target ? readDescription(peeled) : undefined
  const schemaDescription = targetDescription ?? peeledDescription
  return {
    label: payload?.label ?? humanize(lastSegment),
    description: payload?.description ?? schemaDescription ?? undefined,
    placeholder: payload?.placeholder ?? undefined,
    meta: Object.freeze({ ...(payload ?? {}) }),
  }
}

function readDescription(schema: z.ZodType): string | undefined {
  const candidate = (schema as z.ZodType & { description?: unknown }).description
  return typeof candidate === 'string' ? candidate : undefined
}

// Type-only re-export so downstream code can reference the Form shape.
export type { DeepPartial, GenericForm }
