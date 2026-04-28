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
// useFormContext is schema-agnostic — the consumer supplies the Form
// generic — so re-exporting from the /zod subpath is purely for
// discoverability alongside useForm.
export { useFormContext } from './runtime/composables/use-form-context'
export { useRegister } from './runtime/composables/use-register'
export { unset, isUnset } from './runtime/core/unset'
export type { Unset } from './runtime/core/unset'
