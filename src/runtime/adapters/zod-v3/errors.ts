import { AttaformError } from '../../core/errors'

/**
 * Thrown when a zod-v3 schema includes a kind the form library cannot
 * represent: `z.promise`, `z.function`, `z.map`, `z.symbol`, or a
 * recursive `z.lazy(...)` that loops back into itself.
 *
 * The error message includes the dotted path of the offending node
 * so you can locate it without traversing the whole schema. Mirrors
 * the v4 adapter's `UnsupportedSchemaError` so consumers see the same
 * failure shape across adapters.
 */
export class UnsupportedSchemaError extends AttaformError {}
