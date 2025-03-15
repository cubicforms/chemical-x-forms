import { omit } from "lodash-es"
import { useState } from "nuxt/app"
// import { useState } from "nuxt/app"
import { computed, ref, type Ref } from "vue"
import type { DOMFieldState } from "../../../types/types-api"

export type ElementSet = Set<HTMLElement>
export type ElementStore = Record<string, ElementSet>
export type RegisterElement = (element: HTMLElement) => boolean
export type DeregisterElement = (element: HTMLElement) => number // returns number of remaining elements for elements' related path
export type GetElementHelpers = (path: string) => {
  registerElement: RegisterElement
  deregisterElement: DeregisterElement
}
export type UseFieldStoreRefReturnValue = {
  getElementHelpers: GetElementHelpers
  fieldStateStore: Ref<FieldStateStore, FieldStateStore>
}

export type FieldStateStore = Record<string, DOMFieldState | undefined>

export function useElementStore(): UseFieldStoreRefReturnValue {
  const elementStoreRef = useState<ElementStore>(
    "chemical-x/element-store",
    () => ({})
  )
  const fieldStateStore = useState<FieldStateStore>(
    "chemical-x/element-state-store",
    () => ({})
  )

  function _setKnownFocusState(
    path: string,
    focusedState: boolean,
    touched: boolean,
  ) {
    if (!fieldStateStore.value[path]) {
      fieldStateStore.value[path] = {
        focused: focusedState,
        blurred: !focusedState,
        touched,
      }
      return
    }

    const elementDOMState = fieldStateStore.value[path]
    elementDOMState.focused = focusedState
    elementDOMState.blurred = !focusedState
    elementDOMState.touched = touched
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
      const elementSet = elementStoreRef.value[path] as ElementSet | undefined
      if (elementSet?.has(element)) return false

      addEventListenerHelper(element)
      _setKnownFocusState(
        path,
        !!import.meta.client && document.activeElement === element,
        touchedState.value,

      )

      if (!elementSet) {
        elementStoreRef.value[path] = new Set([element])
        return true
      }

      elementStoreRef.value[path].add(element)
      return true
    }

    function deregisterElement(element: HTMLElement) {
      const elementStore = elementStoreRef.value
      const deleted = elementStore[path]?.delete(element)
      if (deleted) {
        removeEventListenerHelper(element)
      }

      // this is a useful signal for dropping path references in other parts of the library
      const existingElementCount = elementStore[path]?.size ?? 0
      if (existingElementCount === 0) {
        omit(elementStore, path) // free the path
        const deletedElementState = fieldStateStore.value?.[path]
        if (deletedElementState) {
          omit(deletedElementState, path) // remove the state reference (no longer tracking element state)
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
    fieldStateStore,
  }
}
