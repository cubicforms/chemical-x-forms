import { deleteAtPath, setAtPath } from './path-walker'
import type { Path, Segment } from './paths'

/**
 * Structural diff/apply walker. Used by the state layer to emit per-leaf
 * patches when `setValue` replaces a subtree. Cost scales with the
 * size of the changed subtree, not the full form's leaf count.
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

  // Missing (undefined) <-> descendable: recurse into the descendable side so
  // every leaf emits an atomic 'added' / 'removed' patch. Populating
  // per-field metadata during form init / dynamic field additions relies on
  // this granularity. Other shape mismatches (primitive <-> object, array <->
  // object) are treated as atomic replacements.
  if (oldValue === undefined && newIsDescendable) {
    if (Array.isArray(newValue)) {
      for (let i = 0; i < newValue.length; i++) {
        diffAndApply(undefined, newValue[i], appendSegment(prefix, i), visit)
      }
    } else {
      const rec = newValue as Record<string, unknown>
      for (const k of Object.keys(rec)) {
        diffAndApply(undefined, rec[k], appendSegment(prefix, k), visit)
      }
    }
    return
  }

  if (oldIsDescendable && newValue === undefined) {
    if (Array.isArray(oldValue)) {
      for (let i = 0; i < oldValue.length; i++) {
        diffAndApply(oldValue[i], undefined, appendSegment(prefix, i), visit)
      }
    } else {
      const rec = oldValue as Record<string, unknown>
      for (const k of Object.keys(rec)) {
        diffAndApply(rec[k], undefined, appendSegment(prefix, k), visit)
      }
    }
    return
  }

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

/**
 * Apply `source`'s changes to `target` by reassigning only the
 * top-level keys whose subtrees CONTENT-differ. Uses `diffAndApply`'s
 * structural walk (not `Object.is`) to decide which keys changed,
 * because reactive proxies and copy-on-write spreads routinely produce
 * reference-different but content-equal subtrees that we don't want
 * to reassign — reassigning fires Vue's property dep and re-triggers
 * deep watches on that subtree.
 *
 * Returns `true` on success. Returns `false` when `target` and
 * `source` have incompatible shapes (e.g. object ↔ array, or one
 * side isn't a descendable container) — the caller must fall back
 * to wholesale replacement.
 *
 * **Why** (subtle but load-bearing):
 *
 * Vue's reactive proxy for an object-typed Ref gets re-created every
 * time the Ref's value is reassigned wholesale (`form.value = next`).
 * That re-creation fires every deep watch transitively bound to the
 * Ref — even watches whose underlying sub-tree is identity-equal
 * across the swap. When one of those watches reacts by writing back
 * to the form (the canonical "same as pickup address" mirror
 * pattern), the watch re-fires synchronously on its own write and
 * the browser tab freezes.
 *
 * The cure is to keep `form.value`'s identity stable across writes
 * and update only the children whose CONTENT actually changed. Deep
 * watches on sibling subtrees see no dep change and stay quiet; the
 * touched child gets a new reference, so reactive consumers tracking
 * THAT path (computeds, directive bindings, etc.) re-evaluate
 * correctly.
 *
 * Old subtree references that get reassigned are orphaned but
 * unmutated — exactly what consumers (history snapshots, captured
 * `prev` callback args) need.
 */
export function applyChangedKeys(target: unknown, source: unknown): boolean {
  if (!isDescendable(target) || !isDescendable(source)) return false
  const targetIsArray = Array.isArray(target)
  const sourceIsArray = Array.isArray(source)
  if (targetIsArray !== sourceIsArray) return false

  // Find the unique first segments where target and source differ in
  // CONTENT. A root-level patch (path.length === 0) signals an
  // un-recoverable shape mismatch: tell the caller to wholesale-replace.
  // Tracking a sentinel inside `changedFirstSegments` itself rather
  // than a separate flag — keeps eslint's narrowing from declaring
  // the flag dead code (the visitor callback is opaque to its flow
  // analysis).
  const ROOT_SENTINEL = Symbol.for('attaform.applyChangedKeys.rootMismatch')
  const changedFirstSegments = new Set<string | number | symbol>()
  diffAndApply(target, source, [], (patch) => {
    if (patch.path.length === 0) {
      changedFirstSegments.add(ROOT_SENTINEL)
      return
    }
    changedFirstSegments.add(patch.path[0] as string | number)
  })
  if (changedFirstSegments.has(ROOT_SENTINEL)) return false

  if (targetIsArray) {
    const t = target as unknown[]
    const s = source as readonly unknown[]
    if (t.length > s.length) t.length = s.length
    for (const idx of changedFirstSegments) {
      if (typeof idx === 'symbol') continue
      const i = typeof idx === 'number' ? idx : Number(idx)
      t[i] = s[i]
    }
  } else {
    const t = target as Record<string, unknown>
    const s = source as Record<string, unknown>
    const sourceKeys = new Set(Object.keys(s))
    for (const k of Object.keys(t)) {
      if (!sourceKeys.has(k)) delete t[k]
    }
    for (const k of changedFirstSegments) {
      if (typeof k === 'symbol') continue
      t[String(k)] = s[String(k)]
    }
  }
  return true
}

