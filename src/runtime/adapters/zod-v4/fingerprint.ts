import type { z } from 'zod'
import {
  getArrayElement,
  getCatchDefault,
  getChecks,
  getDefaultValue,
  getDiscriminatedOptions,
  getDiscriminator,
  getEnumValues,
  getIntersectionLeft,
  getIntersectionRight,
  getLiteralValues,
  getObjectShape,
  getRecordKeyType,
  getRecordValueType,
  getTupleItems,
  getUnionOptions,
  kindOf,
  unwrapInner,
  unwrapLazy,
  unwrapPipe,
} from './introspect'

/**
 * Compute a structural fingerprint for a Zod v4 schema.
 *
 * The returned string is:
 * - **Deterministic** for any pair of schemas with the same shape,
 *   regardless of whether they were constructed by the same
 *   `z.object({...})` call or two identical ones in different files.
 * - **Key-order-insensitive** for `z.object` — shape entries are
 *   sorted before serialisation, so `{a, b}` and `{b, a}` produce
 *   the same fingerprint.
 * - **Order-insensitive for `z.union`** — option fingerprints are
 *   sorted before they're folded in, because union membership has
 *   no semantic order.
 * - **Idempotent** — two fingerprint calls on the same schema
 *   reference return identical strings, even when the schema
 *   contains non-deterministic metadata (e.g. `.default(() => new
 *   Date())`). Factories of any kind collapse to an opaque
 *   `fn:*` sentinel for this reason (see `defaultValueRepr`).
 *
 * **Known false negatives** — situations where two semantically
 * different schemas hash the same:
 * - `.refine(fn1)` and `.refine(fn2)`: function bodies aren't
 *   hashable in a way that survives minification / different closure
 *   captures, so every refinement collapses via the generic `fn:*`
 *   sentinel. The warning this powers is a best-effort footgun
 *   catcher, not a soundness guarantee — two forms whose only
 *   difference is refinement logic will look identical here.
 * - `.transform(fn)`: same reason.
 * - `.default(() => x)` where the factory is non-deterministic:
 *   collapses to `fn:*` (idempotence requirement — we can't hash a
 *   fresh Date on every call).
 * - `z.custom()` — no structural information to introspect; renders
 *   as `custom:*`.
 *
 * **Caching is per-call, not module-global.** A WeakMap cache
 * scoped to the starting schema would break correctness under
 * cycles: the `<cyclic>` sentinel's meaning is relative to the
 * call's starting node, so a cached mid-traversal result from one
 * call is wrong for a different call. Cheapest correct design is
 * "fresh cache per top-level call." A 50-field nested schema
 * fingerprints in microseconds, and the library calls `fingerprint`
 * at most twice per shared-key collision (existing + incoming) —
 * not a hot path.
 */

const cyclicSentinel = '<cyclic>'

export function fingerprintZodSchema(schema: z.ZodType): string {
  const cache = new WeakMap<z.ZodType, string>()
  const inProgress = new WeakSet<z.ZodType>()
  return visit(schema, cache, inProgress)
}

function visit(
  schema: z.ZodType,
  cache: WeakMap<z.ZodType, string>,
  inProgress: WeakSet<z.ZodType>
): string {
  const cached = cache.get(schema)
  if (cached !== undefined) return cached
  if (inProgress.has(schema)) return cyclicSentinel
  inProgress.add(schema)
  try {
    const computed = computeFingerprint(schema, cache, inProgress)
    cache.set(schema, computed)
    return computed
  } finally {
    inProgress.delete(schema)
  }
}

