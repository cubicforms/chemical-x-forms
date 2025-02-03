import { useState } from "#app"
import type { FormKey, InputTrackerStore } from "../../../types/types-api"

export function useInputTrackerStore(formKey: FormKey) {
  const formInputTrackerStore = useState<InputTrackerStore>("useform/inputstore", () => new Map())

  function registerInputTracker() {
    if (formInputTrackerStore.value.has(formKey)) return

    formInputTrackerStore.value.set(formKey, {})
  }

  registerInputTracker()

  function getInputTracker() {
    const inputTracker = formInputTrackerStore.value.get(formKey)
    if (!inputTracker) {
      throw new Error(`Could not find an input tracker with form key '${formKey}'. Was it registered?`)
    }

    return inputTracker
  }

  return {
    getInputTracker,
  }
}
