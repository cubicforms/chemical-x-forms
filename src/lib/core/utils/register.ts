import type { AbstractSchema, FieldTransformer, FormKey } from "../../../types/types-api"
import type { GenericForm } from "../../../types/types-core"

// undefined by default (defer to useForm global setting)
type RegisterContext<Input, Output> = {
  fieldTransformer?: undefined | boolean | FieldTransformer<Input, Output>
}

type AbstractHTMLEvent = { target?: { value: unknown } }

type RegisterReturnType = {
  "@input": (e: AbstractHTMLEvent) => void
}

export function registerFactory<Form extends GenericForm>(
  formKey: FormKey,
  _schema: AbstractSchema<Form, Form>,
) {
  function registerLogic<Input, Output>(path: string, context?: RegisterContext<Input, Output>) {
    return { "@input": (e) => {
      console.log(e.target?.value, { path, context, formKey })
    } } satisfies RegisterReturnType
  }

  return registerLogic
}
