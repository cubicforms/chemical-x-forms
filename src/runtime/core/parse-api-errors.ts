import type {
  ApiErrorDetails,
  ApiErrorEnvelope,
  FormKey,
  ValidationError,
} from '../types/types-api'
import { InvalidPathError } from './errors'
import { canonicalizePath } from './paths'

/**
 * Structured result of `parseApiErrors`. The discriminated `ok` flag
 * separates "empty but valid payload" (`{ ok: true, errors: [] }`)
 * from "malformed payload we couldn't parse" (`{ ok: false, rejected }`).
 * Earlier versions of this surface conflated the two by returning a
 * bare `ValidationError[]`, making server-integration bugs invisible.
 */
export type ParseApiErrorsResult = {
  readonly ok: boolean
  readonly errors: ValidationError[]
  readonly rejected?: string
}

/**
 * Guardrails for untrusted API error payloads. A misbehaving (or
 * hostile) server can emit large or deeply-nested detail maps; applying
 * them to form state is O(entries × depth) in the worst case. Hitting
 * either ceiling causes the parser to reject the payload wholesale —
 * partial application would silently apply some errors and drop others,
 * which is worse for debugging than a clean rejection.
 */
export type ParseApiErrorsOptions = {
  /**
   * The form's `key` (or `form.key`). Stamped on every produced
   * `ValidationError` so the form knows which form the errors belong
   * to. Required because `ValidationError.formKey` is required on the
   * type, and stamping is the parser's job — not the consumer's.
   */
  readonly formKey: FormKey
  /**
   * Maximum number of distinct keys accepted in the details record.
   * Defaults to 1 000. Raise for trusted-backend integrations that
   * legitimately need more; lower for gateway-passthrough code where
   * the payload might be attacker-shaped.
   */
  readonly maxEntries?: number
  /**
   * Maximum number of path segments per key. Defaults to 32 — deeper
   * than any realistic form schema. Keys that exceed it are dropped
   * with the rest of the payload so the failure is visible (vs. a
   * silent partial apply).
   */
  readonly maxPathDepth?: number
}

/**
 * Default caps. Conservative; consumers who deliberately ship larger
 * payloads can override on a per-call basis.
 */
export const PARSE_API_ERRORS_DEFAULTS = {
  maxEntries: 1000,
  maxPathDepth: 32,
} as const

/**
 * Normalise an API validation-error payload into `ValidationError[]`.
 *
 * Accepts:
 * - the wrapped envelope: `{ error: { details: { "email": ["taken"] } } }`
 * - the unwrapped envelope: `{ details: { "email": ["taken"] } }`
 * - a raw details record: `{ "email": ["taken"], "message": "too short" }`
 * - `null` / `undefined` — returns `{ ok: true, errors: [] }`
 *
 * Each detail entry may be either a single string or an array of strings;
 * both forms are expanded into individual `ValidationError` records, so the
 * UI can show multiple messages per field.
 *
 * Dotted paths (`"address.line1"`) are canonicalised via `canonicalizePath`
 * so integer-looking segments normalise to numbers. Path segments with
 * dots in the key itself can only be represented by consumers that pass
 * an already-structured path — this function accepts only string keys from
 * the API, matching RFC-style JSON error responses.
 *
 * Return semantics:
 * - `{ ok: true, errors }` — payload recognised (possibly empty)
 * - `{ ok: false, errors: [], rejected: '…' }` — payload shape not
 *   recognised (malformed object-of-objects, primitive, etc.).
 *
 * Pure transformation: no side effects, no form coupling. Pair with
 * `form.setFieldErrors` (or `addFieldErrors`) to apply the result:
 *
 * ```ts
 * const result = parseApiErrors(response, { formKey: form.key })
 * if (result.ok) form.setFieldErrors(result.errors)
 * ```
 */
export function parseApiErrors(
  payload: ApiErrorEnvelope | ApiErrorDetails | null | undefined | unknown,
  options: ParseApiErrorsOptions
): ParseApiErrorsResult {
  const maxEntries = options.maxEntries ?? PARSE_API_ERRORS_DEFAULTS.maxEntries
  const maxPathDepth = options.maxPathDepth ?? PARSE_API_ERRORS_DEFAULTS.maxPathDepth

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
