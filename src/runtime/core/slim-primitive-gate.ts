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
 * - Empty accept set → REJECT every kind. This covers `z.never()`
 *   (intentionally accepts nothing) AND unresolvable paths (typo
 *   in `register('addr.zipp')` against a schema that doesn't have
 *   that field — silently accepting the write would create a phantom
 *   slot in storage). `z.any()` / `z.unknown()` / `z.void()` and the
 *   lazy-peel-failure case return the FULL permissive set, so they
 *   accept anything via the membership check below — they don't go
 *   through this branch.
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
  //
  // An empty accept set means the schema rejects every kind at this
  // path: either the path doesn't resolve (typo / unknown leaf) or
  // the path resolves to `z.never()`. Either way, the membership
  // check below rejects, blocking the write. `z.any()` / `z.unknown()`
  // / `z.void()` and the lazy-peel-failure case return the full
  // permissive set — those still accept any kind.
  const accepted = schema.getSlimPrimitiveTypesAtPath(path)
  const kind = isLeafValue(value) ? slimKindOf(value) : Array.isArray(value) ? 'array' : 'object'
  if (!accepted.has(kind)) {
    reportRejection(store, path, kind, accepted)
    return false
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

  // KISS rule: state the problem in one sentence, then list the fix.
  // Devs scan the first line; everything after is the recipe.

  // Path doesn't resolve (or resolves to z.never). The headline names
  // the actual cause; z.never is rare enough that it doesn't deserve
  // top billing.
  if (accepted.size === 0) {
    console.warn(
      `[@chemical-x/forms] Cannot write to '${dotted}' — this path is not in your schema.\n` +
        `  Fix: check for a typo in register('${dotted}'); it should match a leaf key in your schema.\n` +
        `  (If the path resolves to z.never, the schema explicitly admits no values — relax the schema if intentional.)\n` +
        `  The write was a no-op.`
    )
    return
  }

  const expected = formatExpectedKinds(accepted)

  // String-to-number is the most common gate rejection in real apps:
  // a plain `<input v-register>` against a `z.number()` field reads
  // `el.value` as a string. Show both v-register fix paths verbatim
  // so the dev can copy-paste rather than parse "slim primitive set".
  if (kind === 'string' && accepted.has('number')) {
    console.warn(
      `[@chemical-x/forms] Cannot write a string to '${dotted}' — the schema expects ${expected}.\n` +
        `  Fix: add type="number" to the input, OR use the .number modifier on v-register:\n` +
        `    <input type="number" v-register="register('${dotted}')" />\n` +
        `    <input v-register.number="register('${dotted}')" />\n` +
        `  The write was a no-op.`
    )
    return
  }

  // Generic kind mismatch — no built-in DOM coercion path to suggest.
  console.warn(
    `[@chemical-x/forms] Cannot write a ${kind} to '${dotted}' — the schema expects ${expected}.\n` +
      `  The write was a no-op.`
  )
}

function formatExpectedKinds(accepted: Set<SlimPrimitiveKind>): string {
  const list = [...accepted].sort()
  if (list.length === 1) return list[0] as string
  if (list.length === 2) return `${list[0]} or ${list[1]}`
  return `one of: ${list.join(', ')}`
}
