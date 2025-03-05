import { get } from "lodash-es"
import type { ComputedRef, Ref } from "vue"
import { toRef } from "vue"
import type { MetaTracker, MetaTrackerValue } from "../../../types/types-api"
import type { GenericForm } from "../../../types/types-core"
import type { ElementDOMState, ElementDOMStateStore } from "../composables/use-element-store"

type ElementState<Value = unknown> = ElementDOMState & { value: Value | undefined, meta: MetaTrackerValue }

export function elementStateFactory<
  Form extends GenericForm
>(form: ComputedRef<Form>, metaTracker: Ref<MetaTracker>, elementDOMStateStoreRef: Ref<ElementDOMStateStore, ElementDOMStateStore>) {
  function getElementState<Value = unknown>(path: string): Ref<ElementState<Value>> {
    return toRef(() => {
      const elementDomState = elementDOMStateStoreRef.value[path] ?? { focused: null, blurred: null }
      const metaTrackerValue = metaTracker.value[path] ?? { rawValue: null, updatedAt: undefined }
      const formValue = get(form.value, path) as Value | undefined
      return {
        ...elementDomState,
        meta: metaTrackerValue,
        value: formValue,
      }
    })
  }

  return getElementState
}
