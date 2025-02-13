import { isRef, type Directive, type DirectiveBinding, type Ref, type VNode, type VNodeProps } from "vue"

type SuperModelValue<Value = unknown> = {
  innerValue: Ref<Value>
  element: Ref<HTMLElement | null>
}

const ElementTypes = {
  TEXT: "text", // this is the default / fallback input type
  NUMBER: "number",
  TEXTAREA: "textarea",
  RADIO: "radio",
  CHECKBOX: "checkbox",
  SELECT: "select",
} as const

function isSupermodelPayload<Value = unknown>(val: unknown): val is SuperModelValue<Value> {
  if (!val) return false
  if (typeof val !== "object") return false
  if (!("innerValue" in val)) return false
  if (!("element" in val)) return false
  if (!isRef(val.innerValue)) return false
  if (!isRef(val.element)) return false
  if (val.element.value !== null && !(val.element.value instanceof HTMLElement)) return false
  return true
}

type ElementTypeKey = keyof typeof ElementTypes

type InputType = (typeof ElementTypes)[ElementTypeKey]

function getElementType(el: HTMLElement, vnode: VNode): InputType {
  if (vnode.type === "select") return ElementTypes.SELECT
  if (el.tagName === "SELECT") return ElementTypes.SELECT

  const vnodeProps = (vnode.props || {}) as VNodeProps

  if ("type" in vnodeProps) {
    const vnodeType = "type" in vnodeProps ? String(vnodeProps.type || "").toUpperCase() : ""
    return vnodeType in ElementTypes ? ElementTypes[vnodeType as ElementTypeKey] : ElementTypes.TEXT
  }

  if ("type" in el) {
    const _type = String(el.type || "").toUpperCase()
    console.log("type", el.type, _type)
    if (_type in ElementTypes) return ElementTypes[_type as ElementTypeKey]
  }

  return ElementTypes.TEXT
}

function isSelectMultiple(vnode: VNode) {
  // search for `multiple` attribute
  const vnodeProps = (vnode?.props || {}) as VNodeProps
  const hasMultiple = "multiple" in vnodeProps
  const multiple = hasMultiple ? vnodeProps["multiple"] : false

  if (typeof multiple === "boolean") return multiple
  if (typeof multiple === "string") return multiple.toLowerCase().trim() === "true"
  return false
}

function initialSelectValue(binding: DirectiveBinding<SuperModelValue<unknown>, string, string>, vnode: VNode) {
  const multiple = isSelectMultiple(vnode)
  const protectedValue = binding.value
  if (!isSupermodelPayload(protectedValue)) {
    console.warn(`v-supermodel directive expected value of type 'SuperModelValue<V>', but got value of type '${typeof protectedValue}' instead.`)
    return multiple ? [] : ""
  }
  const value = protectedValue.innerValue.value
  if (!multiple) {
    return String(value)
  }

  if (!Array.isArray(value)) return []

  return value.map(x => String(x)) // always coerce values to strings
}

type ExhaustedOptionValues = {
  [K: string]: boolean
}

function setSelectOptions(element: HTMLElement, optionValues: string[]) {
  const uniqueOptValues = [...(new Set(optionValues))]
  const exhaustedOptionValues = uniqueOptValues.reduce<ExhaustedOptionValues>((acc, optionValue) => ({ ...acc, [optionValue]: false }), {})
  let foundCount = 0

  function traverse(el: HTMLElement | null) {
    if (!el) return

    if (el instanceof HTMLOptionElement) {
      for (const opt of uniqueOptValues) {
        if (foundCount === uniqueOptValues.length) return // no more options
        const exhausted = exhaustedOptionValues[opt] || false
        if (exhausted) continue // true boolean means the value has been exhausted

        // mission complete!
        if (el.value === opt) {
          el.selected = true
          exhaustedOptionValues[opt] = true
          foundCount++
          return
        }
      }
    }

    const children = el.children
    for (const child of Array.from(children)) {
      if (foundCount === uniqueOptValues.length) return // no more options
      traverse(child as HTMLElement)
    }
  }

  traverse(element)
}

export const vSuperModel: Directive<HTMLElement, SuperModelValue> = {
  deep: true,
  beforeMount(el, binding, vnode) {
    console.log("before mount", { el, binding, vnode })
  },
  created(el, binding, vnode) {
    console.log("created")
    const elementType = getElementType(el, vnode)
    if (elementType === "select") {
      const value = initialSelectValue(binding, vnode)
      const selectOptions = typeof value === "string" ? [value] : value
      setSelectOptions(el, selectOptions)
    }
  }
}
