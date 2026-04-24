import type { z } from 'zod-v3'

/**
 * Compute a structural fingerprint for a Zod v3 schema.
 *
 * Same contract as the v4 counterpart — deterministic across
 * reference-distinct but structurally-equal schemas, key-order-
 * insensitive for `z.object` shapes, membership-order-insensitive
 * for `z.union` options, idempotent across calls. See
 * `src/runtime/adapters/zod-v4/fingerprint.ts` for the full
 * rationale and the list of compromises (function-valued
 * refinements / transforms / non-deterministic default factories
 * collapse to opaque `fn:*` sentinels).
 *
 * Caching is per-call, not module-global: cycles mean a cached
 * mid-traversal result from one call is invalid for another
 * (the `<cyclic>` sentinel's meaning depends on the starting
 * node). A WeakSet guards against cycles introduced by `z.lazy`.
 */

type V3Schema = z.ZodTypeAny

interface V3Def {
  readonly typeName?: string
  readonly shape?: () => Record<string, V3Schema>
  readonly type?: V3Schema
  readonly keyType?: V3Schema
  readonly valueType?: V3Schema
  readonly items?: readonly V3Schema[]
  readonly options?: readonly V3Schema[]
  readonly discriminator?: string
  readonly values?: readonly unknown[]
  readonly value?: unknown
  readonly innerType?: V3Schema
  readonly defaultValue?: () => unknown
  readonly checks?: readonly unknown[]
  readonly schema?: V3Schema
  readonly effect?: { readonly type?: string }
  readonly getter?: () => V3Schema
  readonly left?: V3Schema
  readonly right?: V3Schema
  readonly catchValue?: () => unknown
}

const cyclicSentinel = '<cyclic>'

export function fingerprintZodSchema(schema: V3Schema): string {
  const cache = new WeakMap<object, string>()
  const inProgress = new WeakSet<object>()
  return visit(schema, cache, inProgress)
}

function visit(
  schema: V3Schema,
  cache: WeakMap<object, string>,
  inProgress: WeakSet<object>
): string {
  const key = schema as unknown as object
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  if (inProgress.has(key)) return cyclicSentinel
  inProgress.add(key)
  try {
    const computed = computeFingerprint(schema, cache, inProgress)
    cache.set(key, computed)
    return computed
  } finally {
    inProgress.delete(key)
  }
}

function getDef(schema: V3Schema): V3Def {
  return (schema as unknown as { _def: V3Def })._def
}

