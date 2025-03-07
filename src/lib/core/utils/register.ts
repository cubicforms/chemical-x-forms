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
    return {
      innerRef: toRef(() => metaTracker.value?.[path]?.rawValue),
      registerElement: (el) => {
        // use the metaTracker to invalidate the cache automatically on remount
        if (!(path in elementHelperCache) || !metaTracker.value[path].isConnected) {
          elementHelperCache[path] = getElementHelpers(path)
        }
        const success = elementHelperCache[path].registerElement(el)
        if (success) {
          updateMetaTracker({
            basePath: path,
            metaTracker: metaTracker.value,
            rawValue: metaTracker.value?.[path]?.rawValue ?? get(form, path),
            updateTime: false,
            isConnected: true,
          })
        }
      },
      deregisterElement: (el) => {
        if (!(path in elementHelperCache)) {
          elementHelperCache[path] = getElementHelpers(path)
        }
        const remainingElementCount = elementHelperCache[path].deregisterElement(el)
        console.log("number of remaining elements", remainingElementCount)
        updateMetaTracker({
          basePath: path,
          metaTracker: metaTracker.value,
          rawValue: metaTracker.value?.[path]?.rawValue ?? get(form, path),
          updateTime: false, // for consistency, only recompute `updatedAt` when form value changes
          isConnected: !!remainingElementCount, // only mark as disconnected if all elements are unmounted
        })
      },
      setValueWithInternalPath(value) {
        return setValue(path, value)
      },
    }
  }

  return registerLogic
}
