import type {
  DirectiveBinding,
  DirectiveHook,
  ObjectDirective,
  Ref,
  VNode
} from "@vue/runtime-core"
import {
  isRef,
  nextTick,
  warn
} from "@vue/runtime-core"
import {
  invokeArrayFns,
  isArray,
  isFunction,
  isSet,
  looseEqual,
  looseIndexOf,
  looseToNumber
} from "@vue/shared"

export type XModelValue<Value = unknown> = {
  innerRef: Readonly<Ref<Value>>
  registerElement: (el: HTMLElement) => void
  deregisterElement: (el: HTMLElement) => void
  setValueWithInternalPath: (value: unknown) => boolean
}

type AssignerFn = (value: unknown) => void

function isXModelPayload<Value = unknown>(val: unknown): val is XModelValue<Value> {
  if (!val) return false
  if (typeof val !== "object") return false
  if (!("innerRef" in val)) return false
  if (!isRef(val.innerRef)) return false
  if (!("registerElement" in val)) return false
  if (typeof val.registerElement !== "function") return false
  if (!("setValueWithInternalPath" in val)) return false
  if (typeof val.setValueWithInternalPath !== "function") return false
  return true
}

type ComposingTarget = (EventTarget & { composing: boolean }) | null
export function addEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions,
): void {
  el.addEventListener(event, handler, options)
}

export function removeEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions,
): void {
  el.removeEventListener(event, handler, options)
}

const getModelAssigner = (vnode: VNode, xmodelValue: XModelValue): AssignerFn => {
  const fn
      = vnode.props?.["onUpdate:xmodelValue"] // this is a developer escape hatch
  if (!fn) {
    return (value) => {
      // xmodelValue.innerRef.value = value
      xmodelValue.setValueWithInternalPath(value)
      return undefined
    }
  }
  return isArray(fn) ? value => invokeArrayFns(fn.filter(x => isFunction(x)), value, xmodelValue) : fn
}

function onCompositionStart(e: Event) {
  const target = e.target as ComposingTarget
  if (!target) return

  target.composing = true
}

function onCompositionEnd(e: Event) {
  const target = e.target as ComposingTarget
  if (target && target?.composing) {
    target.composing = false
    target.dispatchEvent(new Event("input"))
  }
}

const assignKey: unique symbol = Symbol("_assign")

type ModelDirective<T, Modifiers extends string = string> = ObjectDirective<
  T & { [assignKey]: AssignerFn, _assigning?: boolean },
  unknown,
  Modifiers
>

function setAssignFunction(el: { [assignKey]: AssignerFn }, vnode: VNode, value: unknown) {
  if (!isXModelPayload(value)) {
    warn(`vmodel expected value of type XModelValue, got value of type ${typeof value} instead. Please check your v-xmodel value.`)
    el[assignKey] = _ => undefined
    return
  }
  const assignerFn = getModelAssigner(vnode, value)
  if (assignerFn) {
    el[assignKey] = assignerFn
  }
}

// We are exporting the v-model runtime directly as vnode hooks so that it can
// be tree-shaken in case v-model is never used.
export const vXModelText: ModelDirective<
    HTMLInputElement | HTMLTextAreaElement,
    "trim" | "number" | "lazy"
> = {
  created(el, { value, modifiers: { lazy, trim, number } }, vnode) {
    const castToNumber
        = number || (vnode.props && vnode.props.type === "number")
    if (isXModelPayload(value)) {
      value.registerElement(el)
      setAssignFunction(el, vnode, value)
    }
    addEventListener(el, lazy ? "change" : "input", (e) => {
      const target = e.target as ComposingTarget
      if (!target || target.composing) return
      let domValue: string | number = el.value
      if (trim) {
        domValue = domValue.trim()
      }
      if (castToNumber) {
        domValue = looseToNumber(domValue)
      }
      el[assignKey](domValue)
    })
    if (trim) {
      addEventListener(el, "change", () => {
        el.value = el.value.trim()
      })
    }
    if (!lazy) {
      addEventListener(el, "compositionstart", onCompositionStart)
      addEventListener(el, "compositionend", onCompositionEnd)
      // Safari < 10.2 & UIWebView doesn't fire compositionend when
      // switching focus before confirming composition choice
      // this also fixes the issue where some browsers e.g. iOS Chrome
      // fires "change" instead of "input" on autocomplete.
      addEventListener(el, "change", onCompositionEnd)
    }
  },
  // set value on mounted so it's after min/max for type="range"
  mounted(el, { value }) {
    // el.value = value == null || typeof value !== "string" ? "" : value
    if (!isXModelPayload(value)) return

    const _val = value.innerRef.value
    el.value = typeof _val === "string" || typeof _val === "number" ? `${_val}` : ""
  },
  beforeUpdate(
    el,
    { value, oldValue, modifiers: { lazy, trim, number } },
    vnode,
  ) {
    setAssignFunction(el, vnode, value)
    // avoid clearing unresolved text. #2302
    if ("composing" in el && el.composing) return
    if (!isXModelPayload(value)) return

    const elValue
        = (number || el.type === "number") && !/^0\d/.test(el.value)
          ? looseToNumber(el.value)
          : el.value
    const newValue = value.innerRef.value == null ? "" : value.innerRef.value

    if (elValue === newValue) {
      return
    }

    if (document.activeElement === el && el.type !== "range") {
      // #8546
      if (lazy && value.innerRef.value === oldValue) {
        return
      }
      if (trim && el.value.trim() === newValue) {
        return
      }
    }

    el.value = typeof newValue === "string" ? newValue : ""
  },
}

