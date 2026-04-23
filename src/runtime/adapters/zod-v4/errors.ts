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
