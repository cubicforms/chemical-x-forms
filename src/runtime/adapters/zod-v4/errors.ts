import type { z } from 'zod'
import type { FormKey, ValidationError } from '../../types/types-api'

/**
 * Normalise a batch of Zod v4 issues into the framework's `ValidationError`
 * shape. v4 types `issue.path` as `PropertyKey[]` (includes symbols);
 * we coerce symbols to strings at the boundary so downstream consumers
 * only see string-or-number segments.
 */
export function zodIssuesToValidationErrors(
  issues: readonly z.core.$ZodIssue[],
  formKey: FormKey
): ValidationError[] {
  return issues.map((issue) => ({
    message: issue.message,
    path: issue.path.map((seg) => (typeof seg === 'number' ? seg : String(seg))),
    formKey,
  }))
}

/**
 * Thrown when a Zod schema includes a kind the form library cannot
 * represent: `z.promise`, `z.custom`, `z.templateLiteral`, or a
 * recursive `z.lazy(...)` that loops back into itself.
 *
 * The error message includes the dotted path of the offending node
 * so you can locate it without traversing the whole schema.
 */
export class UnsupportedSchemaError extends Error {
  override readonly name = 'UnsupportedSchemaError'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}
