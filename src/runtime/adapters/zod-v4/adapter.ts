import type { z } from 'zod'
import type {
  AbstractSchema,
  FormKey,
  SlimPrimitiveKind,
  UnionDiscriminatorContext,
  ValidationError,
  ValidationResponse,
} from '../../types/types-api'
import { CxErrorCode } from '../../core/error-codes'
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
  getDiscriminatedOptions,
  getDiscriminator,
  getIntersectionLeft,
  getIntersectionRight,
  getLiteralValues,
  getObjectShape,
  getUnionOptions,
  kindOf,
  unwrapInner,
  unwrapLazy,
  unwrapPipe,
} from './introspect'
import { getNestedZodSchemasAtPath } from './path-walker'
import { slimPrimitivesOf } from './slim-primitives'

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
 * `@chemical-x/forms/zod` does the wrapping automatically. Reach for
 * it when you need an adapter outside of `useForm` (e.g. validating
 * data with the same library used elsewhere in the form runtime, or
 * exposing the adapter to a custom integration).
 *
 * Throws if the schema isn't Zod v4, or contains kinds the adapter
 * cannot represent (`z.promise`, `z.custom`, `z.templateLiteral`,
 * recursive `z.lazy(...)`).
 */
export function zodV4Adapter<FormSchema extends z.ZodObject, Form extends z.infer<FormSchema>>(
  rootSchema: FormSchema
): (formKey: FormKey) => AbstractSchema<Form, Form> {
  assertZodVersion(rootSchema)
  // Fail fast at adapter construction if the schema uses kinds we can't
  // represent (z.promise / z.custom / z.templateLiteral) or a recursive
  // z.lazy(). Errors carry the dotted path to the offending node.
  assertSupportedKinds(rootSchema)

  return (formKey: FormKey): AbstractSchema<Form, Form> => {
    // Per-adapter `isLeafAtPath` cache. Lifetime = one adapter instance
    // (one per `useForm()` call). Memoises the slim-primitive walk so the
    // leaf-aware proxy traps don't re-walk the schema on every read.
    const leafCache = new Map<PathKey, boolean>()
    // Memoised one-shot walk; `hasAsyncRefines` is queried at construction
    // and possibly again from devtools, so a single tree traversal earns
    // its keep across the adapter's lifetime.
    let asyncRefineFlag: boolean | null = null

    return {
      fingerprint: () => fingerprintZodSchema(rootSchema),

      hasAsyncRefines(): boolean {
        asyncRefineFlag ??= containsAsyncRefine(rootSchema)
        return asyncRefineFlag
      },

      getDefaultValues(config): ReturnType<AbstractSchema<Form, Form>['getDefaultValues']> {
        const { data } = getDefaultValuesFromZodSchema<Form>({
          schema: rootSchema,
          useDefaultSchemaValues: config.useDefaultSchemaValues,
          constraints: config.constraints,
        })

        if (config.validationMode === 'strict') {
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
          } catch {
            // Async-refine throw — fall through to the lax-mode return.
            // The form mounts cleanly; the user can call `validateAsync()`
            // after mount to surface async-refinement errors.
            return { data, errors: undefined, success: true, formKey }
          }
        }

        // Lax mode: the validate-then-fix loop has done everything it can;
        // a partially-valid initial state is preferable to a mount-time
        // exception. Matches v3's lax semantics.
        return { data, errors: undefined, success: true, formKey }
      },

      getDefaultAtPath(path) {
        // For empty path, the "default at root" is the schema's full
        // default — return the deriveDefault of the root, not the slim-
        // schema validate-then-fix loop (that's getDefaultValues' job).
        if (path.length === 0) return deriveDefault(rootSchema, true)
        const [first] = getNestedZodSchemasAtPath(rootSchema, path)
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
        return deriveDefault(unwrapStructuralWrappers(first), true)
      },

      getSchemasAtPath(path) {
        const resolved = getNestedZodSchemasAtPath(rootSchema, path)
        return resolved.map(
          (schema) =>
            ({
              fingerprint: () => fingerprintZodSchema(schema),
              hasAsyncRefines: () => containsAsyncRefine(schema),
              getDefaultValues: () => ({
                data: deriveDefault(schema, true),
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
            }) as unknown as ReturnType<AbstractSchema<Form, Form>['getSchemasAtPath']>[number]
        )
      },

      getSlimPrimitiveTypesAtPath(path): Set<SlimPrimitiveKind> {
        // Resolve every leaf candidate at the path (unions return
        // multiple) and union their slim-primitive sets. Empty path
        // is the root form: always an object.
        if (path.length === 0) return new Set(['object'])
        const resolved = getNestedZodSchemasAtPath(rootSchema, path)
        // Path doesn't resolve in the schema → no kinds accepted.
        // The gate's membership check rejects every kind against an
        // empty set, blocking writes to typo / unknown paths.
        if (resolved.length === 0) return new Set()
        const out = new Set<SlimPrimitiveKind>()
        for (const candidate of resolved) {
          for (const k of slimPrimitivesOf(candidate)) out.add(k)
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
        const resolved = getNestedZodSchemasAtPath(rootSchema, path)
        if (resolved.length === 0) return false
        // Every candidate must be required for the path overall to be
        // required — matches the union "any-branch-permissive" rule
        // when the path traverses a union.
        return resolved.every((candidate) => isLeafRequired(candidate))
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
            : getNestedZodSchemasAtPath(rootSchema, path)
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
        return {
          discriminatorKey: discKey,
          getVariantDefault(value: unknown): unknown {
            for (const opt of options) {
              const shape = getObjectShape(opt)
              const litSchema = shape[discKey]
              if (litSchema === undefined) continue
              if (kindOf(litSchema) !== 'literal') continue
              const literalValues = getLiteralValues(litSchema)
              if (literalValues.includes(value)) return deriveDefault(opt, true)
            }
            return undefined
          },
        }
      },

      validateAtPath(
        data,
        path,
        options
      ): ReturnType<AbstractSchema<Form, Form>['validateAtPath']> {
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

        function runSync(): ValidationResponse<Form> {
          if (path === undefined) {
            const result = rootSchema.safeParse(data) as z.ZodSafeParseResult<Form>
            return result.success
              ? { data: result.data, errors: undefined, success: true, formKey }
              : {
                  data: undefined,
                  errors: zodIssuesToValidationErrors(result.error.issues, formKey),
                  success: false,
                  formKey,
                }
          }
          const resolved = getNestedZodSchemasAtPath(rootSchema, path)
          if (resolved.length === 0) return pathNotFound(path)
          const aggregated: ValidationError[] = []
          for (const candidate of resolved) {
            const result = candidate.safeParse(data)
            if (result.success) {
              return { data: result.data as Form, errors: undefined, success: true, formKey }
            }
            aggregated.push(...zodIssuesToValidationErrors(result.error.issues, formKey))
          }
          return { data: undefined, errors: aggregated, success: false, formKey }
        }

        async function runAsync(): Promise<ValidationResponse<Form>> {
          if (path === undefined) {
            const result = (await rootSchema.safeParseAsync(data)) as z.ZodSafeParseResult<Form>
            return result.success
              ? { data: result.data, errors: undefined, success: true, formKey }
              : {
                  data: undefined,
                  errors: zodIssuesToValidationErrors(result.error.issues, formKey),
                  success: false,
                  formKey,
                }
          }
          const resolved = getNestedZodSchemasAtPath(rootSchema, path)
          if (resolved.length === 0) return pathNotFound(path)
          // Sequential await — parallel parses would run every
          // branch's async side effects on a value only one branch
          // should see.
          const aggregated: ValidationError[] = []
          for (const candidate of resolved) {
            const result = await candidate.safeParseAsync(data)
            if (result.success) {
              return { data: result.data as Form, errors: undefined, success: true, formKey }
            }
            aggregated.push(...zodIssuesToValidationErrors(result.error.issues, formKey))
          }
          return { data: undefined, errors: aggregated, success: false, formKey }
        }

        function pathNotFound(p: Path): ValidationResponse<Form> {
          return {
            data: undefined,
            errors: [
              {
                message: `Path '${p.join(PATH_SEPARATOR)}' did not resolve to any schema`,
                path: [...p],
                formKey,
                code: CxErrorCode.PathNotFound,
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

// Type-only re-export so downstream code can reference the Form shape.
export type { DeepPartial, GenericForm }
