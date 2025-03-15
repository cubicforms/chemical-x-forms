import type { Ref } from "vue"
import type { DeepPartial, FlatPath, GenericForm, NestedType } from "./types-core"

export type ValidationError = {
  message: string
  path: (string | number)[]
  formKey: FormKey
}

export type ValidationResponseSuccess<TData> = {
  data: TData
  errors: undefined
  success: true
  formKey: FormKey
}
export type ValidationResponseErrorWithoutData = {
  data: undefined
  errors: ValidationError[]
  success: false
  formKey: FormKey
}
export type ValidationResponseErrorWithData<TData> = {
  data: TData
  errors: ValidationError[]
  success: false
  formKey: FormKey
}

export type ValidationResponse<TData> =
  | ValidationResponseSuccess<TData>
  | ValidationResponseErrorWithData<TData>
  | ValidationResponseErrorWithoutData

export type InitialStateResponse<TData> =
  | ValidationResponseSuccess<TData>
  | ValidationResponseErrorWithData<TData>

export type ValidationResponseWithoutValue<Form> = Omit<
  ValidationResponse<Form>,
  "data"
>

// strict: validate the data against the provided schema
// lax: ONLY validate the shape of the data against the schema
export type ValidationMode = "strict" | "lax"

type GetInitialStateConfig<Form> = {
  useDefaultSchemaValues: boolean
  validationMode?: ValidationMode
  constraints?: DeepPartial<Form> | undefined
}

export type AbstractSchema<Form, GetValueFormType> = {
  getInitialState(
    config: GetInitialStateConfig<Form>,
  ): InitialStateResponse<Form>
  getSchemasAtPath(
    path: string,
  ): AbstractSchema<NestedType<Form, typeof path>, GetValueFormType>[]
  validateAtPath(
    data: unknown,
    path: string | undefined,
  ): ValidationResponse<Form>
}

export type FormKey = string

export type UseFormConfiguration<
  Form extends GenericForm,
  GetValueFormType,
  Schema extends AbstractSchema<Form, GetValueFormType>,
  InitialState extends DeepPartial<Form>,
> = {
  schema: Schema | ((key: FormKey) => Schema)
  key?: FormKey
  initialState?: InitialState
  validationMode?: ValidationMode
  useFieldTransformer?: boolean
}

export type FieldTransformer<Input, Output> = (input: Input) => Output

export type FormStore<TData extends GenericForm> = Map<FormKey, TData>

export type FormSummaryValue = {
  originalValue: unknown
  previousValue: unknown
  currentValue: unknown
  pristine: boolean
  dirty: boolean
}
export type FormSummaryValueRecord = Record<string, FormSummaryValue>
export type FormSummaryStore = Map<FormKey, FormSummaryValueRecord>

export type OnSubmit<Form extends GenericForm> = (form: Form) => void | Promise<void>
export type OnError = (error: ValidationError[]) => void | Promise<void>

export type HandleSubmit<Form extends GenericForm> = (
  onSubmit: OnSubmit<Form>,
  onError?: OnError,
) => Promise<void>

export type MetaTrackerValue = {
  updatedAt: string | null
  rawValue: unknown
  isConnected: boolean
}
export type MetaTracker = Record<string, MetaTrackerValue>
export type MetaTrackerStore = Map<FormKey, MetaTracker>

export type CurrentValueContext<WithMeta extends boolean = false> = {
  withMeta?: WithMeta
}

type RemapLeafNodes<T, V, Q = NonNullable<T>> = Q extends Record<string, unknown> ? { [K in keyof Q]: RemapLeafNodes<Q[K], V> } : (Q extends Array<infer U> ? Array<RemapLeafNodes<U, V>> : V)

export type CurrentValueWithContext<Value, FormSubtree = Value> = {
  currentValue: Readonly<Ref<Value>>
  meta: Readonly<Ref<DeepPartial<RemapLeafNodes<FormSubtree, MetaTrackerValue>>>>
}

export type XModelValue<Value = unknown> = {
  innerRef: Readonly<Ref<Value>>
  registerElement: (el: HTMLElement) => void
  deregisterElement: (el: HTMLElement) => void
  setValueWithInternalPath: (value: unknown) => boolean
}

// undefined by default (defer to useForm global setting)
export type RegisterContext<Input, Output> = {
  fieldTransformer?: undefined | boolean | FieldTransformer<Input, Output>
}

export type SetValueCallback<Payload> = (
  value: DeepPartial<Payload>,
) => DeepPartial<Payload>
export type SetValuePayload<Payload> = DeepPartial<Payload> | SetValueCallback<Payload>

export type DOMFieldState =
  | {
    focused: boolean | null
    blurred: boolean | null
    touched: boolean | null
  }

type DeepFlatten<T> =
  // If it's not an object, just leave it as-is
  T extends object
    ? {
        // Re-map every property key of T
        [K in keyof T]: DeepFlatten<T[K]>
      }
    : T
export type FieldState = DeepFlatten<DOMFieldState & { meta: MetaTrackerValue } & FormSummaryValue>

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
