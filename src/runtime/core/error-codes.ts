/**
 * Stable identifiers for library-emitted `ValidationError` codes.
 *
 * Convention: `<scope>:<kebab-case-identifier>`. Three scopes are
 * recognised by the library:
 *
 * - `atta:` — emitted by the framework-agnostic core (this map).
 * - `zod:` — emitted by the Zod adapter; computed inline from
 *   `issue.code` (e.g. `zod:too_small`). No enum here because
 *   Zod's code list evolves.
 * - consumer-defined — anything the consumer's backend / app stamps
 *   onto a `ValidationError` (via the `parseApiErrors` wire payload
 *   or `setFieldErrors` directly). Pick a scope (`api:`, `auth:`,
 *   etc.) and stay consistent.
 *
 * Use these constants in tests and error-routing UI:
 *
 * ```ts
 * if (error.code === AttaformErrorCode.NoValueSupplied) {
 *   // user hasn't filled this field
 * }
 * ```
 */
export const AttaformErrorCode = {
  /** A required field is in the blank set — user hasn't supplied a value. */
  NoValueSupplied: 'atta:no-value-supplied',
  /** The schema adapter's `validateAtPath` threw synchronously. */
  AdapterThrew: 'atta:adapter-threw',
  /** The supplied path didn't resolve to any node in the schema. */
  PathNotFound: 'atta:path-not-found',
} as const

export type AttaformErrorCode = (typeof AttaformErrorCode)[keyof typeof AttaformErrorCode]
