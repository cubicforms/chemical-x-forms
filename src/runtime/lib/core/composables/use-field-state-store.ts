import { get } from "lodash-es"
import { useState } from "nuxt/app"
import { computed, ref, type Ref } from "vue"
import type { DOMFieldStateStore } from "../../../types/types-api"
import type { GenericForm } from "../../../types/types-core"

export type ElementSet = Set<HTMLElement>
export type ElementStore = Map<string, ElementSet>
export type RegisterElement = (element: HTMLElement) => boolean
export type DeregisterElement = (element: HTMLElement) => number // returns number of remaining elements for elements' related path
export type GetElementHelpers = (path: string) => {
  registerElement: RegisterElement
  deregisterElement: DeregisterElement
}
export type UseDOMFieldStateStoreRefReturnValue = {
  getElementHelpers: GetElementHelpers
  domFieldStateStore: Ref<DOMFieldStateStore, DOMFieldStateStore>
}

export function useDOMFieldStateStore<Form extends GenericForm>(form: Ref<Form>): UseDOMFieldStateStoreRefReturnValue {
  const elementStoreRef = useState<ElementStore>(
    "chemical-x/element-store",
    () => new Map()
  )
  const domFieldStateStore = useState<DOMFieldStateStore>(
    "chemical-x/element-state-store",
    () => new Map()
  )

  function _setKnownFocusState(
    path: string,
    focusedState: boolean,
    touched: boolean,
  ) {
    domFieldStateStore.value.set(path, {
      focused: focusedState,
      blurred: !focusedState,
      touched,
    })
  }

  const touchedStates = ref<Record<string, boolean | undefined>>({})

  const getElementHelpers: GetElementHelpers = (path: string) => {
    // just in case this function is accidentally executed in a server context
    if (import.meta.server)
      return {
        registerElement: _ => false,
        deregisterElement: _ => -1,
      }

    const touchedState = computed(() => touchedStates.value[path] ?? false)
    // stable function reference for adding and removing event listeners during the element existence lifecycle
    function handleFocus(_event: FocusEvent) {
      const focusedState = true
      _setKnownFocusState(path, focusedState, touchedState.value)
    }

    function handleBlur(_event: FocusEvent) {
      const focusedState = false
      touchedStates.value[path] = true // always set `touched` on blur
      _setKnownFocusState(path, focusedState, touchedState.value)
    }

    function addEventListenerHelper(element: HTMLElement) {
      element.addEventListener("focus", handleFocus)
      element.addEventListener("blur", handleBlur)
    }

    function removeEventListenerHelper(element: HTMLElement) {
      element.removeEventListener("focus", handleFocus)
      element.removeEventListener("blur", handleBlur)
    }

    function registerElement(element: HTMLElement) {
      const elementSet = elementStoreRef.value.get(path)
      if (elementSet?.has(element)) return false

      addEventListenerHelper(element)
      _setKnownFocusState(
        path,
        !!import.meta.client && document.activeElement === element,
        touchedState.value,

      )

      if (!elementSet) {
        elementStoreRef.value.set(path, new Set([element]))
        return true
      }

      return !!elementStoreRef.value.get(path)?.add(element)
    }

    function deregisterElement(element: HTMLElement) {
      const elementStore = elementStoreRef.value
      const deleted = elementStore.get(path)?.delete(element)
      if (deleted) {
        removeEventListenerHelper(element)
      }

      const existingElementCount = elementStore.get(path)?.size ?? 0
      if (existingElementCount === 0) {
        elementStore.delete(path) // free the path
        const domFieldStateExists = domFieldStateStore.value.has(path)
        const NOT_FOUND = Symbol("FIELD_NOT_FOUND")
        const fieldNotFoundOnForm = get(form.value, path, NOT_FOUND) === NOT_FOUND

        // Only delete the dom field state if we are no longer tracking the field internally
        const removeDomFieldState = fieldNotFoundOnForm && domFieldStateExists

        if (removeDomFieldState) {
          domFieldStateStore.value.delete(path)
        }
      }

      return existingElementCount
    }

    return {
      registerElement,
      deregisterElement,
    }
  }

  return {
    getElementHelpers,
    domFieldStateStore,
  }
}
