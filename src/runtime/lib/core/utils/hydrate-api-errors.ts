import type {
  ApiErrorDetails,
  ApiErrorEnvelope,
  FormKey,
  ValidationError,
} from '../../../types/types-api'
import { PATH_SEPARATOR } from './constants'

/**
 * Normalise an API validation-error payload into `ValidationError[]`.
 *
 * Accepts:
 * - the wrapped envelope: `{ error: { details: { "email": ["taken"] } } }`
 * - the unwrapped envelope: `{ details: { "email": ["taken"] } }`
 * - a raw details record: `{ "email": ["taken"], "message": "too short" }`
 * - `null` / `undefined` — returns `[]`
 *
 * Each detail entry may be either a single string or an array of strings;
 * both forms are expanded into individual `ValidationError` records, so the
 * UI can show multiple messages per field.
 *
 * Dotted paths (`"address.line1"`) are split on `.` to match the
 * `ValidationError.path` array shape produced by the zod adapter.
 */
export function hydrateApiErrors(
  payload: ApiErrorEnvelope | ApiErrorDetails | null | undefined,
  options: { formKey: FormKey }
): ValidationError[] {
  const details = extractDetails(payload)
  if (!details) return []

  return Object.entries(details).flatMap(([path, messages]) => {
    const messageList = Array.isArray(messages) ? messages : [messages]
    return messageList
      .filter((m): m is string => typeof m === 'string' && m.length > 0)
      .map<ValidationError>((message) => ({
        message,
        path: path.split(PATH_SEPARATOR),
        formKey: options.formKey,
      }))
  })
}

function extractDetails(
  payload: ApiErrorEnvelope | ApiErrorDetails | null | undefined
): ApiErrorDetails | null {
  if (payload === null || payload === undefined) return null
  if (typeof payload !== 'object') return null

  // Wrapped envelope: { error: { details: {...} } }
  if ('error' in payload && payload.error && typeof payload.error === 'object') {
    const inner = (payload.error as { details?: unknown }).details
    if (isDetailsRecord(inner)) return inner
  }

  // Unwrapped envelope: { details: {...} }
  if ('details' in payload) {
    const inner = (payload as { details?: unknown }).details
    if (isDetailsRecord(inner)) return inner
  }

  // Raw details record: every value is string | string[]
  if (isDetailsRecord(payload)) return payload

  return null
}

function isDetailsRecord(value: unknown): value is ApiErrorDetails {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(
    (v) => typeof v === 'string' || (Array.isArray(v) && v.every((s) => typeof s === 'string'))
  )
}
