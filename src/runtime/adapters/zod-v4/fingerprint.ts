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
 *
 * **Known false negatives** — situations where two semantically
 * different schemas hash the same:
 * - `.refine(fn1)` and `.refine(fn2)`: function bodies aren't
 *   hashable in a way that survives minification / different closure
 *   captures, so every refinement collapses to an opaque `refine:*`
 *   sentinel. The warning this powers is a best-effort footgun
 *   catcher, not a soundness guarantee — two forms whose only
 *   difference is refinement logic will look identical here.
 * - `.transform(fn)` / `.default(() => x)`: same reason. Factories
 *   and transforms become `fn:*`.
 * - `z.custom()` — no structural information to introspect; renders
 *   as `custom:*`.
 *
 * Results are WeakMap-cached per schema reference, so a fresh call on
 * an already-fingerprinted schema is O(1).
 */
const fingerprintCache = new WeakMap<z.ZodType, string>()
const cyclicSentinel = '<cyclic>'

export function fingerprintZodSchema(schema: z.ZodType): string {
  const inProgress = new WeakSet<z.ZodType>()
  return visit(schema, inProgress)
}

function visit(schema: z.ZodType, inProgress: WeakSet<z.ZodType>): string {
  const cached = fingerprintCache.get(schema)
  if (cached !== undefined) return cached
  if (inProgress.has(schema)) return cyclicSentinel
  inProgress.add(schema)
  try {
    const computed = computeFingerprint(schema, inProgress)
    fingerprintCache.set(schema, computed)
    return computed
  } finally {
    inProgress.delete(schema)
  }
}

function computeFingerprint(schema: z.ZodType, inProgress: WeakSet<z.ZodType>): string {
  const kind = kindOf(schema)
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

    case 'literal':
      return `literal:${canonicalStringify(getLiteralValues(schema))}`

    case 'enum':
      // Enum values have no semantic order — sort before folding.
      return `enum:${canonicalStringify([...getEnumValues(schema)].sort((a, b) => compare(a, b)))}`

    case 'object': {
      const shape = getObjectShape(schema as z.ZodObject)
      const sortedEntries = Object.entries(shape)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${visit(v, inProgress)}`)
      return `object{${sortedEntries.join(',')}}${formatChecks(schema)}`
    }

    case 'array':
      return `array[${visit(getArrayElement(schema as z.ZodArray), inProgress)}]${formatChecks(schema)}`

    case 'tuple':
      return `tuple[${getTupleItems(schema)
        .map((item) => visit(item, inProgress))
        .join(',')}]`

    case 'record':
      return `record<${visit(getRecordKeyType(schema), inProgress)},${visit(
        getRecordValueType(schema),
        inProgress
      )}>`

    case 'union': {
      // Union membership has no order; sort option fingerprints.
      const options = getUnionOptions(schema)
        .map((opt) => visit(opt, inProgress))
        .sort()
      return `union(${options.join('|')})`
    }

    case 'discriminated-union': {
      const disc = getDiscriminator(schema) ?? '?'
      const options = getDiscriminatedOptions(schema)
        .map((opt) => visit(opt, inProgress))
        .sort()
      return `dunion[${JSON.stringify(disc)}](${options.join('|')})`
    }

    case 'optional': {
      const inner = unwrapInner(schema) ?? schema
      return inner === schema ? 'optional(?)' : `optional(${visit(inner, inProgress)})`
    }

    case 'nullable': {
      const inner = unwrapInner(schema) ?? schema
      return inner === schema ? 'nullable(?)' : `nullable(${visit(inner, inProgress)})`
    }

    case 'default': {
      const inner = unwrapInner(schema) ?? schema
      const def = getDefaultValue(schema)
      // Factories (lazy defaults via `.default(() => ...)`) collapse
      // to an opaque sentinel — the function identity isn't reliable
      // across module / closure boundaries.
      const defRepr = typeof def === 'function' ? 'fn:*' : canonicalStringify(def)
      return `default[${defRepr}](${inner === schema ? '?' : visit(inner, inProgress)})`
    }

    case 'readonly': {
      const inner = unwrapInner(schema) ?? schema
      return `readonly(${inner === schema ? '?' : visit(inner, inProgress)})`
    }

    case 'pipe': {
      const inner = unwrapPipe(schema) ?? schema
      return `pipe(${inner === schema ? '?' : visit(inner, inProgress)})`
    }

    case 'catch': {
      const inner = unwrapInner(schema) ?? schema
      const catchVal = getCatchDefault(schema)
      const catchRepr = typeof catchVal === 'function' ? 'fn:*' : canonicalStringify(catchVal)
      return `catch[${catchRepr}](${inner === schema ? '?' : visit(inner, inProgress)})`
    }

    case 'lazy': {
      // `z.lazy(() => other)` — fingerprint the dereferenced inner.
      // The `inProgress` WeakSet catches real cycles (a schema that
      // references itself through lazy) and returns `cyclicSentinel`
      // for any recursive encounter.
      const inner = unwrapLazy(schema)
      return inner === undefined ? 'lazy(?)' : `lazy(${visit(inner, inProgress)})`
    }

    case 'intersection': {
      const left = getIntersectionLeft(schema)
      const right = getIntersectionRight(schema)
      const leftFp = left === undefined ? '?' : visit(left as z.ZodType, inProgress)
      const rightFp = right === undefined ? '?' : visit(right as z.ZodType, inProgress)
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
    const parts = value.map((v) => canonicalStringify(v, seen))
    return `[${parts.join(',')}]`
  }
  if (t === 'object') {
    // `null` already returned above; the remaining `object` branch is
    // non-null, so narrowing against it is redundant (eslint's
    // no-unnecessary-condition rule flags the prior guard).
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

/** Strict-mode sort comparator that handles mixed string/number enums. */
function compare(a: string | number, b: string | number): number {
  const as = String(a)
  const bs = String(b)
  return as < bs ? -1 : as > bs ? 1 : 0
}
