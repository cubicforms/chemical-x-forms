import type { AbstractSchema, UseFormConfiguration } from "../../../types/types-api"
import type { DeepPartial, GenericForm } from "../../../types/types-core"
import { getComputedSchema } from "../utils/get-computed-schema"
import { useFormKey } from "./use-form-key"
import { useFormStore } from "./use-form-store"
import { useInputTrackerStore } from "./use-input-tracker-store"

export function useAbstractForm<
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

  const { getInputTracker } = useInputTrackerStore(key)
  const inputTracker = getInputTracker()
  const getValue = getValueFactory<Form, GetValueFormType>(form)
  const setValue = setValueFactory(formStore, key, computedSchema, inputTracker)
  const validate = getValidateFactory(form, key, computedSchema)
  const handleSubmit = getHandleSubmitFactory(form, validate)

  return {
    handleSubmit,
    getValue,
    setValue,
    validate,
    key,
    inputTracker,
  }
}
