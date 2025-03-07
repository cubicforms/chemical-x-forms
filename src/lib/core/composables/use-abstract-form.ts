import type {
  AbstractSchema,
  UseFormConfiguration,
} from "../../../types/types-api"
import type { DeepPartial, GenericForm } from "../../../types/types-core"
import { elementStateFactory } from "../utils/element-state-api"
import { getComputedSchema } from "../utils/get-computed-schema"
import { registerFactory } from "../utils/register"
import { useElementStore } from "./use-element-store"
import { useFormKey } from "./use-form-key"
import { useFormStore } from "./use-form-store"
import { useMetaTrackerStore } from "./use-meta-tracker-store"

export function useAbstractForm<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form
>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<Form>
  >
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
    formSummaryValues,
    getValueFactory,
    setValueFactory,
    registerForm,
    formStore,
    form,
  } = useFormStore<Form>(key, initialStateResponse)
  registerForm(initialStateResponse.data)

  const { metaTracker } = useMetaTrackerStore(key)
  const getValue = getValueFactory<Form, GetValueFormType>(form, metaTracker)
  const setValue = setValueFactory(formStore, key, computedSchema, metaTracker)
  const validate = getValidateFactory(form, key, computedSchema)
  const handleSubmit = getHandleSubmitFactory(form, validate)
  const { getElementHelpers, elementDOMStateStoreRef } = useElementStore()
  const register = registerFactory(
    formStore,
    key,
    computedSchema,
    metaTracker,
    setValue,
    getElementHelpers,
  )

  const getState = elementStateFactory(formSummaryValues, metaTracker, elementDOMStateStoreRef)

  return {
    handleSubmit,
    getState,
    getValue,
    setValue,
    validate,
    register,
    key,
  }
}
