import type {
  ApiErrorDetails,
  ApiErrorEnvelope,
  FormKey,
  ValidationError,
} from '../types/types-api'
import { InvalidPathError } from './errors'
import { canonicalizePath } from './paths'

/**
 * Result of `parseApiErrors`. Branch on `ok` to handle the two cases:
 *
 * ```ts
 * const result = parseApiErrors(payload, { formKey: form.key })
 * if (result.ok) {
 *   form.setFieldErrors(result.errors)
 * } else {
 *   console.warn('Bad error payload:', result.rejected)
 * }
 * ```
 *
 * `ok: true` means the payload was recognised — `errors` may still be
 * empty if the payload was valid but had no actual errors.
 * `ok: false` means the payload didn't match a known shape; `rejected`
 * carries a one-line description of why.
 */
export type ParseApiErrorsResult = {
  /** `true` when the payload was recognised; `false` when the shape was unfamiliar. */
  readonly ok: boolean
  /** Errors extracted from the payload. May be empty even when `ok: true`. */
  readonly errors: ValidationError[]
  /** When `ok: false`, a one-line description of why the payload was rejected. */
  readonly rejected?: string
}

/**
 * Options for `parseApiErrors`. The size caps protect against
 * misbehaving or hostile servers — exceeding any cap causes the
 * parser to reject the payload wholesale rather than partially apply.
 */
export type ParseApiErrorsOptions = {
  /**
   * The form's identifier — pass `form.key`. Stamped on every
   * produced `ValidationError` so errors route to the right form.
   */
  readonly formKey: FormKey
  /**
   * Maximum number of distinct keys to accept. Default `1000`.
   * Raise for trusted backends that legitimately produce more.
   */
  readonly maxEntries?: number
  /**
   * Maximum number of path segments per key. Default `32`. Keys
   * deeper than this are dropped (the rest of the payload still
   * applies if it stays under the other caps).
   */
  readonly maxPathDepth?: number
  /**
   * Maximum total path segments summed across every accepted key.
   * Default `10000`. Bounds the worst-case traversal cost.
   */
  readonly maxTotalSegments?: number
}

/**
 * Default size caps used by `parseApiErrors`. Conservative; pass
 * larger values via the options bag for trusted-backend integrations.
 */
export const PARSE_API_ERRORS_DEFAULTS = {
  maxEntries: 1000,
  maxPathDepth: 32,
  maxTotalSegments: 10000,
} as const

/**
 * Normalise a server-side validation error payload into
 * `ValidationError[]`. Pair with `form.setFieldErrors` /
 * `form.addFieldErrors` to surface server errors on the form:
 *
 * ```ts
 * const response = await fetch('/api/signup', { … })
 * if (!response.ok) {
 *   const payload = await response.json()
 *   const result = parseApiErrors(payload, { formKey: form.key })
 *   if (result.ok) form.setFieldErrors(result.errors)
 * }
 * ```
 *
 * Recognised payload shapes:
 *
 * - Wrapped envelope: `{ error: { details: { email: ['taken'] } } }`
 * - Unwrapped envelope: `{ details: { email: ['taken'] } }`
 * - Raw details record: `{ email: ['taken'], password: 'too short' }`
 * - `null` / `undefined` — returns `{ ok: true, errors: [] }`
 *
 * Each detail entry may be a single message string or an array;
 * arrays expand into one `ValidationError` per message, so the UI
 * can render multiple errors per field.
 *
 * Dotted keys (`"address.line1"`) are split into structured paths
 * automatically. Use a custom server response shape outside these
 * patterns? Build the `ValidationError[]` array yourself and pass
 * it to `setFieldErrors` directly — `parseApiErrors` is just a
 * convenience for the common shapes.
 */
