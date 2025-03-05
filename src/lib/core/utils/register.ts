import { get } from "lodash-es"
import { toRef, type Ref } from "vue"
import type { AbstractSchema, FieldTransformer, FormKey, FormStore, MetaTracker } from "../../../types/types-api"
import type { GenericForm } from "../../../types/types-core"
import type { GetElementHelpers } from "../composables/use-element-store"
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
  getElementHelpers: GetElementHelpers,
) {
  const form = getForm(formStore, formKey)
  const elementHelperCache: Record<string, ReturnType<GetElementHelpers>> = {}
  // TODO: use context
  function registerLogic<Input, Output>(path: string, _context?: RegisterContext<Input, Output>): XModelValue {
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
        if (!(path in elementHelperCache)) {
          elementHelperCache[path] = getElementHelpers(path)
        }
        elementHelperCache[path].registerElement(el)
      },
      deregisterElement: (el) => {
        if (!(path in elementHelperCache)) {
          elementHelperCache[path] = getElementHelpers(path)
        }
        elementHelperCache[path].deregisterElement(el)
      },
      setValueWithInternalPath(value) {
        return setValue(path, value)
      },
    }
  }

  return registerLogic
}
