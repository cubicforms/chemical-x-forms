/**
 * `attaform/zod-v3` — explicit Zod v3 adapter subpath.
 *
 * Use this when you want to pin the v3 adapter regardless of what
 * other tooling resolves. Bundles ship a single adapter (no runtime
 * dispatch) — handy for non-Vite bundlers (webpack, esbuild standalone,
 * Rollup) where you'd otherwise pay for both adapters via the unified
 * `attaform/zod` entry's runtime fallback.
 *
 * Most Vite consumers should import from `attaform/zod` instead — the
 * `attaform/vite` plugin rewrites that import to this subpath at build
 * time when zod@^3 is detected, so the same lean bundle ships with
 * less ceremony.
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
export { useStepper } from './runtime/composables/use-stepper'
export type {
  AggregateError,
  AnyForm,
  FormKeyOf,
  FormStatus,
  KeysOf,
  Statuses,
  StepperHistoryConfig,
  StepperNavOptions,
  StepperOptions,
  StepperStatusesProxy,
  UseStepperReturnType,
} from './runtime/types/types-stepper'
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
