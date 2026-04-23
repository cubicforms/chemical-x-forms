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
        `Path '${path}' contains an empty segment. Use the array form (e.g. ['a', '', 'b']) if a key is genuinely empty.`
      )
    }
    segments.push(normalizeSegment(raw))
  }
  return segments
}

/**
 * Canonicalise a path input into a structured form plus a stable string key.
 * Accepts either dotted-string or array form; array form is lossless.
 *
 * The PathKey is derived via `JSON.stringify` on the normalised segments,
 * guaranteeing collision-free encoding even if segment strings contain the
 * null byte or any other character.
 */
export function canonicalizePath(input: string | Path): {
  segments: readonly Segment[]
  key: PathKey
} {
  const rawSegments: Segment[] =
    typeof input === 'string' ? parseDottedPath(input) : Array.from(input)
  const segments = rawSegments.map(normalizeSegment)
  const key = JSON.stringify(segments) as PathKey
  return { segments, key }
}

/** The root path: an empty tuple. `PathKey` is `'[]'`. */
export const ROOT_PATH: Path = Object.freeze([])
export const ROOT_PATH_KEY = '[]' as PathKey
