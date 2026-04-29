import type { z } from 'zod'
import { __DEV__ } from '../../core/dev'
import type { FormKey, ValidationError } from '../../types/types-api'

let warnedZodCodeMissing = false

/**
 * Normalise a batch of Zod v4 issues into the framework's `ValidationError`
 * shape. v4 types `issue.path` as `PropertyKey[]` (includes symbols);
 * we coerce symbols to strings at the boundary so downstream consumers
 * only see string-or-number segments.
 *
 * The `code` field is stamped as `zod:${issue.code}` (e.g.
 * `zod:too_small`, `zod:invalid_format`). If a custom Zod plugin
 * emits an issue without a string `code`, we fall back to
 * `'zod:unknown'` and dev-warn once per process.
 */
export function zodIssuesToValidationErrors(
  issues: readonly z.core.$ZodIssue[],
  formKey: FormKey
): ValidationError[] {
  return issues.map((issue) => {
    let code: string
    if (typeof issue.code === 'string' && issue.code.length > 0) {
      code = `zod:${issue.code}`
    } else {
      code = 'zod:unknown'
      if (__DEV__ && !warnedZodCodeMissing) {
        warnedZodCodeMissing = true
        console.warn(
          '[@chemical-x/forms] zod-v4 adapter received an issue with no string `code`; ' +
            "stamping `'zod:unknown'`. This usually means a custom Zod plugin emitted " +
            'an issue without the standard code field.'
        )
      }
    }
    return {
      message: issue.message,
      path: issue.path.map((seg) => (typeof seg === 'number' ? seg : String(seg))),
      formKey,
      code,
    }
  })
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
