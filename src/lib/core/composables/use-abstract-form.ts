import type { AbstractSchema, UseFormConfiguration } from "../../../types/types-api"
import type { DeepPartial, GenericForm } from "../../../types/types-core"
import { getComputedSchema } from "../utils/get-computed-schema"
import { registerFactory } from "../utils/register"
import { useFormKey } from "./use-form-key"
import { useFormStore } from "./use-form-store"
import { useMetaTrackerStore } from "./use-meta-tracker-store"

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
  const { getMetaTracker } = useMetaTrackerStore(key, configuration.initialState ?? {})
  const metaTracker = getMetaTracker()
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
    formStore,
    form,
  } = useFormStore<Form>(key)
  registerForm(initialStateResponse.data)

  const getValue = getValueFactory<Form, GetValueFormType>(form, metaTracker)
  const setValue = setValueFactory(formStore, key, computedSchema, metaTracker)
  const validate = getValidateFactory(form, key, computedSchema)
  const handleSubmit = getHandleSubmitFactory(form, validate)
  const register = registerFactory(key, computedSchema)

  return {
    handleSubmit,
    getValue,
    setValue,
    validate,
    register,
    key,
  }
}
