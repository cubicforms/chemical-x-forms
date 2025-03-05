import { useState } from "#app"
import { omit } from "lodash-es"
import type { Ref } from "vue"

export type ElementSet = Set<HTMLElement>
export type ElementStore = Record<string, ElementSet>
export type RegisterElement = (element: HTMLElement) => void
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
    focusedState: boolean
  ) {
    if (!elementDOMStateStoreRef.value[path]) {
      elementDOMStateStoreRef.value[path] = {
        focused: focusedState,
        blurred: !focusedState,
      }
      return
    }

    const elementDOMState = elementDOMStateStoreRef.value[path]
    elementDOMState.focused = focusedState
    elementDOMState.blurred = !focusedState
  }

  const getElementHelpers: GetElementHelpers = (path: string) => {
    // just in case this function is accidentally executed in a server context
    if (import.meta.server)
      return {
        registerElement: _ => ({}),
        deregisterElement: _ => -1,
      }

    // stable function reference for adding and removing event listeners during the element existence lifecycle
    function handleFocus(event: FocusEvent) {
      console.log("element is focused, this is the focus event!", event)
      _setKnownFocusState(path, true)
    }

    function handleBlur(event: FocusEvent) {
      // the DOM will always trigger this before we can handle the state, so identify unmounted elements manually
      console.log("element is blurred!", event.target)
      _setKnownFocusState(path, false)
    }

    function addEventListenerHelper(element: HTMLElement) {
      console.log("adding event listeners for", element)
      element.addEventListener("focus", handleFocus)
      element.addEventListener("blur", handleBlur)
    }

    function removeEventListenerHelper(element: HTMLElement) {
      console.log("removing event listeners for", element)
      element.removeEventListener("focus", handleFocus)
      element.removeEventListener("blur", handleBlur)
    }

    function registerElement(element: HTMLElement) {
      const elementSet = elementStoreRef.value[path]

      if (!elementSet?.has(element)) {
        addEventListenerHelper(element)
        // this lazy computation ensures that only existing elements are given states quickly
        _setKnownFocusState(
          path,
          import.meta.client && document.activeElement === element
        )
      }

      if (!elementSet) {
        elementStoreRef.value[path] = new Set([element])
        return
      }

      elementStoreRef.value[path].add(element)
    }

    function deregisterElement(element: HTMLElement) {
      const elementStore = elementStoreRef.value
      const paths
        = typeof path === "string" ? [path] : Object.keys(elementStore)
      for (const _path of paths) {
        const deleted = elementStore[_path]?.delete(element)
        if (deleted) {
          removeEventListenerHelper(element)
        }
      }

      // this is a useful signal for dropping path references in other parts of the library
      const existingElementCount = Object.keys(elementStore[path]).length
      if (existingElementCount === 0) {
        omit(elementStore, path) // free the path
        const deletedElementState = elementDOMStateStoreRef.value?.[path]
        if (deletedElementState) {
          omit(deletedElementState, path) // remove the state reference (no longer tracking element state)
        }
      }

      //   _setKnownFocusState(
      //     (elementStore?.[path]?.size ?? 0), // plus 1 because we're about to add the newly received element
      //     path,
      //     import.meta.client && document.activeElement === element
      //   )

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
