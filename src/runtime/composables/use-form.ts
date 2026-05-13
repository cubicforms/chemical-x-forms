import type { z } from 'zod-v3'
import { zodAdapter } from '../adapters/zod-v3'
import { InvalidUseFormConfigError } from '../core/errors'
import type { SchemaFactoryOptions } from '../core/get-computed-schema'
import type {
  AbstractSchema,
  FormKey,
  UseFormReturnType,
  UseFormConfiguration,
} from '../types/types-api'
import type { DeepPartial, DefaultValuesShape, GenericForm } from '../types/types-core'
import type { TypeWithNullableDynamicKeys } from '../adapters/zod-v3/types-zod'
import type {
  UnwrapZodObject,
  UseFormConfigurationWithZod,
} from '../adapters/zod-v3/types-zod-adapter'
import type { ReadShape } from '../adapters/zod-v3/types-read-shape'
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
export function useForm<Form extends GenericForm, GetValueFormType extends GenericForm = Form>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<DefaultValuesShape<Form>>
  >
): UseFormReturnType<Form, GetValueFormType>
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
  GetValueFormType extends GenericForm = TypeWithNullableDynamicKeys<Schema>,
>(
  configuration: UseFormConfigurationWithZod<
    Schema,
    DeepPartial<DefaultValuesShape<z.input<UnwrapZodObject<Schema>>>>
  >
): UseFormReturnType<
  z.input<UnwrapZodObject<Schema>>,
  GetValueFormType,
  ReadShape<Schema> extends GenericForm ? ReadShape<Schema> : never
>
export function useForm<
  Schema extends z.ZodSchema<unknown>,
  Form extends GenericForm = z.input<UnwrapZodObject<Schema>>,
  GetValueFormType extends GenericForm = Form,
>(
  configuration:
    | UseFormConfiguration<
        Form,
        GetValueFormType,
        AbstractSchema<Form, GetValueFormType>,
        DeepPartial<DefaultValuesShape<Form>>
      >
    | UseFormConfigurationWithZod<
        Schema,
        DeepPartial<DefaultValuesShape<z.input<UnwrapZodObject<Schema>>>>
      >
): UseFormReturnType<Form, GetValueFormType> {
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
  const abstractSchema = isZodType(schema)
    ? zodAdapter<Schema, Form, TypeWithNullableDynamicKeys<typeof schema>>(schema)
    : schema

  // Spread the full configuration so opt-in options (`onInvalidSubmit`,
  // `validateOn`, `debounceMs`, `persist`, `history`) reach useAbstractForm.
  // The explicit overrides below narrow schema / defaultValues to the
  // shapes useAbstractForm expects. `key` and `strict` are
  // intentionally NOT re-listed — the spread carries them through, and
  // writing `strict: configuration.strict ?? true` here would
  // short-circuit the registry's app-level defaults
  // (`createAttaform({ defaults: { strict: false } })`).
  // The library-level fallback to `true` lives downstream in
  // `createFormStore`, where it can apply *after* the registry merge.
  type Read = ReadShape<Schema> extends GenericForm ? ReadShape<Schema> : never
  return useAbstractForm<Form, GetValueFormType, Read>({
    ...(configuration as UseFormConfiguration<
      Form,
      GetValueFormType,
      AbstractSchema<Form, GetValueFormType>,
      DeepPartial<DefaultValuesShape<Form>>
    >),
    // The v3 adapter widens the read-side type through
    // `TypeWithNullableDynamicKeys<Schema>` (records/arrays/DUs get
    // `| undefined` markers); useAbstractForm's parameter expects the
    // exact `GetValueFormType` (defaults to `Form`). The runtime
    // accepts the widened shape unchanged — cast across the gap so
    // the structural disagreement doesn't reach the caller.
    schema: abstractSchema as
      | AbstractSchema<Form, GetValueFormType>
      | ((key: FormKey, options: SchemaFactoryOptions) => AbstractSchema<Form, GetValueFormType>),
    defaultValues: configuration.defaultValues as DeepPartial<DefaultValuesShape<Form>>,
  }) as unknown as UseFormReturnType<Form, GetValueFormType>
}
