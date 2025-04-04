import { defineNuxtPlugin } from 'nuxt/app'

import {
  invokeArrayFns,
  isArray,
  isFunction,
  isSet,
  looseEqual,
  looseIndexOf,
  looseToNumber,
} from '@vue/shared'
import type { DirectiveBinding, DirectiveHook, ObjectDirective, VNode } from 'vue'
import { isRef, nextTick, warn } from 'vue'
import type {
  CustomDirectiveRegisterAssignerFn,
  RegisterCheckboxCustomDirective,
  RegisterModelDynamicCustomDirective,
  RegisterRadioCustomDirective,
  RegisterSelectCustomDirective,
  RegisterTextCustomDirective,
  RegisterValue,
} from '../types/types-api'

export const assignKey: unique symbol = Symbol('_assign')
export function isRegisterValue<Value = unknown>(val: unknown): val is RegisterValue<Value> {
  if (!val) return false
  if (typeof val !== 'object') return false
  if (!('innerRef' in val)) return false
  if (!isRef(val.innerRef)) return false
  if (!('registerElement' in val)) return false
  if (typeof val.registerElement !== 'function') return false
  if (!('setValueWithInternalPath' in val)) return false
  if (typeof val.setValueWithInternalPath !== 'function') return false
  return true
}

type ComposingTarget = (EventTarget & { composing: boolean }) | null
function addEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions
): void {
  el.addEventListener(event, handler, options)
}

const getModelAssigner = (
  vnode: VNode,
  registerValue: RegisterValue
): CustomDirectiveRegisterAssignerFn => {
  const fn = vnode.props?.['onUpdate:registerValue'] // this is a developer escape hatch
  if (!fn) {
    return (value) => {
      registerValue.setValueWithInternalPath(value)
      return undefined
    }
  }
  return isArray(fn)
    ? (value) =>
        invokeArrayFns(
          fn.filter((x) => isFunction(x)),
          value,
          registerValue
        )
    : fn
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
    target.dispatchEvent(new Event('input'))
  }
}

function setAssignFunction(
  el: { [AssignKey: symbol]: CustomDirectiveRegisterAssignerFn },
  vnode: VNode,
  value: RegisterValue<unknown>
) {
  if (!isRegisterValue(value)) {
    warn(
      `v-register expected value of type RegisterValue, got value of type ${typeof value} instead. Please check your v-register value.`
    )
    el[assignKey] = (_) => undefined
    return
  }

  const assignerFn = getModelAssigner(vnode, value)
  if (assignerFn) {
    el[assignKey] = assignerFn
  }
}

// We are exporting the v-model runtime directly as vnode hooks so that it can
// be tree-shaken in case v-model is never used.
const vRegisterText: RegisterTextCustomDirective = {
  created(el, { value, modifiers: { lazy, trim, number } }, vnode) {
    const castToNumber = number || (vnode.props && vnode.props['type'] === 'number')
    if (isRegisterValue(value)) {
      value.registerElement(el)
      setAssignFunction(el, vnode, value)
    }
    addEventListener(el, lazy ? 'change' : 'input', (e) => {
      const target = e.target as ComposingTarget
      if (!target || target.composing) return
      let domValue: string | number = el.value
      if (trim) {
        domValue = domValue.trim()
      }
      if (castToNumber) {
        domValue = looseToNumber(domValue)
      }
      el[assignKey]?.(domValue)
    })
    if (trim) {
      addEventListener(el, 'change', () => {
        el.value = el.value.trim()
      })
    }
    if (!lazy) {
      addEventListener(el, 'compositionstart', onCompositionStart)
      addEventListener(el, 'compositionend', onCompositionEnd)
      // Safari < 10.2 & UIWebView doesn't fire compositionend when
      // switching focus before confirming composition choice
      // this also fixes the issue where some browsers e.g. iOS Chrome
      // fires "change" instead of "input" on autocomplete.
      addEventListener(el, 'change', onCompositionEnd)
    }
  },
  // set value on mounted so it's after min/max for type="range"
  mounted(el, { value }) {
    if (!isRegisterValue(value)) return

    const _val = value.innerRef.value
    el.value = typeof _val === 'string' || typeof _val === 'number' ? `${_val}` : ''
  },
  beforeUpdate(el, { value, oldValue, modifiers: { lazy, trim, number } }, vnode) {
    setAssignFunction(el, vnode, value)
    // avoid clearing unresolved text. #2302
    if ('composing' in el && el.composing) return
    if (!isRegisterValue(value)) return

    const elValue =
      (number || el.type === 'number') && !/^0\d/.test(el.value)
        ? looseToNumber(el.value)
        : el.value
    const newValue = value.innerRef.value === null ? '' : value.innerRef.value

    if (elValue === newValue) {
      return
    }

    if (document.activeElement === el && el.type !== 'range') {
      // #8546
      if (lazy && value.innerRef.value === oldValue) {
        return
      }
      if (trim && el.value.trim() === newValue) {
        return
      }
    }

    el.value = typeof newValue === 'string' ? newValue : ''
  },
}