/**
 * Apply a `Patch[]` forward to `root`, returning a fresh root with each
 * patch's `newValue` (or `path` deletion) realised. Uses `setAtPath` /
 * `deleteAtPath` from `path-walker.ts`, which are copy-on-write — each
 * step rebuilds only the spine from root to the touched path, leaving
 * sibling subtrees reference-equal with the input. The result is a
 * structurally-shared successor suitable for use as a history snapshot.
 *
 * Patch semantics:
 * - `added` — set the path to `newValue`. Intermediate containers are
 *   created on demand (`setAtPath` handles this).
 * - `removed` — delete the path (array splice / object key deletion).
 * - `changed` — set the path to `newValue`. A root-level `changed`
 *   (path: []) replaces `root` wholesale; this matches `diffAndApply`'s
 *   "object ↔ array mismatch at root" emission.
 *
 * Patches are applied in their emitted order. `diffAndApply` emits
 * array patches in index order, so a sequence like
 * `[changed@1, removed@2]` collapses to the correct final array shape
 * (set then splice).
 */
export function applyPatchesForward(root: unknown, patches: readonly Patch[]): unknown {
  let current = root
  for (const patch of patches) {
    if (patch.path.length === 0) {
      current = patch.kind === 'removed' ? undefined : patch.newValue
      continue
    }
    if (patch.kind === 'removed') {
      current = deleteAtPath(current, patch.path)
    } else {
      current = setAtPath(current, patch.path, patch.newValue)
    }
  }
  return current
}

/**
 * Apply a `Patch[]` in reverse, restoring `root` to its pre-patch state.
 * Walks patches back-to-front and inverts each one's direction:
 * - `added` (forward set) → `deleteAtPath` (remove what was added).
 * - `removed` (forward delete) → `setAtPath` with `oldValue`.
 * - `changed` (forward set newValue) → `setAtPath` with `oldValue`.
 *
 * Reverse traversal matters because `diffAndApply` emits array patches
 * in index order. A forward sequence `[changed@1, removed@2]` applied
 * forward yields the new array; to invert, the splice at index 2 must
 * un-splice FIRST (extending the array back to length 3 by setting
 * index 2 to its `oldValue`), then the `changed@1` patch restores
 * index 1 to its `oldValue`. Going the other direction would leave a
 * hole.
 */
export function applyPatchesInverse(root: unknown, patches: readonly Patch[]): unknown {
  let current = root
  for (let i = patches.length - 1; i >= 0; i--) {
    const patch = patches[i] as Patch
    if (patch.path.length === 0) {
      if (patch.kind === 'added') {
        current = undefined
      } else {
        current = patch.oldValue
      }
      continue
    }
    if (patch.kind === 'added') {
      current = deleteAtPath(current, patch.path)
    } else {
      current = setAtPath(current, patch.path, patch.oldValue)
    }
  }
  return current
}

/**
 * Stable structural snapshot of a value. Walks plain objects + arrays
 * recursively; non-recursable values (primitives, Date, RegExp, Map,
 * Set, functions, class instances) pass through unchanged.
 *
 * Used by setValue's callback path so the `prev` arg passed to a
 * consumer's `(prev) => next` lambda is a frozen-in-time snapshot —
 * not a live reference into `form.value` that would silently mutate
 * once the surrounding setValue commits its in-place merge. Consumers
 * routinely cache `prev` in a closure or a test variable; without this
 * clone, those caches would silently drift to the post-setValue state.
 */
export function structuralSnapshot<T>(value: T): T {
  if (!isDescendable(value)) return value
  if (Array.isArray(value)) {
    const out = new Array(value.length)
    for (let i = 0; i < value.length; i++) {
      out[i] = structuralSnapshot(value[i])
    }
    return out as unknown as T
  }
  const src = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(src)) {
    out[k] = structuralSnapshot(src[k])
  }
  return out as unknown as T
}