export const vXModelCheckbox: ModelDirective<HTMLInputElement> = {
  // #4096 array checkboxes need to be deep traversed
  deep: true,
  created(el, { value }, vnode) {
    if (!isXModelPayload(value)) return

    value.registerElement(el)
    setAssignFunction(el, vnode, value)
    addEventListener(el, "change", () => {
      const modelValue = value.innerRef.value ?? []

      // this side-steps subtle 2-way binding bugs where ref updates but input cannot be tracked by value
      const explicitValueRequired = true
      const elementValue = getValue(el, explicitValueRequired)

      const checked = el.checked
      const assign = el[assignKey]
      if (isArray(modelValue)) {
        if (elementValue === undefined) {
          warn("checkbox bound to a v-xmodel array or set does not have an explicit value, state not updated.")
          return
        }
        const index = looseIndexOf(modelValue, elementValue)
        const found = index !== -1
        if (checked && !found) {
          assign(modelValue.concat(elementValue))
        }
        else if (!checked && found) {
          const filtered = [...modelValue]
          filtered.splice(index, 1)
          assign(filtered)
        }
      }
      else if (isSet(modelValue)) {
        if (elementValue === undefined) {
          warn("Please add `value` prop to checkbox or pass XModelValue of primitive value to xmodel.")
          return
        }
        const cloned = new Set(modelValue)
        if (checked) {
          cloned.add(elementValue)
        }
        else {
          cloned.delete(elementValue)
        }
        assign(cloned)
      }
      else {
        assign(getCheckboxValue(el, checked))
      }
    })
  },
  // set initial checked on mount to wait for true-value/false-value
  mounted: setChecked,
  beforeUpdate(el, binding, vnode) {
    setAssignFunction(el, vnode, binding.value)
    setChecked(el, binding, vnode)
  },
}

function setChecked(
  el: HTMLInputElement,
  { value, oldValue }: DirectiveBinding,
  vnode: VNode,
) {
  // store the v-xmodel value on the element so it can be accessed by the
  // change listener.
  if (!isXModelPayload(value)) return

  const originalValue = value.innerRef.value
  let checked: boolean

  if (isArray(originalValue)) {
    checked = looseIndexOf(originalValue, vnode.props!.value) > -1
  }
  else if (isSet(originalValue)) {
    checked = originalValue.has(vnode.props?.value)
  }
  else {
    if (originalValue === oldValue) {
      return
    }
    checked = looseEqual(originalValue, getCheckboxValue(el, true))
  }

  // Only update if the checked state has changed
  const elChecked = el.checked

  if (elChecked !== checked) {
    el.checked = checked
  }
}

export const vXModelRadio: ModelDirective<HTMLInputElement> = {
  created(el, { value }, vnode) {
    if (!isXModelPayload(value)) return

    value.registerElement(el)
    // setAssignFunction(el, vnode, value)
    el.checked = looseEqual(value.innerRef.value, vnode.props!.value)
    setAssignFunction(el, vnode, value)
    addEventListener(el, "change", () => {
      el[assignKey](getValue(el))
    })
  },
  beforeUpdate(el, { value, oldValue }, vnode) {
    if (!isXModelPayload(value)) return

    setAssignFunction(el, vnode, value)
    if (value.innerRef.value !== oldValue) {
      el.checked = looseEqual(value.innerRef.value, vnode.props!.value)
    }
  },
}

export const vXModelSelect: ModelDirective<HTMLSelectElement, "number"> = {
  // <select multiple> value need to be deep traversed
  deep: true,
  created(el, { value, modifiers: { number } }, vnode) {
    if (!isXModelPayload(value)) return

    value.registerElement(el)
    setAssignFunction(el, vnode, value)
    const isSetModel = isSet(value.innerRef.value)
    addEventListener(el, "change", () => {
      const selectedVal = Array.prototype.filter
        .call(el.options, (o: HTMLOptionElement) => o.selected)
        .map((o: HTMLOptionElement) =>
          number ? looseToNumber(getValue(o)) : getValue(o),
        )
      el[assignKey](
        el.multiple
          ? isSetModel
            ? new Set(selectedVal)
            : selectedVal
          : selectedVal[0],
      )
      el._assigning = true
      nextTick(() => {
        el._assigning = false
      })
    })
    setAssignFunction(el, vnode, value)
  },
  // set value in mounted & updated because <select> relies on its children
  // <option>s.
  mounted(el, { value }) {
    setSelected(el, value)
  },
  beforeUpdate(el, _binding, vnode) {
    setAssignFunction(el, vnode, _binding.value)
  },
  updated(el, { value }) {
    if (!el._assigning) {
      setSelected(el, value)
    }
  },
}

