/**
 * `attaform/zod-v3` — Zod v3 adapter for projects on Zod 3. New projects
 * should reach for `attaform/zod` (v4 adapter). The two adapters are
 * physically isolated (separate directories, no cross-imports, enforced
 * by ESLint).
 *
 * Prerequisites: install `zod@^3`. The adapter's behavior assumes v3
 * internals (`_def.typeName`, `.unwrap()`, `.innerType()`); importing this
 * subpath against zod@4 will fail fast with a version-mismatch error.
 *
 * Usage:
 *
 *   import { useForm } from 'attaform/zod-v3'
 *   import { z } from 'zod'
 *
 *   const { register, handleSubmit } = useForm({
 *     schema: z.object({ email: z.string().email() }),
 *     key: 'signup',
 *   })
 */

export { useForm } from './runtime/composables/use-form'
export { injectForm } from './runtime/composables/use-form-context'
export { useRegister } from './runtime/composables/use-register'
export { zodAdapter } from './runtime/adapters/zod-v3'
export { isZodSchemaType } from './runtime/adapters/zod-v3/helpers'
export { AttaformErrorCode } from './runtime/core/error-codes'
export { unset, isUnset } from './runtime/core/unset'
export type { Unset } from './runtime/core/unset'
export type {
  TypeWithNullableDynamicKeys,
  ZodTypeWithInnerType,
} from './runtime/adapters/zod-v3/types-zod'
export type {
  UnwrapZodObject,
  UseFormConfigurationWithZod,
} from './runtime/adapters/zod-v3/types-zod-adapter'
export { fieldMeta, withMeta } from './runtime/adapters/zod-v3/field-meta'
export type { FieldMetaPayload } from './runtime/core/field-meta'
