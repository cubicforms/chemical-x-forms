import { useState } from "#app"
import { omit } from "lodash-es"
import { computed, ref, type Ref } from "vue"

export type ElementSet = Set<HTMLElement>
export type ElementStore = Record<string, ElementSet>
export type RegisterElement = (element: HTMLElement) => boolean
export type DeregisterElement = (element: HTMLElement) => number // returns number of remaining elements for elements' related path
export type GetElementHelpers = (path: string) => {
  registerElement: RegisterElement
  deregisterElement: DeregisterElement
}
export type UseElementStoreRefReturnValue = {
  getElementHelpers: GetElementHelpers
  elementDOMStateStoreRef: Ref<ElementDOMStateStore, ElementDOMStateStore>
}

export type ElementDOMState =
  | {
    focused: boolean | null
    blurred: boolean | null
    touched: boolean | null
  }
export type ElementDOMStateStore = Record<string, ElementDOMState | undefined>

export function useElementStore(): UseElementStoreRefReturnValue {
  const elementStoreRef = useState<ElementStore>(
    "chemical-x/element-store",
    () => ({})
  )
  const elementDOMStateStoreRef = useState<ElementDOMStateStore>(
    "chemical-x/element-state-store",
    () => ({})
  )

  function _setKnownFocusState(
    path: string,
    focusedState: boolean,
    touched: boolean,
  ) {
    if (!elementDOMStateStoreRef.value[path]) {
      elementDOMStateStoreRef.value[path] = {
        focused: focusedState,
        blurred: !focusedState,
        touched,
      }
      return
    }

    const elementDOMState = elementDOMStateStoreRef.value[path]
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
        import.meta.client && document.activeElement === element,
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
        const deletedElementState = elementDOMStateStoreRef.value?.[path]
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
    elementDOMStateStoreRef,
  }
}
