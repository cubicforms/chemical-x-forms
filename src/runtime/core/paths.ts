import { InvalidPathError } from './errors'

/**
 * Path primitives for advanced integrations. The form library accepts
 * paths in dotted-string form (`'user.email'`) at every public API.
 * These primitives are exposed for adapter authors who need to
 * canonicalise user-provided paths.
 */

declare const pathKeyBrand: unique symbol

/**
 * Branded string identifier for a canonicalised path. Useful as a
 * `Map` key — two paths that resolve to the same canonical form
 * produce the same `PathKey`. Treat as opaque; don't try to parse.
 */
export type PathKey = string & { readonly [pathKeyBrand]: 'PathKey' }

/** A single path segment — a property name or array index. */
export type Segment = string | number
/** A structured path as a read-only sequence of segments. */
export type Path = readonly Segment[]

/** Tests an integer-like string without leading zeros. `'0'` | `'1'` | `'42'` pass; `'01'`, `'-1'`, `'1.5'` do not. */
const INTEGER_SEGMENT = /^(?:0|[1-9]\d*)$/

function normalizeSegment(raw: Segment): Segment {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0) {
      throw new InvalidPathError(
        `Path segments must be non-negative integers when numeric; got ${String(raw)}`
      )
    }
    return raw
  }
  // Integer-looking strings normalise to numbers so that dotted-form
  // `'items.0.name'` and array-form `['items', 0, 'name']` yield the same
  // canonical path (and PathKey).
  if (INTEGER_SEGMENT.test(raw)) return Number(raw)
  return raw
}

/**
 * Parse a dotted-string path into structured segments.
 *
 * ```ts
 * parseDottedPath('user.address.line1')   // ['user', 'address', 'line1']
 * parseDottedPath('items.0.name')         // ['items', 0, 'name']
 * parseDottedPath('')                     // [] (root)
 * ```
 *
 * Throws `InvalidPathError` for paths with empty segments
 * (`'a..b'`, leading or trailing dots). For keys containing literal
 * dots, pass an array form (`['user.name']`) instead.
 */
export function parseDottedPath(path: string): Segment[] {
  if (path.length === 0) return []
  const rawSegments = path.split('.')
  const segments: Segment[] = []
  for (const raw of rawSegments) {
    if (raw.length === 0) {
      throw new InvalidPathError(
        `Path '${path}' has an empty segment; use the array form for empty keys.`
      )
    }
    segments.push(normalizeSegment(raw))
  }
  return segments
}

/**
 * Bounded LRU cache for canonicalizePath on dotted-string inputs. Real forms
 * issue many repeat canonicalizations for a small working-set of paths as
 * the user types, registers fields, and validates — so an LRU amortises the
 * parse + stringify cost across repeat calls without pinning memory as apps
 * accumulate fields.
 *
 * Array inputs are not cached: they're already structured, so `.map` +
 * `JSON.stringify` on a short array is cheaper than two Map touches.
 *
 * LRU is implemented as a plain `Map<string, entry>`: Map preserves insertion
 * order, so on a cache hit we re-insert to move the entry to the end, and on
 * overflow we delete the oldest (Map's first-in-iteration key). The cap is
 * 128 — well above a typical form's working set but small enough that the
 * Map itself stays cheap to scan on eviction.
 */
const CANONICAL_STRING_CACHE_MAX = 128
const canonicalStringCache = new Map<string, { segments: readonly Segment[]; key: PathKey }>()

/**
 * Canonicalise a path into structured segments plus a stable string
 * key. Accepts either dotted-string or array form; integer-looking
 * segments normalise to numbers.
 *
 * ```ts
 * canonicalizePath('items.0.name')
 * // { segments: ['items', 0, 'name'], key: '["items",0,"name"]' as PathKey }
 *
 * canonicalizePath(['items', 0, 'name'])
 * // → same result
 * ```
 *
 * The returned `key` is suitable as a `Map`/`Set` key — equal paths
 * produce equal keys regardless of input form.
 */
export function canonicalizePath(input: string | Path): {
  segments: readonly Segment[]
  key: PathKey
} {
  if (typeof input === 'string') {
    const cached = canonicalStringCache.get(input)
    if (cached !== undefined) {
      // Move to end so frequently-touched paths survive eviction; `delete`
      // + `set` is the canonical JS-Map LRU bump pattern.
      canonicalStringCache.delete(input)
      canonicalStringCache.set(input, cached)
      return cached
    }
    // `parseDottedPath` already normalises each segment; the previous
    // `.map(normalizeSegment)` second pass was a no-op. We drop it here.
    const segments: readonly Segment[] = parseDottedPath(input)
    const key = JSON.stringify(segments) as PathKey
    const entry = { segments, key }
    if (canonicalStringCache.size >= CANONICAL_STRING_CACHE_MAX) {
      const oldest = canonicalStringCache.keys().next().value
      if (oldest !== undefined) canonicalStringCache.delete(oldest)
    }
    canonicalStringCache.set(input, entry)
    return entry
  }
  const segments = Array.from(input).map(normalizeSegment)
  const key = JSON.stringify(segments) as PathKey
  return { segments, key }
}

/**
 * The root path — an empty segment tuple. Pass to APIs that accept
 * a `Path` to address the form value as a whole.
 */
export const ROOT_PATH: Path = Object.freeze([])
/** Stable string key for the root path. */
export const ROOT_PATH_KEY = '[]' as PathKey
