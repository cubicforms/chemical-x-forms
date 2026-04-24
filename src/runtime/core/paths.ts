import { InvalidPathError } from './errors'

/**
 * Structured path primitives. The core runtime treats paths as
 * `readonly Segment[]` internally; dotted-string inputs are canonicalised at
 * public API boundaries. This keeps field names containing `.` lossless when
 * the array form is used, and matches lodash `get` semantics for numeric
 * segments (integer-looking strings normalise to numbers).
 */

declare const pathKeyBrand: unique symbol

/** A stable Map-key derived from a canonical Path. Not parseable; compare by equality only. */
export type PathKey = string & { readonly [pathKeyBrand]: 'PathKey' }

export type Segment = string | number
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
 * Parse a dotted-string path into segments.
 *
 * - `''` parses to an empty path (represents the root of the form).
 * - Empty segments between dots (e.g. `'a..b'`) throw `InvalidPathError`.
 * - Whitespace is NOT trimmed; `' a'` is a segment with a literal leading
 *   space. Use array form for unusual keys.
 * - Integer-looking segments normalise to numbers.
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
 * Canonicalise a path input into a structured form plus a stable string key.
 * Accepts either dotted-string or array form; array form is lossless.
 *
 * The PathKey is derived via `JSON.stringify` on the normalised segments,
 * guaranteeing collision-free encoding even if segment strings contain the
 * null byte or any other character.
 *
 * Dotted-string inputs are LRU-cached; see `canonicalStringCache` above.
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

/** The root path: an empty tuple. `PathKey` is `'[]'`. */
export const ROOT_PATH: Path = Object.freeze([])
export const ROOT_PATH_KEY = '[]' as PathKey
