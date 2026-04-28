/**
 * Slim-primitive write gate.
 *
 * Walks a value tree from a write path, validating that each leaf's
 * primitive type matches the schema's slim primitive set at the
 * corresponding sub-path. Used by `setValueAtPath` to reject writes
 * whose primitive shape can't possibly satisfy the slim schema —
 * regardless of refinement-level conformance.
 *
 * Refinement-level constraints (`.email()`, `.min(N)`, enum
 * membership, literal equality) are NOT enforced here; they're a
 * validation-time concern. This gate exists purely to keep the
 * runtime store's primitive shape honest.
 */
import type { AbstractSchema, SlimPrimitiveKind } from '../types/types-api'
import type { Path, Segment } from './paths'
import { isPlainRecord } from './path-walker'
import { __DEV__ } from './dev'

/**
 * Per-store one-shot dev-warn dedupe. Keyed by (FormStore identity,
 * dotted path + offending kind) so the same misuse during a v-for
 * re-render doesn't flood the console.
 *
 * In production, `__DEV__` is `false` and the WeakMap allocation
 * tree-shakes out — `recordRejection` returns `false` (don't warn).
 */
const warnedRejections: WeakMap<object, Set<string>> | null = __DEV__
  ? new WeakMap<object, Set<string>>()
  : null

function shouldWarnOnce(store: object, key: string): boolean {
  if (warnedRejections === null) return false
  let set = warnedRejections.get(store)
  if (set === undefined) {
    set = new Set()
    warnedRejections.set(store, set)
  }
  if (set.has(key)) return false
  set.add(key)
  return true
}

/**
 * Map a value to its slim primitive kind. Mirrors the adapter walker's
 * leaf-level mapping so the same kind names compare across the
 * accept-set boundary.
 *
 * Exported so the default-values pipelines can reuse the same
 * primitive-vs-refinement classification logic the runtime gate uses.
 */
export function slimKindOf(value: unknown): SlimPrimitiveKind {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  if (value instanceof Map) return 'map'
  if (value instanceof Set) return 'set'
  const t = typeof value
  switch (t) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'bigint':
      return 'bigint'
    case 'symbol':
      return 'symbol'
    case 'function':
      return 'function'
    case 'undefined':
      return 'undefined'
    case 'object':
      return 'object'
  }
}

function isLeafValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (Array.isArray(value)) return false
  if (isPlainRecord(value)) return false
  return true
}

/**
 * Validate `value` against the schema's slim shape, descending into
 * plain records and arrays so every leaf is checked at its sub-path.
 *
 * Returns `true` if every leaf's primitive matches the schema's
 * accept set at its path; `false` otherwise (and emits a one-shot
 * dev-warn naming the bad path + offending kind + accepted kinds).
 *
 * Conventions:
 * - Empty accept set → permissive (matches `z.any()` / `z.unknown()`
 *   and the unresolvable-path case). Allow the write.
 * - The value AT the write path is also checked: writing `'oops'`
 *   to a path expecting `'object'` is rejected at the top-level.
 * - For wrappers like `.optional()` / `.nullable()`, the adapter's
 *   accept set already includes `'undefined'` / `'null'` — no
 *   special-casing here.
 */
export function isSlimPrimitiveValid(
  schema: AbstractSchema<unknown, unknown>,
  store: object,
  path: Path,
  value: unknown
): boolean {
  return walk(schema, store, path, value)
}

function walk(
  schema: AbstractSchema<unknown, unknown>,
  store: object,
  path: Path,
  value: unknown
): boolean {
  // Top-of-tree check: does the value at THIS path satisfy the
  // schema's slim kinds at this path? Recurse into containers
  // afterwards — the recursion checks the elements' kinds at
  // the sub-paths.
  const accepted = schema.getSlimPrimitiveTypesAtPath(path)
  if (accepted.size > 0) {
    const kind = isLeafValue(value) ? slimKindOf(value) : Array.isArray(value) ? 'array' : 'object'
    if (!accepted.has(kind)) {
      reportRejection(store, path, kind, accepted)
      return false
    }
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!walk(schema, store, [...path, i], value[i])) return false
    }
    return true
  }

  if (isPlainRecord(value)) {
    for (const key of Object.keys(value)) {
      if (!walk(schema, store, [...path, key], (value as Record<string, unknown>)[key])) {
        return false
      }
    }
    return true
  }

  return true
}

function reportRejection(
  store: object,
  path: Path,
  kind: SlimPrimitiveKind,
  accepted: Set<SlimPrimitiveKind>
): void {
  if (!__DEV__) return
  const dotted = path.map((s: Segment) => String(s)).join('.') || '(root)'
  const key = `${dotted}::${kind}`
  if (!shouldWarnOnce(store, key)) return
  const acceptedList = [...accepted].sort().join(', ')

  console.warn(
    `[@chemical-x/forms] write rejected: value of kind '${kind}' is not assignable to ` +
      `path '${dotted}' (slim primitive set: { ${acceptedList} }). ` +
      `Refinement-level constraints (.email(), .min(N), enum membership, etc.) are NOT ` +
      `enforced at write time — only the primitive shape. The write was a no-op.`
  )
}
