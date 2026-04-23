import type {
  ApiErrorDetails,
  ApiErrorEnvelope,
  FormKey,
  ValidationError,
} from '../types/types-api'
import { InvalidPathError } from './errors'
import { canonicalizePath } from './paths'

/**
 * Structured result of `hydrateApiErrors`. Replaces the pre-rewrite
 * `ValidationError[]` return, which conflated "empty but valid payload"
 * with "malformed payload we couldn't hydrate".
 */
export type HydrateApiErrorsResult = {
  readonly ok: boolean
  readonly errors: ValidationError[]
  readonly rejected?: string
}

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
 *   recognised (malformed object-of-objects, primitive, etc.). Prior
 *   versions silently returned `[]` for both cases, which made server
 *   integration bugs hard to debug.
 */
export function hydrateApiErrors(
  payload: ApiErrorEnvelope | ApiErrorDetails | null | undefined | unknown,
  options: { formKey: FormKey }
): HydrateApiErrorsResult {
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
  return {
    ok: false,
    reason:
      'payload shape not recognised (expected { details }, { error: { details } }, or a raw details record)',
  }
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
