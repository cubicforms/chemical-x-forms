/**
 * `@chemical-x/forms/zod` — Zod v4 adapter (recommended).
 *
 * Requires `zod@^4` in the consumer's project. If you're still on zod@3,
 * import from `@chemical-x/forms/zod-v3` instead.
 *
 * Usage:
 *
 *   import { useForm } from '@chemical-x/forms/zod'
 *   import { z } from 'zod'
 *
 *   const { register, handleSubmit, fieldErrors } = useForm({
 *     schema: z.object({ email: z.email() }),
 *     key: 'signup',
 *   })
 */

export {
  UnsupportedSchemaError,
  assertZodVersion,
  kindOf,
  useForm,
  zodAdapter,
} from './runtime/adapters/zod-v4'
export type { ZodKind } from './runtime/adapters/zod-v4'
