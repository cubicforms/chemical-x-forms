import type { Path, Segment } from './paths'

/**
 * Structural diff/apply walker. Used by the state layer to emit per-leaf
 * patches when `setValue` replaces a subtree. Replaces the pre-rewrite
 * pattern of flattening both old and new forms into dotted records, then
 * computing set differences — that approach was O(n) per keystroke in the
 * full form's leaf count; this is O(size-of-changed-subtree).
 *
 * "Leaves" are anything that's not a plain object or array: strings, numbers,
 * booleans, null, undefined, Date, Map, Set, class instances, functions, etc.
 * For forms, this is the right boundary — we don't want to walk into a `Date`
 * or a `File` value.
 */

export type Patch =
  | { readonly kind: 'added'; readonly path: Path; readonly newValue: unknown }
  | { readonly kind: 'removed'; readonly path: Path; readonly oldValue: unknown }
  | {
      readonly kind: 'changed'
      readonly path: Path
      readonly oldValue: unknown
      readonly newValue: unknown
    }

/**
 * True for plain objects (own prototype === Object.prototype or null) and
 * arrays. Deliberately rejects Map, Set, Date, class instances, functions —
 * those are treated as opaque leaf values.
 */
function isDescendable(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value) as object | null
  return proto === null || proto === Object.prototype
}

function appendSegment(prefix: Path, segment: Segment): Path {
  const next: Segment[] = new Array<Segment>(prefix.length + 1)
  for (let i = 0; i < prefix.length; i++) {
    const s = prefix[i]
    // prefix indices are always in-range by construction; the nullish fallback
    // placates noUncheckedIndexedAccess without adding runtime overhead.
    next[i] = s as Segment
  }
  next[prefix.length] = segment
  return next
}

/**
 * Walk `oldValue` and `newValue` in lockstep, calling `visit(patch)` for every
 * leaf that differs. Identical values (by `Object.is`) produce no patches.
 *
 * Root replacement (when `prefix` is empty and both values are descendable
 * but of different shapes, e.g. object → array) emits a single `'changed'`
 * patch with `path: []`. Callers handling root patches should clear all
 * dependent state.
 */
export function diffAndApply(
  oldValue: unknown,
  newValue: unknown,
  prefix: Path,
  visit: (patch: Patch) => void
): void {
  if (Object.is(oldValue, newValue)) return

  const oldIsDescendable = isDescendable(oldValue)
  const newIsDescendable = isDescendable(newValue)

  if (oldIsDescendable && newIsDescendable) {
    const oldIsArray = Array.isArray(oldValue)
    const newIsArray = Array.isArray(newValue)

    if (oldIsArray && newIsArray) {
      const oldArr = oldValue
      const newArr = newValue
      const max = Math.max(oldArr.length, newArr.length)
      for (let i = 0; i < max; i++) {
        diffAndApply(oldArr[i], newArr[i], appendSegment(prefix, i), visit)
      }
      return
    }

    if (!oldIsArray && !newIsArray) {
      const oldRec = oldValue as Record<string, unknown>
      const newRec = newValue as Record<string, unknown>
      const seen = new Set<string>()
      for (const k of Object.keys(oldRec)) {
        seen.add(k)
        diffAndApply(oldRec[k], newRec[k], appendSegment(prefix, k), visit)
      }
      for (const k of Object.keys(newRec)) {
        if (seen.has(k)) continue
        diffAndApply(oldRec[k], newRec[k], appendSegment(prefix, k), visit)
      }
      return
    }

    // object <-> array mismatch at this node. Treat as a full replacement.
    visit({ kind: 'changed', path: prefix, oldValue, newValue })
    return
  }

  if (oldIsDescendable && !newIsDescendable) {
    visit({ kind: 'changed', path: prefix, oldValue, newValue })
    return
  }

  if (!oldIsDescendable && newIsDescendable) {
    visit({ kind: 'changed', path: prefix, oldValue, newValue })
    return
  }

  // Both leaves; they differ (Object.is returned false above).
  if (oldValue === undefined) {
    visit({ kind: 'added', path: prefix, newValue })
    return
  }
  if (newValue === undefined) {
    visit({ kind: 'removed', path: prefix, oldValue })
    return
  }
  visit({ kind: 'changed', path: prefix, oldValue, newValue })
}
