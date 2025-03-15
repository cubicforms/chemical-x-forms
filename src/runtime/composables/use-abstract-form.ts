import type { Ref } from "vue"
import type { FieldState } from "../lib/core/composables/use-field-store"
import { useElementStore } from "../lib/core/composables/use-field-store"
import { useFormKey } from "../lib/core/composables/use-form-key"
import { useFormStore } from "../lib/core/composables/use-form-store"
import { useMetaTrackerStore } from "../lib/core/composables/use-meta-tracker-store"
import { fieldStateFactory } from "../lib/core/utils/field-state-api"
import { getComputedSchema } from "../lib/core/utils/get-computed-schema"
import type { RegisterContext } from "../lib/core/utils/register"
import { registerFactory } from "../lib/core/utils/register"
import type { SetValuePayload } from "../lib/core/utils/set-value"
import type {
  AbstractSchema,
  CurrentValueContext,
  CurrentValueWithContext,
  FormKey,
  HandleSubmit,
  UseFormConfiguration,
  ValidationResponseWithoutValue,
  XModelValue,
} from "../types/types-api"
import type {
  DeepPartial,
  FlatPath,
  GenericForm,
  NestedType,
} from "../types/types-core"

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
): UseAbstractFormReturnType<Form, GetValueFormType> {
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
  const { getElementHelpers, fieldStateStore } = useElementStore()
  const register = registerFactory(
    formStore,
    key,
    computedSchema,
    metaTracker,
    setValue,
    getElementHelpers
  )

  const getFieldState = fieldStateFactory<Form>(
    formSummaryValues,
    metaTracker,
    fieldStateStore
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

export type UseAbstractFormReturnType<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form
> = {
  getFieldState: (path: FlatPath<Form, keyof Form, true>) => Ref<FieldState>
  handleSubmit: HandleSubmit<Form>
  getValue: {
    (): Readonly<Ref<GetValueFormType>>
    <Path extends FlatPath<Form>>(path: Path): Readonly<
      Ref<NestedType<GetValueFormType, Path>>
    >
    <WithMeta extends boolean>(
      context: CurrentValueContext<WithMeta>
    ): WithMeta extends true
      ? CurrentValueWithContext<GetValueFormType>
      : Readonly<Ref<GetValueFormType>>
    <Path extends FlatPath<Form>, WithMeta extends boolean>(
      path: Path,
      context: CurrentValueContext<WithMeta>
    ): WithMeta extends true
      ? CurrentValueWithContext<NestedType<GetValueFormType, Path>>
      : Readonly<Ref<NestedType<GetValueFormType, Path>>>
  }
  setValue: {
    <Value extends SetValuePayload<Form>>(value: Value): boolean
    <
      Path extends FlatPath<Form>,
      Value extends SetValuePayload<NestedType<Form, Path>>
    >(
      path: Path,
      value: Value
    ): boolean
  }
  validate: (
    path: string | undefined
  ) => Readonly<Ref<ValidationResponseWithoutValue<Form>>>
  register: (
    path: FlatPath<Form, keyof Form, true>,
    _context?: RegisterContext<typeof path, NestedType<Form, typeof path>>
  ) => XModelValue<NestedType<Form, typeof path> | undefined>
  key: FormKey
}
