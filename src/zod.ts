/**
 * `attaform/zod` — Zod v4 adapter (recommended).
 *
 * Requires `zod@^4` in the consumer's project. If you're still on zod@3,
 * import from `attaform/zod-v3` instead.
 *
 * Usage:
 *
 *   import { useForm } from 'attaform/zod'
 *   import { z } from 'zod'
 *
 *   const { register, handleSubmit, errors } = useForm({
 *     schema: z.object({ email: z.email() }),
 *     key: 'signup',
 *   })
 */

export { UnsupportedSchemaError, useForm, zodAdapter } from './runtime/adapters/zod-v4'
// injectForm is schema-agnostic — the consumer supplies the Form
// generic — so re-exporting from the /zod subpath is purely for
// discoverability alongside useForm.
export { injectForm } from './runtime/composables/use-form-context'
export { useRegister } from './runtime/composables/use-register'
export { AttaformErrorCode } from './runtime/core/error-codes'
export { unset, isUnset } from './runtime/core/unset'
export type { Unset } from './runtime/core/unset'
