import type { PathKey } from '../paths'

/**
 * Per-element identity for the persistence opt-in registry.
 *
 * Why WeakMap-keyed monotonic counter:
 *   - **No DOM mutation.** A `data-atta-id` attribute would alter SSR
 *     output and risk hydration discrepancies. WeakMap is invisible.
 *   - **Auto-GC.** When the element is removed from the DOM and goes
 *     out of all references, the WeakMap entry vanishes — no leak.
 *   - **Counter over UUID.** Element IDs never cross runtime boundaries
 *     (the directive that consumes them is client-only), so collision
 *     resistance across processes is irrelevant. Smaller, easier to
 *     debug ("el-7" vs a UUID).
 */
const idGenerator = (() => {
  let counter = 0
  return () => `el-${++counter}`
})()

const elementIds = new WeakMap<HTMLElement, string>()

export function getOrAssignElementId(el: HTMLElement): string {
  let id = elementIds.get(el)
  if (id === undefined) {
    id = idGenerator()
    elementIds.set(el, id)
  }
  return id
}

/**
 * Per-FormStore registry tracking which DOM elements have opted into
 * persistence for which paths. Lives on the FormStore so that two SFCs
 * sharing a key share the registry — opt-ins are per-element, not
 * per-component.
 *
 * The directive's input handler computes `meta.persist` for each write
 * by calling `hasOptIn(elementId, path)` — only THIS element's writes
 * persist if THIS element opted in. Other call sites that aren't tied
 * to a single element (history undo/redo, field-array helpers, devtools
 * edits) use `hasAnyOptInForPath(path)` — persist if any element has
 * opted into that path.
 *
 * Internal data structure: `Map<PathKey, Set<elementId>>`. Small forms
 * have ~10-50 paths; iteration is cheap. All operations are O(1) given
 * (id, path).
 */
export type PersistOptInRegistry = {
  /** Add an opt-in entry; idempotent. */
  add(elementId: string, path: PathKey): void
  /** Remove a single (element, path) entry. */
  remove(elementId: string, path: PathKey): void
  /** Remove every opt-in for `elementId`. Called from directive's beforeUnmount. */
  removeAllFor(elementId: string): void
  /** Check whether THIS element has opted into THIS path. */
  hasOptIn(elementId: string, path: PathKey): boolean
  /** Check whether ANY element has opted into this path. */
  hasAnyOptInForPath(path: PathKey): boolean
  /** Iterate every path that currently has at least one opt-in. */
  optedInPaths(): IterableIterator<PathKey>
  /** True iff no element has opted into any path. */
  isEmpty(): boolean
  /** Drop every entry. Called from FormStore.dispose. */
  clear(): void
}

export function createPersistOptInRegistry(): PersistOptInRegistry {
  const byPath = new Map<PathKey, Set<string>>()

  function add(elementId: string, path: PathKey): void {
    const existing = byPath.get(path)
    if (existing === undefined) {
      byPath.set(path, new Set([elementId]))
      return
    }
    existing.add(elementId)
  }

  function remove(elementId: string, path: PathKey): void {
    const existing = byPath.get(path)
    if (existing === undefined) return
    existing.delete(elementId)
    if (existing.size === 0) byPath.delete(path)
  }

  function removeAllFor(elementId: string): void {
    for (const [path, ids] of byPath) {
      if (!ids.delete(elementId)) continue
      if (ids.size === 0) byPath.delete(path)
    }
  }

  function hasOptIn(elementId: string, path: PathKey): boolean {
    return byPath.get(path)?.has(elementId) ?? false
  }

  function hasAnyOptInForPath(path: PathKey): boolean {
    const ids = byPath.get(path)
    return ids !== undefined && ids.size > 0
  }

  function optedInPaths(): IterableIterator<PathKey> {
    return byPath.keys()
  }

  function isEmpty(): boolean {
    return byPath.size === 0
  }

  function clear(): void {
    byPath.clear()
  }

  return {
    add,
    remove,
    removeAllFor,
    hasOptIn,
    hasAnyOptInForPath,
    optedInPaths,
    isEmpty,
    clear,
  }
}
