/**
 * `@chemical-x/forms/zod-v3` — Zod v3 adapter.
 *
 * This subpath is considered legacy; new projects should use
 * `@chemical-x/forms/zod` (v4 adapter) once v4 support lands. The two
 * adapters are physically isolated (separate directories, no cross-imports,
 * enforced by ESLint), so v3 can be removed in a future major without
 * touching v4 or the framework-agnostic core.
 *
 * Prerequisites: install `zod@^3`. The adapter's behavior assumes v3
 * internals (`_def.typeName`, `.unwrap()`, `.innerType()`); importing this
 * subpath against zod@4 will fail fast with a version-mismatch error.
 *
 * Usage:
 *
 *   import { useForm } from '@chemical-x/forms/zod-v3'
 *   import { z } from 'zod'
 *
 *   const { register, handleSubmit } = useForm({
 *     schema: z.object({ email: z.string().email() }),
 *     key: 'signup',
 *   })
 */

export { useForm } from './runtime/composables/use-form'
export { useFormContext } from './runtime/composables/use-form-context'
export { useRegister } from './runtime/composables/use-register'
export { zodAdapter } from './runtime/adapters/zod-v3'
export { isZodSchemaType } from './runtime/adapters/zod-v3/helpers'
export { CxErrorCode } from './runtime/core/error-codes'
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
