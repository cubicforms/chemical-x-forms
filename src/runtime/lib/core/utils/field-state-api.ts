import type { Ref } from "vue"
import { computed } from "vue"
import type { FieldState, FormSummaryValueRecord, MetaTracker } from "../../../types/types-api"
import type { CompleteFlatPath, GenericForm } from "../../../types/types-core"
import type { FieldStateStore } from "../composables/use-field-store"

export function fieldStateFactory<Form extends GenericForm>(formSummaryRecord: Readonly<FormSummaryValueRecord>, metaTracker: Ref<MetaTracker>, elementDOMStateStoreRef: Ref<FieldStateStore, FieldStateStore>) {
  function getFieldState<Path extends CompleteFlatPath<Form>>(path: Path) {
    return computed(() => {
      const metaTrackerValue = metaTracker.value[path] ?? {
        rawValue: null,
        updatedAt: null,
        isConnected: false,
      }
      const _elementDomState = elementDOMStateStoreRef.value[path]
      const clientFocused = _elementDomState?.focused ?? false
      const clientBlurred = _elementDomState?.blurred ?? true
      const clientTouched = _elementDomState?.touched ?? false
      const formSummary = formSummaryRecord[path] ?? { currentValue: "", dirty: false, pristine: true, originalValue: "", previousValue: "" }

      return {
        ...formSummary,
        focused: metaTrackerValue.isConnected ? clientFocused : null,
        blurred: metaTrackerValue.isConnected ? clientBlurred : null,
        touched: metaTrackerValue.isConnected ? clientTouched : null,
        meta: metaTrackerValue,
      } satisfies FieldState
    })
  }

  return getFieldState
}
