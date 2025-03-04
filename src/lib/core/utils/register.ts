import { get } from "lodash-es"
import { toRef, type Ref } from "vue"
import type { AbstractSchema, FieldTransformer, FormKey, FormStore, MetaTracker } from "../../../types/types-api"
import type { GenericForm } from "../../../types/types-core"
import { updateMetaTracker } from "../composables/use-meta-tracker-store"
import type { XModelValue } from "../directives/xmodel"
import { getForm } from "./get-value"

// undefined by default (defer to useForm global setting)
type RegisterContext<Input, Output> = {
  fieldTransformer?: undefined | boolean | FieldTransformer<Input, Output>
}

export function registerFactory<Form extends GenericForm>(
  formStore: Ref<FormStore<Form>>,
  formKey: FormKey,
  _schema: AbstractSchema<Form, Form>,
  metaTracker: Ref<MetaTracker>,
  setValue: (key: string, value: unknown) => boolean,
) {
  const form = getForm(formStore, formKey)
  // TODO: use context
  function registerLogic<Input, Output>(path: string, context?: RegisterContext<Input, Output>): XModelValue {
    console.log({ context })
    if (metaTracker.value?.[path] === undefined) {
      updateMetaTracker({
        basePath: path,
        metaTracker: metaTracker.value,
        rawValue: get(form, path),
      })
    }
    return {
      innerRef: toRef(() => metaTracker.value?.[path]?.rawValue),
      registerElement: (el) => {
        console.log("NOW WE CAN BUILD ELEMENT API\n\t>>\treceived an element from the xmodel directive!", el)
      },
      setValueWithInternalPath(value) {
        return setValue(path, value)
      },
    }
  }

  return registerLogic
}
