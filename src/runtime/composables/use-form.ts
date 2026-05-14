import type { z } from 'zod-v3'
import { zodAdapter } from '../adapters/zod-v3'
import { InvalidUseFormConfigError } from '../core/errors'
import type {
  AbstractSchema,
  FormKey,
  UseFormReturnType,
  UseFormConfiguration,
} from '../types/types-api'
import type { DefaultValuesInput, GenericForm } from '../types/types-core'
import type {
  UnwrapZodObject,
  UseFormConfigurationWithZod,
} from '../adapters/zod-v3/types-zod-adapter'
import type { StorageShape } from '../adapters/zod-v3/types-storage-shape'
import { useAbstractForm } from './use-abstract-form'

/**
 * Create a form bound to a custom `AbstractSchema` adapter.
 *
 * ```ts
 * import { useForm } from 'attaform/zod-v3'
 *
 * const form = useForm({ schema: myAdapter, defaultValues: { … } })
 * ```
 *
 * For Zod schemas, prefer the overload that accepts a `ZodObject`
 * directly — it wraps the adapter automatically. For Zod v4, import
 * from `attaform/zod` instead.
 */
export function useForm<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
  K extends FormKey = FormKey,
>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DefaultValuesInput<Form>,
    K
  >
): UseFormReturnType<Form, GetValueFormType, Form, K>
/**
 * Create a form bound to a Zod v3 `ZodObject` schema.
 *
 * ```ts
 * import { useForm } from 'attaform/zod-v3'
 * import { z } from 'zod'
 *
 * const form = useForm({
 *   schema: z.object({
 *     email: z.string().email(),
 *     password: z.string().min(8),
 *   }),
 *   defaultValues: { email: '' },
 *   validateOn: 'blur',
 * })
 * ```
 *
 * Returns a form API exposing `register`, `values`, `errors`,
 * `fields`, `setValue`, `handleSubmit`, `meta`, field-array
 * helpers, and more. See `UseFormReturnType` for the full
 * surface.
 *
 * For Zod v4, import from `attaform/zod` instead.
 */
export function useForm<
  Schema extends z.ZodObject<z.ZodRawShape>,
  GetValueFormType extends GenericForm = z.output<UnwrapZodObject<Schema>> extends GenericForm
    ? z.output<UnwrapZodObject<Schema>>
    : never,
  K extends FormKey = FormKey,
>(
  configuration: UseFormConfigurationWithZod<
    Schema,
    DefaultValuesInput<z.input<UnwrapZodObject<Schema>>>,
    K
  >
): UseFormReturnType<
  z.input<UnwrapZodObject<Schema>>,
  GetValueFormType,
  StorageShape<UnwrapZodObject<Schema>> extends GenericForm
    ? StorageShape<UnwrapZodObject<Schema>>
    : never,
  K
>
// Untyped impl signature. The two overloads above are the public typed
// contract; this signature exists only so the body has somewhere to
// land. Keeping it untyped severs the overload-vs-impl reconciliation
// that would otherwise force every overload return to round-trip
// through `WriteShape`'s primitive-widening idempotence — a constraint
// that blocks fusing `LiftedValueShape` into `WriteShape` because the
// union-distribution arm breaks that idempotence on discriminated
// unions.
//
// Type safety inside the body comes from the inner helpers
// (`zodAdapter`, `useAbstractForm`) inferring from runtime values; the
// public surface that consumers see comes from the overloads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useForm(configuration: any): any {
  // Foot-gun guard: catches `useForm(z.object({...}))` (raw schema as
  // the first arg — its `.schema` field is undefined), `useForm()` (no
  // args), and `useForm({ schema: undefined })` before they reach the
  // adapter and crash deep with an opaque message.
  if (
    configuration === undefined ||
    configuration === null ||
    (configuration as { schema?: unknown }).schema === undefined
  ) {
    throw new InvalidUseFormConfigError()
  }

  function isZodType(value: unknown): value is z.ZodType {
    return typeof value === 'object' && value !== null && '_def' in value
  }

  const { schema } = configuration
  const abstractSchema = isZodType(schema) ? zodAdapter(schema) : schema

  // Spread the full configuration so opt-in options (`onInvalidSubmit`,
  // `validateOn`, `debounceMs`, `persist`, `history`, `key`, `strict`)
  // reach useAbstractForm. Writing `strict: configuration.strict ?? true`
  // here would short-circuit the registry's app-level defaults
  // (`createAttaform({ defaults: { strict: false } })`). The
  // library-level fallback to `true` lives downstream in
  // `createFormStore`, where it can apply *after* the registry merge.
  return useAbstractForm({
    ...configuration,
    schema: abstractSchema,
    defaultValues: configuration.defaultValues,
  })
}