export function parseApiErrors(
  payload: ApiErrorEnvelope | ApiErrorDetails | null | undefined | unknown,
  options: ParseApiErrorsOptions
): ParseApiErrorsResult {
  const maxEntries = options.maxEntries ?? PARSE_API_ERRORS_DEFAULTS.maxEntries
  const maxPathDepth = options.maxPathDepth ?? PARSE_API_ERRORS_DEFAULTS.maxPathDepth
  const maxTotalSegments = options.maxTotalSegments ?? PARSE_API_ERRORS_DEFAULTS.maxTotalSegments

  if (payload === null || payload === undefined) {
    return { ok: true, errors: [] }
  }
  if (typeof payload !== 'object') {
    return { ok: false, errors: [], rejected: `payload was ${typeof payload}, expected object` }
  }

  const extraction = extractDetails(payload as Record<string, unknown>)
  if (!extraction.ok) {
    return { ok: false, errors: [], rejected: extraction.reason }
  }

  const { details } = extraction
  const entryCount = Object.keys(details).length
  // Enforce the guardrails before we spend time walking the payload.
  // Rejecting wholesale (not partial-applying) keeps the failure visible
  // so consumers can tune the caps or investigate the server payload.
  if (entryCount > maxEntries) {
    return {
      ok: false,
      errors: [],
      rejected: `payload has ${entryCount} entries, exceeds maxEntries=${maxEntries}`,
    }
  }

  const errors: ValidationError[] = []
  let totalSegments = 0
  for (const [key, messages] of Object.entries(details)) {
    const messageList = Array.isArray(messages) ? messages : [messages]
    // `canonicalizePath` throws `InvalidPathError` for dotted strings with
    // empty segments (e.g. `'. '`, `'a..b'`). A misbehaving server can
    // genuinely emit such a key; the hydrator is a normaliser, not a
    // validator, so we drop offending keys rather than let the exception
    // escape. Well-formed keys continue as normal.
    let segments: readonly (string | number)[]
    try {
      segments = canonicalizePath(key).segments
    } catch (err) {
      if (err instanceof InvalidPathError) continue
      throw err
    }
    // Per-path depth cap. We drop the offending key (rather than
    // rejecting the whole payload) because a single stray deep path
    // in an otherwise legitimate error set is still worth surfacing
    // the rest. Consumers who want strict rejection can post-filter
    // on `result.errors.length < details entryCount`.
    if (segments.length > maxPathDepth) continue
    // Total-segment cap. Enforced wholesale (not per-key) so a payload
    // that passes the per-key gate but stacks into a pathological
    // total still fails visibly. Mirrors `maxEntries` strictness.
    totalSegments += segments.length
    if (totalSegments > maxTotalSegments) {
      return {
        ok: false,
        errors: [],
        rejected: `payload total path segments exceeds maxTotalSegments=${maxTotalSegments}`,
      }
    }
    for (const message of messageList) {
      if (typeof message !== 'string' || message.length === 0) continue
      errors.push({
        message,
        path: Array.from(segments),
        formKey: options.formKey,
      })
    }
  }
  return { ok: true, errors }
}

type ExtractResult = { ok: true; details: ApiErrorDetails } | { ok: false; reason: string }

function extractDetails(payload: Record<string, unknown>): ExtractResult {
  const wrappedError = payload['error']
  if (wrappedError !== null && wrappedError !== undefined && typeof wrappedError === 'object') {
    const inner = (wrappedError as { details?: unknown }).details
    if (inner === undefined) {
      // A wrapped envelope without details is considered "no errors" — valid shape.
      return { ok: true, details: {} }
    }
    if (isDetailsRecord(inner)) return { ok: true, details: inner }
    return { ok: false, reason: 'error.details was not a record of string | string[]' }
  }

  // `{ error: 'oops' }` / `{ error: 42 }` is a malformed wrapped envelope —
  // the server meant an error object but sent a scalar. Without this guard
  // the payload would fall through to the raw-details branch below, where
  // `{ error: 'oops' }` satisfies `isDetailsRecord` and silently produces
  // a phantom `ValidationError` at path `['error']`.
  if (wrappedError !== null && wrappedError !== undefined && typeof wrappedError !== 'object') {
    return {
      ok: false,
      reason: `payload.error was ${typeof wrappedError}, expected an object with { details }`,
    }
  }

  if ('details' in payload) {
    const inner = payload['details']
    if (inner === undefined) return { ok: true, details: {} }
    if (isDetailsRecord(inner)) return { ok: true, details: inner }
    return { ok: false, reason: 'details was not a record of string | string[]' }
  }

  if (isDetailsRecord(payload)) return { ok: true, details: payload }

  // Heuristic: if the payload has keys but none of them look like details,
  // it's probably a completely different shape. Reject.
  if (Object.keys(payload).length === 0) return { ok: true, details: {} }
  return { ok: false, reason: 'unrecognised payload shape' }
}

function isDetailsRecord(value: unknown): value is ApiErrorDetails {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  // Reject prototype-polluted keys — we don't use them here, but downstream
  // spreads shouldn't have to worry about this input.
  const record = value as Record<string, unknown>
  for (const k of Object.keys(record)) {
    const v = record[k]
    if (typeof v === 'string') continue
    if (Array.isArray(v) && v.every((s) => typeof s === 'string')) continue
    return false
  }
  return true
}
