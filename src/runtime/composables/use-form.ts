import type { z } from 'zod-v3'
import { zodAdapter } from '../adapters/zod-v3'
import type { AbstractSchema, UseFormReturnType, UseFormConfiguration } from '../types/types-api'
import type { DeepPartial, DefaultValuesShape, GenericForm } from '../types/types-core'
import type { TypeWithNullableDynamicKeys } from '../adapters/zod-v3/types-zod'
import type {
  UnwrapZodObject,
  UseFormConfigurationWithZod,
} from '../adapters/zod-v3/types-zod-adapter'
import { useAbstractForm } from './use-abstract-form'

/**
 * Create a form bound to a custom `AbstractSchema` adapter.
 *
 * ```ts
 * import { useForm } from 'decant/zod-v3'
 *
 * const form = useForm({ schema: myAdapter, defaultValues: { … } })
 * ```
 *
 * For Zod schemas, prefer the overload that accepts a `ZodObject`
 * directly — it wraps the adapter automatically. For Zod v4, import
 * from `decant/zod` instead.
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
 * import { useForm } from 'decant/zod-v3'
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
 * For Zod v4, import from `decant/zod` instead.
 */
export function useForm<
  Schema extends z.ZodObject<z.ZodRawShape>,
  GetValueFormType extends GenericForm = TypeWithNullableDynamicKeys<Schema>,
>(
  configuration: UseFormConfigurationWithZod<
    Schema,
    DeepPartial<DefaultValuesShape<z.infer<UnwrapZodObject<Schema>>>>
  >
): UseFormReturnType<z.infer<UnwrapZodObject<Schema>>, GetValueFormType>
export function useForm<
  Schema extends z.ZodSchema<unknown>,
  Form extends GenericForm = z.infer<UnwrapZodObject<Schema>>,
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
        DeepPartial<DefaultValuesShape<z.infer<UnwrapZodObject<Schema>>>>
      >
): UseFormReturnType<Form, GetValueFormType> {
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
  // (`createDecant({ defaults: { strict: false } })`).
  // The library-level fallback to `true` lives downstream in
  // `createFormStore`, where it can apply *after* the registry merge.
  return useAbstractForm<Form, GetValueFormType>({
    ...(configuration as UseFormConfiguration<
      Form,
      GetValueFormType,
      AbstractSchema<Form, GetValueFormType>,
      DeepPartial<DefaultValuesShape<Form>>
    >),
    schema: abstractSchema,
    defaultValues: configuration.defaultValues as DeepPartial<DefaultValuesShape<Form>>,
  })
}
