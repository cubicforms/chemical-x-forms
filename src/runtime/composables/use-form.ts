import type { z } from "zod"
import { useAbstractForm } from "../../lib/core/composables/use-abstract-form"
import type { UnwrapZodObject, UseFormConfigurationWithZod } from "../../types/types-adapters"
import type { AbstractSchema, UseFormConfiguration } from "../../types/types-api"
import type { DeepPartial, GenericForm } from "../../types/types-core"
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
  Schema extends z.ZodType<unknown>,
  Form extends GenericForm = z.infer<UnwrapZodObject<Schema>>,
  GetValueFormType extends GenericForm = Form,
>(
  configuration: UseFormConfigurationWithZod<
    Schema,
    Form,
    DeepPartial<Form>
  >,
): UseFormReturnType<Form, GetValueFormType>
export function useForm<
  Schema extends z.ZodType<unknown>,
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
    Form,
    DeepPartial<Form>
  >,
): UseFormReturnType<Form, GetValueFormType> {
  function isZodType(value: unknown): value is z.ZodType {
    return typeof value === "object" && value !== null && "_def" in value
  }

  const { schema } = configuration

  if (isZodType(schema)) {
    // Explicitly cast the output of zodAdapter to match the expected type
    const abstractSchema = zodAdapter(schema) as unknown as AbstractSchema<Form, GetValueFormType>

    const useFormResponse = useAbstractForm<Form, GetValueFormType>({
      schema: abstractSchema,
      initialState: configuration.initialState,
      key: configuration.key,
      validationMode: configuration.validationMode,
    })
    return useFormResponse
  }

  return useAbstractForm<Form, GetValueFormType>({
    schema: schema,
    initialState: configuration.initialState,
    key: configuration.key,
    validationMode: configuration.validationMode,
  })
}
