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
 * Bounded FIFO cache for canonicalizePath on dotted-string inputs.
 * Real forms re-canonicalise a small working-set of paths thousands
 * of times per session (every keystroke on a registered field, every
 * validate, every getValue), so a small cache amortises the parse +
 * stringify cost across repeat calls without pinning memory as apps
 * accumulate fields.
 *
 * Eviction is FIFO (oldest insertion wins), not LRU. The 128-entry
 * cap is generous relative to a typical form's working set
 * (playground: ~15 paths; the entire test suite: 45 unique register
 * patterns) — overflow doesn't fire in practice. On the rare overflow
 * a re-canonicalisation hit is still O(segments) and lands back in
 * the cache. Bumping recency on every hit (`delete` + `set`) costs
 * two Map operations per cache hit, in the hottest read-side loop in
 * the library, with no observable benefit at this cap — so we don't.
 *
 * Array inputs are not cached: callers in the runtime (unset-walker's
 * recursive `[...segments, i]`, devtools' inspector `payload.path.slice(...)`)
 * overwhelmingly pass freshly-allocated arrays per call, so a
 * WeakMap-keyed cache would miss on every call and pay the
 * lookup-then-set cost without benefit.
 */
const CANONICAL_STRING_CACHE_MAX = 128
const canonicalStringCache = new Map<string, { segments: readonly Segment[]; key: PathKey }>()

/**
 * Inverse cache: PathKey → segments. Populated by `canonicalizePath`
 * (string and array branches) so any consumer holding a PathKey
 * produced through the canonical pipeline can recover its structured
 * segments without `JSON.parse`. Callers reach this through
 * `segmentsForPathKey` below.
 *
 * The store-side data structures keyed by PathKey (form-store error
 * maps, blank-paths set, variant-memory map, persistence opt-in
 * registry) all source their keys from `canonicalizePath`, so reads
 * are dominantly cache hits. Cold paths (PathKeys round-tripped from
 * a persisted payload that came from disk) still hit a single
 * `JSON.parse` on first lookup, then warm the cache.
 *
 * Bounded FIFO at 4096 entries — generous relative to a typical form's
 * working set (~tens to ~hundreds of paths per form) but small enough
 * that long-running multi-form apps don't accumulate unbounded
 * references. Eviction only fires on net-new entries; idempotent
 * overwrites (same key, same segments) don't count toward the cap.
 */
const PATHKEY_TO_SEGMENTS_MAX = 4096
const pathKeyToSegments = new Map<PathKey, readonly Segment[]>()

function rememberSegmentsForPathKey(key: PathKey, segments: readonly Segment[]): void {
  if (!pathKeyToSegments.has(key) && pathKeyToSegments.size >= PATHKEY_TO_SEGMENTS_MAX) {
    const oldest = pathKeyToSegments.keys().next().value
    if (oldest !== undefined) pathKeyToSegments.delete(oldest)
  }
  pathKeyToSegments.set(key, segments)
}

/**
 * Recover the structured `Segment[]` for a `PathKey` produced by
 * `canonicalizePath`. O(1) on the hot path (cache hit); cold keys
 * fall back to `JSON.parse(key)` plus segment normalization, then
 * warm the cache so subsequent lookups hit.
 *
 * Returns `null` for malformed PathKeys (non-JSON, non-array, or
 * containing values that aren't strings/numbers). Keys produced by
 * `canonicalizePath` never trip this — corrupt persistence payloads
 * (or test fixtures crafting raw strings) are the only realistic
 * sources.
 */
export function segmentsForPathKey(key: PathKey): readonly Segment[] | null {
  const cached = pathKeyToSegments.get(key)
  if (cached !== undefined) return cached
  let parsed: unknown
  try {
    parsed = JSON.parse(key)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const segments: Segment[] = []
  for (const raw of parsed) {
    if (typeof raw !== 'string' && typeof raw !== 'number') return null
    segments.push(normalizeSegment(raw))
  }
  rememberSegmentsForPathKey(key, segments)
  return segments
}

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
    if (cached !== undefined) return cached
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
    rememberSegmentsForPathKey(key, segments)
    return entry
  }
  const segments = Array.from(input).map(normalizeSegment)
  const key = JSON.stringify(segments) as PathKey
  rememberSegmentsForPathKey(key, segments)
  return { segments, key }
}

/**
 * The root path — an empty segment tuple. Pass to APIs that accept
 * a `Path` to address the form value as a whole.
 */
export const ROOT_PATH: Path = Object.freeze([])
/** Stable string key for the root path. */
export const ROOT_PATH_KEY = '[]' as PathKey
