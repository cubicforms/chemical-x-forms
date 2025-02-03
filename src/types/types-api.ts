import type { DeepPartial, GenericForm, NestedType } from "./types-core"

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
}

export type FormStore<TData extends GenericForm> = Map<FormKey, TData>

// values are user driven (hence the `unknown` type annotation)
export type InputTracker<V = unknown> = Record<string, V>
export type InputTrackerStore = Map<FormKey, InputTracker>

type OnSubmit<Form extends GenericForm> = (form: Form) => void | Promise<void>
type OnError = (error: ValidationError[]) => void | Promise<void>

export type HandleSubmit<Form extends GenericForm> = (
  onSubmit: OnSubmit<Form>,
  onError?: OnError,
) => Promise<void>