function setSelected(el: HTMLSelectElement, value: unknown) {
  if (!isXModelPayload(value)) return

  const isMultiple = el.multiple
  const baseValue = value.innerRef.value
  const isArrayValue = isArray(baseValue)
  if (isMultiple && !isArrayValue && !isSet(value)) {
    if (import.meta.dev === false) return
    warn(
      `<select multiple v-xmodel> expects an Array or Set value for its binding, `
      + `but got ${Object.prototype.toString.call(baseValue).slice(8, -1)}.`,
    )
    return
  }

  for (let i = 0, l = el.options.length; i < l; i++) {
    const option = el.options[i] // this select element method is very thoughtful!
    const optionValue = getValue(option)
    if (isMultiple) {
      if (isArrayValue) {
        const optionType = typeof optionValue
        // fast path for string / number values
        if (optionType === "string" || optionType === "number") {
          option.selected = baseValue.some(v => String(v) === String(optionValue))
        }
        else {
          option.selected = looseIndexOf(baseValue, optionValue) > -1
        }
      }
      else {
        option.selected = (baseValue as Set<unknown>).has(optionValue)
      }
    }
    else if (looseEqual(getValue(option), baseValue)) {
      if (el.selectedIndex !== i) el.selectedIndex = i
      return
    }
  }
  if (!isMultiple && el.selectedIndex !== -1) {
    el.selectedIndex = -1
  }
}

// retrieve raw value set via :value bindings
function getValue(el: HTMLOptionElement | HTMLInputElement, explicitRequired = false) {
  return "_value" in el ? (el._value ?? undefined) : (explicitRequired ? undefined : el.value)
}

// retrieve raw value for true-value and false-value set via :true-value or :false-value bindings
function getCheckboxValue(
  el: HTMLInputElement & { _trueValue?: unknown, _falseValue?: unknown },
  checked: boolean,
) {
  const key = checked ? "_trueValue" : "_falseValue"
  return key in el ? el[key] : checked
}

export const vXModelDynamic: ObjectDirective<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
> = {
  created(el, binding, vnode) {
    callModelHook(el, binding, vnode, null, "created")
  },
  mounted(el, binding, vnode) {
    callModelHook(el, binding, vnode, null, "mounted")
  },
  beforeUpdate(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, "beforeUpdate")
  },
  updated(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, "updated")
  },
  beforeUnmount(el, { value }) {
    if (!isXModelPayload(value) || !el) return

    value.deregisterElement(el)
  }
}

function resolveDynamicModel(tagName: string, type: string | undefined) {
  switch (tagName) {
    case "SELECT":
      return vXModelSelect
    case "TEXTAREA":
      return vXModelText
    default:
      switch (type) {
        case "checkbox":
          return vXModelCheckbox
        case "radio":
          return vXModelRadio
        default:
          return vXModelText
      }
  }
}

function callModelHook(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  binding: DirectiveBinding,
  vnode: VNode,
  prevVNode: VNode | null,
  hook: keyof ObjectDirective,
) {
  const modelToUse = resolveDynamicModel(
    el.tagName,
    vnode.props && vnode.props.type,
  )
  const fn = modelToUse[hook] as DirectiveHook
  fn?.(el, binding, vnode, prevVNode)
}

// SSR vnode transforms, only used when user includes client-oriented render
// function in SSR
export function initVModelForSSR(): void {
  vXModelText.getSSRProps = ({ value }) => ({ value })

  vXModelRadio.getSSRProps = ({ value }, vnode) => {
    if (vnode.props && looseEqual(vnode.props.value, value)) {
      return { checked: true }
    }
  }

  vXModelCheckbox.getSSRProps = ({ value }, vnode) => {
    if (isArray(value)) {
      if (vnode.props && looseIndexOf(value, vnode.props.value) > -1) {
        return { checked: true }
      }
    }
    else if (isSet(value)) {
      if (vnode.props && value.has(vnode.props.value)) {
        return { checked: true }
      }
    }
    else if (value) {
      return { checked: true }
    }

    return undefined
  }

  vXModelDynamic.getSSRProps = (binding, vnode) => {
    if (typeof vnode.type !== "string") {
      return
    }
    const modelToUse = resolveDynamicModel(
      // resolveDynamicModel expects an uppercase tag name, but vnode.type is lowercase
      vnode.type.toUpperCase(),
      vnode.props && vnode.props.type,
    )
    if (modelToUse.getSSRProps) {
      return modelToUse.getSSRProps(binding, vnode)
    }
  }
}

export type VXModelDirective =
  | typeof vXModelText
  | typeof vXModelCheckbox
  | typeof vXModelSelect
  | typeof vXModelRadio
  | typeof vXModelDynamic
