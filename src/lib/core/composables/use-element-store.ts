import { useState } from "#app"

export type ElementSet = Set<HTMLElement>
export type ElementStore = Record<string, ElementSet>
export type RegisterElement = (element: HTMLElement, path: string) => void
export type DeregisterElement = (element: HTMLElement, path?: string) => void
export type UseElementStoreRefReturnValue = {
  registerElement: RegisterElement
  deregisterElement: DeregisterElement
}

export function useElementStore(): UseElementStoreRefReturnValue {
  const elementStoreRef = useState<ElementStore>("chemical-x/element-store", () => ({}))
  const { addEventListenerHelper, removeEventListenerHelper } = _eventListenerHelperFactory()

  function registerElement(element: HTMLElement, path: string) {
    const elementSet = elementStoreRef.value[path]

    if (!elementSet?.has(element)) {
      addEventListenerHelper(element)
    }

    if (!elementSet) {
      elementStoreRef.value[path] = new Set([element])
      return
    }

    elementStoreRef.value[path].add(element)
  }

  function deregisterElement(element: HTMLElement, path?: string) {
    const elementStore = elementStoreRef.value
    const paths = typeof path === "string" ? [path] : Object.keys(elementStore)
    for (const _path of paths) {
      const deleted = elementStore[_path]?.delete(element)
      if (deleted) {
        removeEventListenerHelper(element)
      }
    }
  }

  function _eventListenerHelperFactory() {
    // stable function reference for adding and removing event listeners during the element existence lifecycle
    function handleFocus(event: FocusEvent) {
      console.log("element is focused, this is the focus event!", event)
    }

    function handleBlur(event: FocusEvent) {
      console.log("element is blurred, this is the blur event!", event)
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

    return {
      addEventListenerHelper,
      removeEventListenerHelper,
    }
  }

  return {
    registerElement,
    deregisterElement,
  }
}
