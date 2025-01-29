import { useFormKey } from "../helper-composables/use-form-key"
import { useFormStore } from "../helper-composables/use-form-store"
import { getComputedSchema } from "../utils/get-computed-schema"
import type { AbstractSchema, UseFormConfiguration } from "../utils/types-api"
import type { DeepPartial, GenericForm } from "../utils/types-core"

export const useForm = <
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<Form>
  >,
) => {
  console.log("A")
  const { schema } = configuration
  console.log("A2")
  const key = useFormKey(configuration.key)
  console.log("A3")
  const computedSchema = getComputedSchema(key, schema)
  console.log("A4")
  const initialStateResponse = computedSchema.getInitialState({
    useDefaultSchemaValues: true,
    constraints: configuration.initialState,
    validationMode: configuration.validationMode ?? "lax",
  })

  console.log("A5")
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
