import type { z } from "zod"
import { useAbstractForm } from "../../lib/core/composables/use-abstract-form"
import type { AbstractSchema, UseFormConfiguration } from "../../types/types-api"
import type { DeepPartial, GenericForm } from "../../types/types-core"
import type { TypeWithNullableDynamicKeys } from "../../types/types-zod"
import type { UnwrapZodObject, UseFormConfigurationWithZod } from "../../types/types-zod-adapter"
import { zodAdapter } from "../adapters/zod"

type UseFormReturnType<Form extends GenericForm, GetValueFormType extends GenericForm = Form> = ReturnType<typeof useAbstractForm<
  Form,
  GetValueFormType
>>

// Overload the useForm type definition to signal that zod schemas have 1st class support
export function useForm<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<Form>
  >,
): UseFormReturnType<Form, GetValueFormType>
export function useForm<
  Schema extends z.ZodObject<z.ZodRawShape>,
  GetValueFormType extends GenericForm = TypeWithNullableDynamicKeys<Schema>
>(
  configuration: UseFormConfigurationWithZod<
    Schema,
    DeepPartial<z.infer<UnwrapZodObject<Schema>>>
  >,
): UseFormReturnType<z.infer<UnwrapZodObject<Schema>>, GetValueFormType>
export function useForm<
  Schema extends z.ZodSchema<unknown>,
  Form extends GenericForm = z.infer<UnwrapZodObject<Schema>>,
  GetValueFormType extends GenericForm = Form,
>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<Form>
  > | UseFormConfigurationWithZod<
    Schema,
    DeepPartial<z.infer<UnwrapZodObject<Schema>>>
  >,
): UseFormReturnType<Form, GetValueFormType> {
  function isZodType(value: unknown): value is z.ZodType {
    return typeof value === "object" && value !== null && "_def" in value
  }

  const { schema } = configuration
  const abstractSchema = isZodType(schema)
    ? zodAdapter<
        Schema,
        Form,
        TypeWithNullableDynamicKeys<typeof schema>
      >(schema)
    : schema

  return useAbstractForm<Form, GetValueFormType>({
    schema: abstractSchema,
    initialState: configuration.initialState as DeepPartial<Form>,
    key: configuration.key,
    validationMode: configuration.validationMode,
  })
}