function computeFingerprint(
  schema: V3Schema,
  cache: WeakMap<object, string>,
  inProgress: WeakSet<object>
): string {
  const def = getDef(schema)
  const kind = def.typeName ?? 'ZodUnknown'
  const recurse = (child: V3Schema): string => visit(child, cache, inProgress)

  switch (kind) {
    case 'ZodString':
    case 'ZodNumber':
    case 'ZodBigInt':
    case 'ZodDate':
      return `${kind}${formatChecks(def.checks)}`

    case 'ZodBoolean':
    case 'ZodNull':
    case 'ZodUndefined':
    case 'ZodAny':
    case 'ZodUnknown':
    case 'ZodNaN':
    case 'ZodVoid':
    case 'ZodNever':
      return kind

    case 'ZodLiteral':
      return `ZodLiteral:${canonicalStringify(def.value)}`

    case 'ZodEnum':
    case 'ZodNativeEnum': {
      const values = (def.values ?? []) as readonly unknown[]
      const sorted = [...values].sort((a, b) => {
        const as = String(a)
        const bs = String(b)
        return as < bs ? -1 : as > bs ? 1 : 0
      })
      return `${kind}:${canonicalStringify(sorted)}`
    }

    case 'ZodObject': {
      const shape = readShapeSafely(def)
      const sortedEntries = Object.entries(shape)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${recurse(v)}`)
      return `ZodObject{${sortedEntries.join(',')}}`
    }

    case 'ZodArray':
      return `ZodArray[${def.type === undefined ? '?' : recurse(def.type)}]${formatChecks(def.checks)}`

    case 'ZodTuple': {
      const items = def.items ?? []
      return `ZodTuple[${items.map(recurse).join(',')}]`
    }

    case 'ZodRecord': {
      const keyPart = def.keyType === undefined ? '?' : recurse(def.keyType)
      const valuePart = def.valueType === undefined ? '?' : recurse(def.valueType)
      return `ZodRecord<${keyPart},${valuePart}>`
    }

    case 'ZodUnion': {
      const options = (def.options ?? []).map(recurse).sort()
      return `ZodUnion(${options.join('|')})`
    }

    case 'ZodDiscriminatedUnion': {
      const disc = def.discriminator ?? '?'
      const options = (def.options ?? []).map(recurse).sort()
      return `ZodDiscriminatedUnion[${JSON.stringify(disc)}](${options.join('|')})`
    }

    case 'ZodOptional': {
      const inner = def.innerType
      return inner === undefined ? 'ZodOptional(?)' : `ZodOptional(${recurse(inner)})`
    }

    case 'ZodNullable': {
      const inner = def.innerType
      return inner === undefined ? 'ZodNullable(?)' : `ZodNullable(${recurse(inner)})`
    }

    case 'ZodDefault': {
      const inner = def.innerType
      // v3 stores defaults as a factory: `defaultValue: () => X`.
      // Call it twice and compare with Object.is — non-deterministic
      // factories (`() => new Date()`) return distinct objects each
      // call, so we collapse to `fn:*` to stay idempotent. Pure
      // factories that return the same primitive / cached reference
      // serialise normally.
      return `ZodDefault[${defaultFactoryRepr(def.defaultValue)}](${
        inner === undefined ? '?' : recurse(inner)
      })`
    }

    case 'ZodReadonly': {
      const inner = def.innerType
      return inner === undefined ? 'ZodReadonly(?)' : `ZodReadonly(${recurse(inner)})`
    }

    case 'ZodEffects': {
      // `.refine` / `.transform` / `.preprocess` — the effect function
      // isn't stably hashable. We can distinguish effect kinds (refine
      // vs transform) via `def.effect.type` and fold that into the
      // fingerprint, but the function body collapses to an opaque
      // sentinel.
      const effectType = def.effect?.type ?? 'effect'
      const inner = def.schema
      return `ZodEffects:${effectType}:fn:*(${inner === undefined ? '?' : recurse(inner)})`
    }

    case 'ZodPipeline': {
      // Internally `z.pipe(a, b)` — `.in` and `.out` live on the def.
      const inner = def.schema
      return inner === undefined ? 'ZodPipeline(?)' : `ZodPipeline(${recurse(inner)})`
    }

    case 'ZodCatch': {
      const inner = def.innerType ?? def.schema
      const catchRepr = defaultFactoryRepr(def.catchValue)
      return `ZodCatch[${catchRepr}](${inner === undefined ? '?' : recurse(inner)})`
    }

    case 'ZodLazy': {
      const resolve = def.getter
      if (typeof resolve !== 'function') return 'ZodLazy(?)'
      try {
        const inner = resolve()
        return `ZodLazy(${recurse(inner)})`
      } catch {
        return 'ZodLazy(?)'
      }
    }

    case 'ZodIntersection': {
      const leftPart = def.left === undefined ? '?' : recurse(def.left)
      const rightPart = def.right === undefined ? '?' : recurse(def.right)
      const parts = [leftPart, rightPart].sort()
      return `ZodIntersection(${parts.join('&')})`
    }

    // Structural opacity — schemas whose runtime behaviour isn't
    // introspectable via `_def` fall here. Still distinguishable
    // from other kinds by the returned string.
    case 'ZodPromise':
    case 'ZodFunction':
    case 'ZodMap':
    case 'ZodSet':
    case 'ZodSymbol':
    case 'ZodBranded':
    default:
      return `${kind}:*`
  }
}

function readShapeSafely(def: V3Def): Record<string, V3Schema> {
  if (typeof def.shape !== 'function') return {}
  try {
    return def.shape()
  } catch {
    return {}
  }
}

/**
 * Render a v3 default / catch factory. Called twice; if the two
 * results differ (by `Object.is`), the factory is non-deterministic
 * and we collapse to `fn:*` to preserve idempotence. Same fix as
 * v4's `defaultValueRepr` — factories like `() => new Date()` would
 * otherwise make the fingerprint time-dependent.
 */
function defaultFactoryRepr(factory: (() => unknown) | undefined): string {
  if (typeof factory !== 'function') return 'none'
  let first: unknown
  let second: unknown
  try {
    first = factory()
    second = factory()
  } catch {
    return 'fn:*'
  }
  if (!Object.is(first, second)) return 'fn:*'
  if (typeof first === 'function') return 'fn:*'
  return canonicalStringify(first)
}

function formatChecks(checks: readonly unknown[] | undefined): string {
  if (!Array.isArray(checks) || checks.length === 0) return ''
  const parts = checks.map((c) => canonicalStringify(c)).sort()
  return `[${parts.join(';')}]`
}

function canonicalStringify(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  const t = typeof value
  if (t === 'string') return JSON.stringify(value)
  if (t === 'number' || t === 'boolean') return String(value)
  if (t === 'bigint') return `${String(value)}n`
  if (t === 'function') return 'fn:*'
  if (t === 'symbol') return 'symbol:*'
  if (Array.isArray(value)) {
    if (seen.has(value)) return '<cyclic>'
    seen.add(value)
    try {
      return `[${value.map((v) => canonicalStringify(v, seen)).join(',')}]`
    } finally {
      // Add/delete ancestor-stack pattern. Without `delete`, two
      // sibling properties pointing at the same object get the
      // second one falsely labelled `<cyclic>`.
      seen.delete(value)
    }
  }
  if (t === 'object') {
    // `null` already returned above; `object` here is guaranteed
    // non-null. Narrowing against null again is flagged by eslint's
    // no-unnecessary-condition rule.
    const obj = value as Record<string, unknown>
    if (seen.has(obj)) return '<cyclic>'
    seen.add(obj)
    try {
      if (value instanceof Date) return `date:${value.getTime()}`
      if (value instanceof RegExp) return `regex:${String(value)}`
      const entries = Object.entries(obj)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v, seen)}`)
      return `{${entries.join(',')}}`
    } finally {
      seen.delete(obj)
    }
  }
  return 'unknown'
}
