import type { z } from 'zod-v3'
import { zodAdapter } from '../adapters/zod-v3'
import type {
  AbstractSchema,
  UseAbstractFormReturnType,
  UseFormConfiguration,
} from '../types/types-api'
import type { DeepPartial, GenericForm } from '../types/types-core'
import type { TypeWithNullableDynamicKeys } from '../adapters/zod-v3/types-zod'
import type {
  UnwrapZodObject,
  UseFormConfigurationWithZod,
} from '../adapters/zod-v3/types-zod-adapter'
import { useAbstractForm } from './use-abstract-form'

// Overload the useForm type definition to signal that zod schemas have 1st class support
export function useForm<Form extends GenericForm, GetValueFormType extends GenericForm = Form>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<Form>
  >
): UseAbstractFormReturnType<Form, GetValueFormType>
export function useForm<
  Schema extends z.ZodObject<z.ZodRawShape>,
  GetValueFormType extends GenericForm = TypeWithNullableDynamicKeys<Schema>,
>(
  configuration: UseFormConfigurationWithZod<Schema, DeepPartial<z.infer<UnwrapZodObject<Schema>>>>
): UseAbstractFormReturnType<z.infer<UnwrapZodObject<Schema>>, GetValueFormType>
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
        DeepPartial<Form>
      >
    | UseFormConfigurationWithZod<Schema, DeepPartial<z.infer<UnwrapZodObject<Schema>>>>
): UseAbstractFormReturnType<Form, GetValueFormType> {
  function isZodType(value: unknown): value is z.ZodType {
    return typeof value === 'object' && value !== null && '_def' in value
  }

  const { schema } = configuration
  const abstractSchema = isZodType(schema)
    ? zodAdapter<Schema, Form, TypeWithNullableDynamicKeys<typeof schema>>(schema)
    : schema

  // Spread the full configuration so opt-in options (`onInvalidSubmit`,
  // `fieldValidation`, `persist`, `history`) reach useAbstractForm.
  // The explicit overrides below narrow schema / defaultValues /
  // validationMode to the shapes useAbstractForm expects. `key` is
  // intentionally NOT re-listed — the spread carries it through, and
  // writing `key: configuration.key` would re-introduce an explicit
  // `undefined` that `exactOptionalPropertyTypes` rejects against the
  // optional-key contract.
  return useAbstractForm<Form, GetValueFormType>({
    ...(configuration as UseFormConfiguration<
      Form,
      GetValueFormType,
      AbstractSchema<Form, GetValueFormType>,
      DeepPartial<Form>
    >),
    schema: abstractSchema,
    defaultValues: configuration.defaultValues as DeepPartial<Form>,
    validationMode: configuration.validationMode ?? 'strict',
  })
}
