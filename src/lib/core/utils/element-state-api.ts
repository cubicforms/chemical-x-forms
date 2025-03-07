import type { Ref } from "vue"
import { computed } from "vue"
import type { FormSummaryValue, FormSummaryValueRecord, MetaTracker, MetaTrackerValue } from "../../../types/types-api"
import type { ElementDOMState, ElementDOMStateStore } from "../composables/use-element-store"

type ElementState = ElementDOMState & { meta: MetaTrackerValue } & FormSummaryValue

export function elementStateFactory(formSummaryRecord: Readonly<FormSummaryValueRecord>, metaTracker: Ref<MetaTracker>, elementDOMStateStoreRef: Ref<ElementDOMStateStore, ElementDOMStateStore>) {
  function getElementState(path: string) {
    return computed(() => {
      const metaTrackerValue = metaTracker.value[path] ?? {
        rawValue: null,
        updatedAt: undefined,
      }
      const _elementDomState = elementDOMStateStoreRef.value[path]
      const clientFocused = _elementDomState?.focused ?? false
      const clientBlurred = _elementDomState?.blurred ?? true
      const clientTouched = _elementDomState?.touched ?? false

      const elementDomState = {
        focused: metaTrackerValue.isConnected ? clientFocused : null,
        blurred: metaTrackerValue.isConnected ? clientBlurred : null,
        touched: metaTrackerValue.isConnected ? clientTouched : null,
      } satisfies ElementDOMState

      const formSummary = formSummaryRecord[path] ?? {}

      return {
        ...elementDomState,
        ...formSummary,
        meta: metaTrackerValue,
      } satisfies ElementState
    })
  }

  return getElementState
}
