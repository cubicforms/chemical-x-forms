import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { canonicalizePath } from './paths'

/**
 * Typed array helpers on top of FormStore. Each helper reads the current
 * array at the given path, produces a new copy (immutable, so that the
 * `form` ref's reactive notification goes out), and writes it back via
 * `setValueAtPath`. All downstream bookkeeping — diffAndApply patches,
 * field-record `updatedAt` stamps, error-store preservation — comes for
 * free through the normal setValueAtPath pipeline.
 *
 * Out-of-range index semantics:
 *   - `remove` / `swap` / `replace`: no-op on invalid indices. Never grow
 *     the array. Matches react-hook-form / VeeValidate precedent.
 *   - `insert`: the target index is clamped via `Array.prototype.splice`
 *     (values past `length` are treated as `length`).
 *   - `move`: invalid `from` is a no-op; `to` is clamped to `[0, length]`.
 *
 * None of the helpers mutate the existing array — every write is a fresh
 * array literal, so Vue's identity-based change detection fires. Callers
 * that need to compose mutations should batch them at the schema level
 * (build the replacement shape, call `setValue(path, shape)` once).
 */

export type FieldArrayApi = {
  append(path: string, value: unknown): boolean
  prepend(path: string, value: unknown): boolean
  insert(path: string, index: number, value: unknown): boolean
  remove(path: string, index: number): boolean
  swap(path: string, a: number, b: number): boolean
  move(path: string, from: number, to: number): boolean
  replace(path: string, index: number, value: unknown): boolean
}

export function buildFieldArrayApi<F extends GenericForm>(state: FormStore<F>): FieldArrayApi {
  function readArray(path: string): unknown[] {
    const segments = canonicalizePath(path).segments
    const current = state.getValueAtPath(segments)
    // If the path is missing or points at a non-array (e.g. the schema
    // default was undefined), treat as an empty array. This lets
    // `append` work for arrays that haven't been initialised by the
    // schema; the alternative of throwing surfaces programmer errors
    // earlier but blocks a common consumer pattern.
    return Array.isArray(current) ? current.slice() : []
  }

  function writeArray(path: string, next: unknown[]): boolean {
    const { segments, key } = canonicalizePath(path)
    // Persist iff some element has opted into this exact array path. If
    // the consumer opted into specific leaves (e.g. 'contacts.0.name')
    // an `append('contacts', row)` falls through — the array root has
    // no opt-in, so it doesn't persist. Coherent: "you opted to persist
    // a leaf, not the array structure."
    return state.setValueAtPath(segments, next, {
      persist: state.persistOptIns.hasAnyOptInForPath(key),
    })
  }

  return {
    append(path, value) {
      const next = readArray(path)
      next.push(value)
      return writeArray(path, next)
    },
    prepend(path, value) {
      const next = readArray(path)
      next.unshift(value)
      return writeArray(path, next)
    },
    insert(path, index, value) {
      const next = readArray(path)
      // splice clamps `index` to `[0, length]`; negative values count from
      // the end. We pass through untouched — Array semantics are the
      // consumer's expected behaviour here.
      next.splice(index, 0, value)
      return writeArray(path, next)
    },
    remove(path, index) {
      const next = readArray(path)
      if (index < 0 || index >= next.length) return false
      next.splice(index, 1)
      return writeArray(path, next)
    },
    swap(path, a, b) {
      const next = readArray(path)
      if (a < 0 || a >= next.length) return false
      if (b < 0 || b >= next.length) return false
      if (a === b) return false
      const tmp = next[a]
      next[a] = next[b]
      next[b] = tmp
      return writeArray(path, next)
    },
    move(path, from, to) {
      const next = readArray(path)
      if (from < 0 || from >= next.length) return false
      const [item] = next.splice(from, 1)
      const clampedTo = Math.max(0, Math.min(to, next.length))
      next.splice(clampedTo, 0, item)
      return writeArray(path, next)
    },
    replace(path, index, value) {
      const next = readArray(path)
      if (index < 0 || index >= next.length) return false
      next[index] = value
      return writeArray(path, next)
    },
  }
}
