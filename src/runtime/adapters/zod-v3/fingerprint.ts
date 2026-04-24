import type { z } from 'zod-v3'

/**
 * Compute a structural fingerprint for a Zod v3 schema.
 *
 * Same contract as the v4 counterpart — deterministic across
 * reference-distinct but structurally-equal schemas, key-order-
 * insensitive for `z.object` shapes, membership-order-insensitive
 * for `z.union` options. See
 * `src/runtime/adapters/zod-v4/fingerprint.ts` for the full rationale
 * and the list of compromises (function-valued refinements /
 * transforms / lazy defaults collapse to opaque sentinels).
 *
 * Results are WeakMap-cached per schema reference, so repeat calls
 * are O(1). A WeakSet guards against cycles introduced by `z.lazy`.
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

const fingerprintCache = new WeakMap<object, string>()
const cyclicSentinel = '<cyclic>'

export function fingerprintZodSchema(schema: V3Schema): string {
  const inProgress = new WeakSet<object>()
  return visit(schema, inProgress)
}

function visit(schema: V3Schema, inProgress: WeakSet<object>): string {
  const cached = fingerprintCache.get(schema as unknown as object)
  if (cached !== undefined) return cached
  if (inProgress.has(schema as unknown as object)) return cyclicSentinel
  inProgress.add(schema as unknown as object)
  try {
    const computed = computeFingerprint(schema, inProgress)
    fingerprintCache.set(schema as unknown as object, computed)
    return computed
  } finally {
    inProgress.delete(schema as unknown as object)
  }
}

function getDef(schema: V3Schema): V3Def {
  return (schema as unknown as { _def: V3Def })._def
}

function computeFingerprint(schema: V3Schema, inProgress: WeakSet<object>): string {
  const def = getDef(schema)
  const kind = def.typeName ?? 'ZodUnknown'

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
      const shape = typeof def.shape === 'function' ? def.shape() : {}
      const sortedEntries = Object.entries(shape)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${visit(v, inProgress)}`)
      return `ZodObject{${sortedEntries.join(',')}}`
    }

    case 'ZodArray':
      return `ZodArray[${def.type === undefined ? '?' : visit(def.type, inProgress)}]${formatChecks(def.checks)}`

    case 'ZodTuple': {
      const items = def.items ?? []
      return `ZodTuple[${items.map((item) => visit(item, inProgress)).join(',')}]`
    }

    case 'ZodRecord': {
      const keyPart = def.keyType === undefined ? '?' : visit(def.keyType, inProgress)
      const valuePart = def.valueType === undefined ? '?' : visit(def.valueType, inProgress)
      return `ZodRecord<${keyPart},${valuePart}>`
    }

    case 'ZodUnion': {
      const options = (def.options ?? []).map((opt) => visit(opt, inProgress)).sort()
      return `ZodUnion(${options.join('|')})`
    }

    case 'ZodDiscriminatedUnion': {
      const disc = def.discriminator ?? '?'
      const options = (def.options ?? []).map((opt) => visit(opt, inProgress)).sort()
      return `ZodDiscriminatedUnion[${JSON.stringify(disc)}](${options.join('|')})`
    }

    case 'ZodOptional': {
      const inner = def.innerType
      return `ZodOptional(${inner === undefined ? '?' : visit(inner, inProgress)})`
    }

    case 'ZodNullable': {
      const inner = def.innerType
      return `ZodNullable(${inner === undefined ? '?' : visit(inner, inProgress)})`
    }

    case 'ZodDefault': {
      const inner = def.innerType
      // v3 always wraps the default in a function (`defaultValue: () => X`).
      // Call it to introspect the materialised value, but guard in case
      // that throws or returns a function itself.
      let defRepr = 'fn:*'
      if (typeof def.defaultValue === 'function') {
        try {
          const resolved = def.defaultValue()
          defRepr = typeof resolved === 'function' ? 'fn:*' : canonicalStringify(resolved)
        } catch {
          defRepr = 'fn:*'
        }
      }
      return `ZodDefault[${defRepr}](${inner === undefined ? '?' : visit(inner, inProgress)})`
    }

    case 'ZodReadonly': {
      const inner = def.innerType
      return `ZodReadonly(${inner === undefined ? '?' : visit(inner, inProgress)})`
    }

    case 'ZodEffects': {
      // `.refine` / `.transform` / `.preprocess` — the effect function
      // isn't stably hashable. We can distinguish effect kinds (refine
      // vs transform) via `def.effect.type` and fold that into the
      // fingerprint, but the function body collapses to an opaque
      // sentinel.
      const effectType = def.effect?.type ?? 'effect'
      const inner = def.schema
      return `ZodEffects:${effectType}:fn:*(${inner === undefined ? '?' : visit(inner, inProgress)})`
    }

    case 'ZodPipeline': {
      // Internally `z.pipe(a, b)` — `.in` and `.out` live on the def.
      const inner = def.schema
      return `ZodPipeline(${inner === undefined ? '?' : visit(inner, inProgress)})`
    }

    case 'ZodCatch': {
      const inner = def.innerType ?? def.schema
      const catchVal = typeof def.catchValue === 'function' ? 'fn:*' : 'none'
      return `ZodCatch[${catchVal}](${inner === undefined ? '?' : visit(inner, inProgress)})`
    }

    case 'ZodLazy': {
      const resolve = def.getter
      if (typeof resolve !== 'function') return 'ZodLazy(?)'
      try {
        const inner = resolve()
        return `ZodLazy(${visit(inner, inProgress)})`
      } catch {
        return 'ZodLazy(?)'
      }
    }

    case 'ZodIntersection': {
      const leftPart = def.left === undefined ? '?' : visit(def.left, inProgress)
      const rightPart = def.right === undefined ? '?' : visit(def.right, inProgress)
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
    return `[${value.map((v) => canonicalStringify(v, seen)).join(',')}]`
  }
  if (t === 'object') {
    // `null` already returned above; `object` here is guaranteed
    // non-null. Narrowing against null again is flagged by eslint's
    // no-unnecessary-condition rule.
    const obj = value as Record<string, unknown>
    if (seen.has(obj)) return '<cyclic>'
    seen.add(obj)
    if (value instanceof Date) return `date:${value.getTime()}`
    if (value instanceof RegExp) return `regex:${String(value)}`
    const entries = Object.entries(obj)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v, seen)}`)
    return `{${entries.join(',')}}`
  }
  return 'unknown'
}