function computeFingerprint(
  schema: z.ZodType,
  cache: WeakMap<z.ZodType, string>,
  inProgress: WeakSet<z.ZodType>
): string {
  const kind = kindOf(schema)
  const recurse = (child: z.ZodType): string => visit(child, cache, inProgress)
  switch (kind) {
    // Kind-only leaves: no further structure to descend into.
    case 'boolean':
    case 'null':
    case 'undefined':
    case 'any':
    case 'unknown':
    case 'nan':
    case 'void':
    case 'never':
      return kind

    // Leaves with checks (min/max/email/regex/...). Checks are
    // canonicalised and sorted so `.min(3).max(10)` and `.max(10).min(3)`
    // produce identical fingerprints.
    case 'string':
    case 'number':
    case 'bigint':
    case 'date':
      return `${kind}${formatChecks(schema)}`

    case 'literal': {
      // `z.literal(['a', 'b'])` accepts either — the value set has
      // no semantic order, so canonical-sort before hashing so
      // `['a','b']` and `['b','a']` match. `z.literal` accepts
      // string / number / boolean / null / undefined / bigint /
      // symbol — sort by canonicalised string form to get a total
      // order across those types.
      const values = [...getLiteralValues(schema)].sort((a, b) => {
        const as = canonicalStringify(a)
        const bs = canonicalStringify(b)
        return as < bs ? -1 : as > bs ? 1 : 0
      })
      return `literal:${canonicalStringify(values)}`
    }

    case 'enum':
      // Enum values have no semantic order — sort before folding.
      return `enum:${canonicalStringify([...getEnumValues(schema)].sort((a, b) => compare(a, b)))}`

    case 'object': {
      const shape = getObjectShape(schema as z.ZodObject)
      const sortedEntries = Object.entries(shape)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${recurse(v)}`)
      return `object{${sortedEntries.join(',')}}${formatChecks(schema)}`
    }

    case 'array':
      return `array[${recurse(getArrayElement(schema as z.ZodArray))}]${formatChecks(schema)}`

    case 'tuple':
      return `tuple[${getTupleItems(schema).map(recurse).join(',')}]`

    case 'record':
      return `record<${recurse(getRecordKeyType(schema))},${recurse(getRecordValueType(schema))}>`

    case 'union': {
      // Union membership has no order; sort option fingerprints.
      const options = getUnionOptions(schema).map(recurse).sort()
      return `union(${options.join('|')})`
    }

    case 'discriminated-union': {
      const disc = getDiscriminator(schema) ?? '?'
      const options = getDiscriminatedOptions(schema).map(recurse).sort()
      return `dunion[${JSON.stringify(disc)}](${options.join('|')})`
    }

    case 'optional': {
      const inner = unwrapInner(schema)
      return inner === undefined ? 'optional(?)' : `optional(${recurse(inner)})`
    }

    case 'nullable': {
      const inner = unwrapInner(schema)
      return inner === undefined ? 'nullable(?)' : `nullable(${recurse(inner)})`
    }

    case 'default': {
      const inner = unwrapInner(schema)
      return `default[${stableValueRepr(getDefaultValue, schema)}](${inner === undefined ? '?' : recurse(inner)})`
    }

    case 'readonly': {
      const inner = unwrapInner(schema)
      return inner === undefined ? 'readonly(?)' : `readonly(${recurse(inner)})`
    }

    case 'pipe': {
      const inner = unwrapPipe(schema)
      return inner === undefined ? 'pipe(?)' : `pipe(${recurse(inner)})`
    }

    case 'catch': {
      const inner = unwrapInner(schema)
      return `catch[${stableValueRepr(getCatchDefault, schema)}](${inner === undefined ? '?' : recurse(inner)})`
    }

    case 'lazy': {
      // `z.lazy(() => other)` — fingerprint the dereferenced inner.
      // The `inProgress` WeakSet catches real cycles (a schema that
      // references itself through lazy) and returns `cyclicSentinel`
      // for any recursive encounter.
      const inner = unwrapLazy(schema)
      return inner === undefined ? 'lazy(?)' : `lazy(${recurse(inner)})`
    }

    case 'intersection': {
      const left = getIntersectionLeft(schema)
      const right = getIntersectionRight(schema)
      const leftFp = left === undefined ? '?' : recurse(left as z.ZodType)
      const rightFp = right === undefined ? '?' : recurse(right as z.ZodType)
      // Intersection members have no semantic order; sort both legs.
      const parts = [leftFp, rightFp].sort()
      return `intersection(${parts.join('&')})`
    }

    // Structural shape isn't observable for these. Bucket them into
    // kind-only fingerprints — a schema-mismatch warning can't do
    // better than "both are `custom`" here, but that still catches
    // `object` vs `custom` mismatches.
    case 'promise':
    case 'custom':
    case 'template-literal':
      return `${kind}:*`

    default: {
      // Exhaustiveness guard — if ZodKind grows a new variant we'll
      // fall through here and get a typecheck-visible warning via
      // the unreachable assignment.
      const _: never = kind
      return `unknown:${String(_)}`
    }
  }
}

/**
 * Render a default/catch value for the fingerprint. Detects
 * non-deterministic factories (`.default(() => new Date())`) by
 * reading the value twice and comparing — zod v4's getter invokes
 * the factory fresh on each access, so two consecutive reads of a
 * factory-backed default produce distinct objects for any
 * heap-allocated return type. Object.is matches for primitive
 * returns (even from factories) and for literal defaults; in both
 * cases we emit the canonical representation. Without this the
 * fingerprint is non-idempotent for schemas like
 * `.default(() => new Date())`.
 */
function stableValueRepr(get: (s: z.ZodType) => unknown, schema: z.ZodType): string {
  const first = get(schema)
  const second = get(schema)
  if (!Object.is(first, second) || typeof first === 'function') return 'fn:*'
  return canonicalStringify(first)
}

/**
 * Serialise a check array to a stable string. Checks are sorted by
 * their canonical form so order-of-chain doesn't matter — the zod
 * runtime already collapses `.min(3).max(10)` and `.max(10).min(3)`
 * to the same behaviour, and the fingerprint should match.
 */
function formatChecks(schema: z.ZodType): string {
  const checks = getChecks(schema)
  if (checks.length === 0) return ''
  const parts = checks.map((c) => serializeCheck(c)).sort()
  return `[${parts.join(';')}]`
}

/**
 * Zod v4 checks are instances of `$ZodCheck` — their state lives on
 * `_zod.def` (kind discriminator + kind-specific args), not on the
 * object's own enumerable properties. A plain `Object.entries`
 * serialise would see an empty object and collapse every check to
 * the same fingerprint — `.min(3)` and `.min(8)` would look
 * identical. Reach into `_zod.def` when it's present; fall back to
 * generic canonicalisation for anything that isn't shaped like a
 * v4 check (custom adapters may pass their own shapes here).
 */
function serializeCheck(check: unknown): string {
  if (check !== null && typeof check === 'object') {
    const def = (check as { _zod?: { def?: unknown } })._zod?.def
    if (def !== undefined) return canonicalStringify(def)
  }
  return canonicalStringify(check)
}

/**
 * Canonical stringify for arbitrary values. Sorts object keys, walks
 * arrays in index order, represents functions / symbols / cycles as
 * opaque sentinels. NOT JSON — the output is not meant to round-trip
 * via JSON.parse; it's a canonical surface for equality-testing.
 *
 * Cycle detection uses an "ancestor stack" add/delete pattern: a
 * reference is only considered cyclic if it's currently on the
 * path from the root being stringified. Without `delete` on pop,
 * two sibling properties pointing at the same object would have
 * the second labelled `<cyclic>` (false positive) even though the
 * reference isn't actually an ancestor.
 */
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
      const parts = value.map((v) => canonicalStringify(v, seen))
      return `[${parts.join(',')}]`
    } finally {
      seen.delete(value)
    }
  }
  if (t === 'object') {
    // `null` already returned above; the remaining `object` branch is
    // non-null, so narrowing against it is redundant (eslint's
    // no-unnecessary-condition rule flags the prior guard).
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

/** Strict-mode sort comparator that handles mixed string/number enums. */
function compare(a: string | number, b: string | number): number {
  const as = String(a)
  const bs = String(b)
  return as < bs ? -1 : as > bs ? 1 : 0
}
