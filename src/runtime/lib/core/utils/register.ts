import { get } from "lodash-es"
import { toRef, type Ref } from "vue"
import type {
  AbstractSchema,
  FormKey,
  FormStore,
  MetaTracker,
  RegisterContext,
  RegisterValue
} from "../../../types/types-api"
import type { FlatPath, GenericForm, NestedType } from "../../../types/types-core"
import type { GetElementHelpers } from "../composables/use-field-state-store"
import { updateMetaTracker } from "../composables/use-meta-tracker-store"
import { getForm } from "./get-value"

export function registerFactory<Form extends GenericForm>(
  formStore: Ref<FormStore<Form>>,
  formKey: FormKey,
  _schema: AbstractSchema<Form, Form>,
  metaTracker: Ref<MetaTracker>,
  setValue: (key: string, value: unknown) => boolean,
  getElementHelpers: GetElementHelpers
) {
  const form = getForm(formStore, formKey)
  const elementHelperCache: Record<string, ReturnType<GetElementHelpers>> = {}
  // TODO: use context
  function registerLogic(
    path: FlatPath<Form, keyof Form, true>,
    _context?: RegisterContext<typeof path, NestedType<Form, typeof path>>
  ): RegisterValue<NestedType<Form, typeof path> | undefined> {
    if (import.meta.server) {
      updateMetaTracker({
        formKey,
        basePath: path,
        metaTracker: metaTracker.value,
        rawValue: get(form, path),
        updateTime: false,
        isConnected: true, // computing eagerly on the server
      })
    }
    return {
      innerRef: toRef(
        () => (metaTracker.value?.[path]?.rawValue ?? get(form, path)) as NestedType<Form, typeof path> | undefined
      ),
      registerElement: (el) => {
        if (
          !(path in elementHelperCache)
          || !metaTracker.value[path]?.isConnected
        ) {
          elementHelperCache[path] = getElementHelpers(path)
        }
        const success = elementHelperCache[path]?.registerElement(el)
        if (success) {
          updateMetaTracker({
            formKey,
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
        const remainingElementCount
          = elementHelperCache[path]?.deregisterElement(el)
        updateMetaTracker({
          formKey,
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
