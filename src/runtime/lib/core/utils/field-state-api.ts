import type { Ref } from "vue"
import { computed } from "vue"
import type { FormSummaryValueRecord, MetaTracker } from "../../../types/types-api"
import type { CompleteFlatPath, GenericForm } from "../../../types/types-core"
import type { FieldState, FieldStateStore } from "../composables/use-field-store"

export function fieldStateFactory<Form extends GenericForm>(formSummaryRecord: Readonly<FormSummaryValueRecord>, metaTracker: Ref<MetaTracker>, elementDOMStateStoreRef: Ref<FieldStateStore, FieldStateStore>) {
  function getFieldState<Path extends CompleteFlatPath<Form>>(path: Path) {
    return computed(() => {
      const metaTrackerValue = metaTracker.value[path] ?? {
        rawValue: null,
        updatedAt: undefined,
      }
      const _elementDomState = elementDOMStateStoreRef.value[path]
      const clientFocused = _elementDomState?.focused ?? false
      const clientBlurred = _elementDomState?.blurred ?? true
      const clientTouched = _elementDomState?.touched ?? false
      const formSummary = formSummaryRecord[path] ?? {}

      return {
        focused: metaTrackerValue.isConnected ? clientFocused : null,
        blurred: metaTrackerValue.isConnected ? clientBlurred : null,
        touched: metaTrackerValue.isConnected ? clientTouched : null,
        ...formSummary,
        meta: metaTrackerValue,
      } satisfies FieldState
    })
  }

  return getFieldState
}
