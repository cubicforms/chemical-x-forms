import { useDOMFieldStateStore } from '../lib/core/composables/use-field-state-store'
import { useFormKey } from '../lib/core/composables/use-form-key'
import { useFormStore } from '../lib/core/composables/use-form-store'
import { useMetaTrackerStore } from '../lib/core/composables/use-meta-tracker-store'
import { fieldStateFactory } from '../lib/core/utils/field-state-api'
import { getComputedSchema } from '../lib/core/utils/get-computed-schema'
import { registerFactory } from '../lib/core/utils/register'
import type {
  AbstractSchema,
  UseAbstractFormReturnType,
  UseFormConfiguration,
} from '../types/types-api'
import type { DeepPartial, GenericForm } from '../types/types-core'

export function useAbstractForm<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<Form>
  >
): UseAbstractFormReturnType<Form, GetValueFormType> {
  const { schema } = configuration
  const key = useFormKey(configuration.key)
  const computedSchema = getComputedSchema(key, schema)
  const initialStateResponse = computedSchema.getInitialState({
    useDefaultSchemaValues: true,
    constraints: configuration.initialState,
    validationMode: configuration.validationMode ?? 'lax',
  })

  const {
    getHandleSubmitFactory,
    getValidateFactory,
    formSummaryValues,
    getValueFactory,
    setValueFactory,
    formStore,
    form,
  } = useFormStore<Form>(key, initialStateResponse)

  const { metaTracker } = useMetaTrackerStore(key)
  const getValue = getValueFactory<Form, GetValueFormType>(form, metaTracker)
  const setValue = setValueFactory(formStore, key, computedSchema, metaTracker)
  const validate = getValidateFactory(form, key, computedSchema)
  const handleSubmit = getHandleSubmitFactory(form, validate)
  const { getElementHelpers, domFieldStateStore } = useDOMFieldStateStore(form)
  const register = registerFactory(
    formStore,
    key,
    computedSchema,
    metaTracker,
    setValue,
    getElementHelpers
  )

  const getFieldState = fieldStateFactory<Form>(
    formSummaryValues.value,
    metaTracker,
    domFieldStateStore,
    key
  )

  return {
    getFieldState,
    handleSubmit,
    getValue,
    setValue,
    validate,
    register,
    key,
  } satisfies UseAbstractFormReturnType<Form, GetValueFormType>
}

// create an alias for conditional import in the consumer app
export { useAbstractForm as useForm }