const vRegisterCheckbox: RegisterCheckboxCustomDirective = {
  // #4096 array checkboxes need to be deep traversed
  deep: true,
  created(el, { value }, vnode) {
    if (!isRegisterValue(value)) return

    value.registerElement(el)
    setAssignFunction(el, vnode, value)
    addEventListener(el, 'change', () => {
      const modelValue = value.innerRef.value ?? []

      // this side-steps subtle 2-way binding bugs where ref updates but input cannot be tracked by value
      const explicitValueRequired = true
      const elementValue = getValue(el, explicitValueRequired)

      const checked = el.checked
      const assign = el[assignKey]
      if (isArray(modelValue)) {
        if (elementValue === undefined) {
          warn(
            'checkbox bound to a v-registerer array or set does not have an explicit value, state not updated.'
          )
          return
        }
        const index = looseIndexOf(modelValue, elementValue)
        const found = index !== -1
        if (checked && !found) {
          assign?.(modelValue.concat(elementValue))
        } else if (!checked && found) {
          const filtered = [...modelValue]
          filtered.splice(index, 1)
          assign?.(filtered)
        }
      } else if (isSet(modelValue)) {
        if (elementValue === undefined) {
          warn(
            'Please add `value` prop to checkbox or pass RegisterValue of primitive value to register.'
          )
          return
        }
        const cloned = new Set(modelValue)
        if (checked) {
          cloned.add(elementValue)
        } else {
          cloned.delete(elementValue)
        }
        assign?.(cloned)
      } else {
        assign?.(getCheckboxValue(el, checked))
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

function setChecked(el: HTMLInputElement, { value, oldValue }: DirectiveBinding, vnode: VNode) {
  // store the v-registerer value on the element so it can be accessed by the
  // change listener.
  if (!isRegisterValue(value)) return

  const originalValue = value.innerRef.value
  let checked: boolean

  if (isArray(originalValue)) {
    checked = looseIndexOf(originalValue, vnode.props?.['value']) > -1
  } else if (isSet(originalValue)) {
    checked = originalValue.has(vnode.props?.['value'])
  } else {
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

const vRegisterRadio: RegisterRadioCustomDirective = {
  created(el, { value }, vnode) {
    if (!isRegisterValue(value)) return

    value.registerElement(el)
    // setAssignFunction(el, vnode, value)
    el.checked = looseEqual(value.innerRef.value, vnode.props?.['value'])
    setAssignFunction(el, vnode, value)
    addEventListener(el, 'change', () => {
      el[assignKey]?.(getValue(el))
    })
  },
  beforeUpdate(el, { value, oldValue }, vnode) {
    if (!isRegisterValue(value)) return

    setAssignFunction(el, vnode, value)
    if (value.innerRef.value !== oldValue) {
      el.checked = looseEqual(value.innerRef.value, vnode.props?.['value'])
    }
  },
}

const vRegisterSelect: RegisterSelectCustomDirective = {
  // <select multiple> value need to be deep traversed
  deep: true,
  created(el, { value, modifiers: { number } }, vnode) {
    if (!isRegisterValue(value)) return

    value.registerElement(el)
    const isSetModel = isSet(value.innerRef.value)
    addEventListener(el, 'change', () => {
      const selectedVal = Array.prototype.filter
        .call(el.options, (o: HTMLOptionElement) => o.selected)
        .map((o: HTMLOptionElement) => (number ? looseToNumber(getValue(o)) : getValue(o)))
      el[assignKey]?.(
        el.multiple ? (isSetModel ? new Set(selectedVal) : selectedVal) : selectedVal[0]
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
  beforeUpdate(el, binding, vnode) {
    setAssignFunction(el, vnode, binding.value)
  },
  updated(el, { value }) {
    if (!el._assigning) {
      setSelected(el, value)
    }
  },
}

function getBaseValue(value: RegisterValue, el: HTMLSelectElement) {
  const externalValue = value.innerRef.value
  const options = el.options
  if (typeof externalValue === 'string') {
    const selectedOption = options[options.selectedIndex]
    return selectedOption?.value ?? ''
  }

  const optionsArray = [...options]
  if (externalValue instanceof Array) {
    return optionsArray.reduce<string[]>((result, option) => {
      if (option.selected) {
        result.push(option.value)
      }

      return result
    }, [])
  }
  return optionsArray.reduce<Set<string>>((result, option) => {
    if (option.selected) result.add(option.value)
    return result
  }, new Set())
}

function setSelected(el: HTMLSelectElement, value: unknown) {
  if (!isRegisterValue(value)) return

  const isMultiple = el.multiple
  const baseValue = getBaseValue(value, el)
  const isArrayValue = isArray(baseValue)

  if (isMultiple && !isArrayValue && !isSet(baseValue)) {
    if (import.meta.dev) {
      warn(
        `<select multiple v-register> expected an Array or Set value for its binding, ` +
          `but got ${Object.prototype.toString.call(baseValue).slice(8, -1)} instead.`
      )
    }
    return
  }

  for (let i = 0, l = el.options.length; i < l; i++) {
    const option = el.options[i]
    if (!option) continue

    const optionValue = getValue(option)
    if (isMultiple) {
      if (isArrayValue) {
        const optionType = typeof optionValue
        // fast path for string / number values
        if (optionType === 'string' || optionType === 'number') {
          option.selected = baseValue.some((v) => String(v) === String(optionValue))
        } else {
          option.selected = looseIndexOf(baseValue, optionValue) > -1
        }
      } else {
        option.selected = (baseValue as Set<unknown>).has(optionValue)
      }
    } else if (looseEqual(getValue(option), baseValue)) {
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
  return '_value' in el ? (el._value ?? undefined) : explicitRequired ? undefined : el.value
}

// retrieve raw value for true-value and false-value set via :true-value or :false-value bindings
function getCheckboxValue(
  el: HTMLInputElement & { _trueValue?: unknown; _falseValue?: unknown },
  checked: boolean
) {
  const key = checked ? '_trueValue' : '_falseValue'
  return key in el ? el[key] : checked
}

const vRegisterDynamic: RegisterModelDynamicCustomDirective = {
  created(el, binding, vnode) {
    callModelHook(el, binding, vnode, null, 'created')
  },
  mounted(el, binding, vnode) {
    callModelHook(el, binding, vnode, null, 'mounted')
  },
  beforeUpdate(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, 'beforeUpdate')
  },
  updated(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, 'updated')
  },
  beforeUnmount(el, { value }) {
    if (!isRegisterValue(value) || !el) return

    value.deregisterElement(el)
  },
}

function resolveDynamicModel(tagName: string, type: string | undefined) {
  switch (tagName) {
    case 'SELECT':
      return vRegisterSelect
    case 'TEXTAREA':
      return vRegisterText
    default:
      switch (type) {
        case 'checkbox':
          return vRegisterCheckbox
        case 'radio':
          return vRegisterRadio
        default:
          return vRegisterText
      }
  }
}

function callModelHook(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  binding: DirectiveBinding,
  vnode: VNode,
  prevVNode: VNode | null,
  hook: keyof ObjectDirective
) {
  const modelToUse = resolveDynamicModel(el.tagName, vnode.props?.['type'])
  const fn = modelToUse[hook] as DirectiveHook
  fn?.(el, binding, vnode, prevVNode)
}

export type VXCustomDirective =
  | typeof vRegisterText
  | typeof vRegisterCheckbox
  | typeof vRegisterSelect
  | typeof vRegisterRadio
  | typeof vRegisterDynamic

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('register', vRegisterDynamic)
})
