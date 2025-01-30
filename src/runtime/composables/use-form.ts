import type { z } from "zod"
import { useFormKey } from "../../lib/core/composables/use-form-key"
import { useFormStore } from "../../lib/core/composables/use-form-store"
import { getComputedSchema } from "../../lib/core/utils/get-computed-schema"
import type { UnwrapZodObject, UseFormConfigurationWithZod } from "../../lib/core/utils/types-adapters"
import type { AbstractSchema, UseFormConfiguration } from "../../lib/core/utils/types-api"
import type { DeepPartial, GenericForm } from "../../lib/core/utils/types-core"
import { zodAdapter } from "../adapters/zod"

function useAbstractForm<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<Form>
  >,
) {
  const { schema } = configuration
  const key = useFormKey(configuration.key)
  const computedSchema = getComputedSchema(key, schema)
  const initialStateResponse = computedSchema.getInitialState({
    useDefaultSchemaValues: true,
    constraints: configuration.initialState,
    validationMode: configuration.validationMode ?? "lax",
  })

  const {
    getHandleSubmitFactory,
    getValidateFactory,
    getValueFactory,
    setValueFactory,
    registerForm,
    form,
    formStore,
  } = useFormStore<Form>(key)
  registerForm(initialStateResponse.data)

  const getValue = getValueFactory<Form, GetValueFormType>(form)
  const setValue = setValueFactory(formStore, key, computedSchema)
  const validate = getValidateFactory(form, key, computedSchema)
  const handleSubmit = getHandleSubmitFactory(form, validate)

  return {
    handleSubmit,
    getValue,
    setValue,
    validate,
    key,
  }
}

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
