import type { Path, Segment } from './paths'

/**
 * Structured-path get/set primitives. Replace `lodash-es/get` and
 * `lodash-es/set` for internal callers that speak `Path` rather than
 * dotted strings.
 *
 * Semantics:
 * - `getAtPath` returns `undefined` for any path that traverses through
 *   a non-descendable value (null, primitive, function). This preserves
 *   distinctions: `null` at the exact target is returned as `null`, not
 *   as `undefined`; only missing / non-descendable intermediates collapse.
 * - `setAtPath` is copy-on-write at every level from root to target. New
 *   intermediate containers are created according to the segment type:
 *   numeric segments produce arrays, string segments produce plain objects.
 *   Sibling values at each level are preserved by reference (structural
 *   sharing), so the non-touched subtrees stay reference-equal for
 *   downstream `Object.is` checks in `diffAndApply`.
 */

const NOT_FOUND: unique symbol = Symbol('NOT_FOUND')

function descendStep(value: unknown, segment: Segment): unknown | typeof NOT_FOUND {
  if (value === null || value === undefined) return NOT_FOUND
  if (typeof value !== 'object') return NOT_FOUND
  if (Array.isArray(value)) {
    if (typeof segment !== 'number') return NOT_FOUND
    if (segment < 0 || segment >= value.length) return NOT_FOUND
    return value[segment]
  }
  const record = value as Record<string, unknown>
  const key = typeof segment === 'number' ? String(segment) : segment
  if (!(key in record)) return NOT_FOUND
  return record[key]
}

export function getAtPath(root: unknown, path: Path): unknown {
  if (path.length === 0) return root
  let current: unknown = root
  for (const segment of path) {
    const next = descendStep(current, segment)
    if (next === NOT_FOUND) return undefined
    current = next
  }
  return current
}

/**
 * Returns true iff `path` exists in `root` as a descendable chain to a leaf
 * or to a defined value. Distinguishes "exists and is undefined" (rare but
 * possible with explicit assignment) from "missing".
 */
export function hasAtPath(root: unknown, path: Path): boolean {
  if (path.length === 0) return true
  let current: unknown = root
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i] as Segment
    const next = descendStep(current, segment)
    if (next === NOT_FOUND) return false
    current = next
  }
  const last = path[path.length - 1] as Segment
  if (current === null || current === undefined) return false
  if (typeof current !== 'object') return false
  if (Array.isArray(current)) {
    return typeof last === 'number' && last >= 0 && last < current.length
  }
  const key = typeof last === 'number' ? String(last) : last
  return key in (current as Record<string, unknown>)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as object | null
  return proto === null || proto === Object.prototype
}

export function setAtPath(root: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value

  const head = path[0] as Segment
  const rest = path.slice(1)

  if (typeof head === 'number') {
    const arr = Array.isArray(root) ? [...root] : []
    // Extend sparse arrays with undefined slots up to the target index.
    while (arr.length <= head) arr.push(undefined)
    arr[head] = setAtPath(arr[head], rest, value)
    return arr
  }

  const rec: Record<string, unknown> = isPlainRecord(root) ? { ...root } : {}
  rec[head] = setAtPath(rec[head], rest, value)
  return rec
}
