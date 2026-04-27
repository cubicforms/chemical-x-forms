/**
 * The v-register directive. Provides `v-model`-like binding semantics but
 * writes through the form's `RegisterValue` rather than mutating a ref
 * directly — so form state tracking (dirty/pristine, touched, errors)
 * stays coherent.
 *
 * Lives in core (not under plugins/) because this is framework-agnostic:
 * `createChemicalXForms()` installs it via `app.directive('register', …)`
 * and the directive works identically under Nuxt, bare Vue CSR, and bare
 * Vue + @vue/server-renderer (where Vue's SSR skips directive lifecycle
 * hooks, making the directive a safe no-op server-side).
 *
 * Phase 3 hardens the AST-adjacent parts (dynamic-type normalisation,
 * type="file" refusal, listener cleanup on unmount, reactive-type dev
 * warning). This commit is a structural move only — no behavior change.
 */
import {
  invokeArrayFns,
  isArray,
  isFunction,
  isSet,
  looseEqual,
  looseIndexOf,
  looseToNumber,
} from './vue-shared-shim'
import type { DirectiveBinding, DirectiveHook, ObjectDirective, VNode } from 'vue'
import { isRef, nextTick, warn } from 'vue'
import { REGISTER_OWNER_MARKER } from '../composables/use-register'
import { __DEV__ } from './dev'
import type {
  CustomDirectiveRegisterAssignerFn,
  RegisterCheckboxCustomDirective,
  RegisterModelDynamicCustomDirective,
  RegisterRadioCustomDirective,
  RegisterSelectCustomDirective,
  RegisterTextCustomDirective,
  RegisterValue,
  WriteMeta,
} from '../types/types-api'
import { getOrAssignElementId } from './persistence/opt-in-registry'
import { enforceSensitiveCheck } from './persistence/sensitive-names'

export const assignKey: unique symbol = Symbol('_assign')

/**
 * Per-element bag of listener tuples added by the active directive
 * variant in `created`. `vRegisterDynamic.beforeUnmount` drains the bag
 * so reused elements (KeepAlive, v-show) don't accumulate orphaned
 * handlers across activation cycles.
 */
const listenersKey: unique symbol = Symbol('cxListeners')

type TrackedListener = {
  event: string
  handler: EventListener
  // Explicitly `undefined`-able so `exactOptionalPropertyTypes` lets us
  // stash tuples where the caller didn't pass options.
  options: EventListenerOptions | undefined
}

type ListenerCarrier = { [listenersKey]?: TrackedListener[] }

export function isRegisterValue<Value = unknown>(val: unknown): val is RegisterValue<Value> {
  if (typeof val !== 'object' || val === null) return false
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
  // Stash the tuple on the element so `beforeUnmount` can detach it.
  // A bare `addEventListener` without tracking would leak across
  // KeepAlive re-activations where the DOM node is reused.
  const carrier = el as ListenerCarrier
  const bag = carrier[listenersKey] ?? []
  bag.push({ event, handler, options })
  carrier[listenersKey] = bag
}

function removeTrackedListeners(el: Element): void {
  const carrier = el as ListenerCarrier
  const bag = carrier[listenersKey]
  if (bag === undefined) return
  for (const { event, handler, options } of bag) {
    el.removeEventListener(event, handler, options)
  }
  delete carrier[listenersKey]
}

/**
 * Compute the WriteMeta the default assigner attaches to its
 * `setValueWithInternalPath` call. Per-element semantics: only THIS
 * element's writes carry `persist: true`, and only if THIS element opted
 * in via `register('foo', { persist: true })`. Other elements bound to
 * the same path get `persist: false` from their own assigners.
 *
 * The assigner closure captures `el` and `registerValue` directly.
 * `el` is stable across the assigner's lifetime; `registerValue` is the
 * latest one, since the assigner is recreated on every `beforeUpdate`
 * via `setAssignFunction`.
 */
function computePersistMeta(el: HTMLElement, registerValue: RegisterValue): WriteMeta {
  const elementId = getOrAssignElementId(el)
  return { persist: registerValue.persistOptIns.hasOptIn(elementId, registerValue.path) }
}

/**
 * Symbol-tagged on default-installed assigners so listener bodies can
 * tell "no consumer override" from "consumer-installed assigner". The
 * bail check (`shouldBailListener`) uses this to avoid the bubbled-
 * write bug for non-supported roots: the default assigner reading
 * `el.value` off a `<div>` would clobber form state with `''` /
 * `undefined` on every keystroke from a descendant input. A consumer-
 * installed assigner (via `assignKey` or `onUpdate:registerValue`)
 * has explicitly opted into reading whatever the listener captures,
 * so the bail doesn't apply.
 */
const DEFAULT_ASSIGNER_TAG: unique symbol = Symbol('cxDefaultAssigner')

type DefaultAssignerCarrier = { [DEFAULT_ASSIGNER_TAG]?: boolean }

function isDefaultAssigner(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as DefaultAssignerCarrier)[DEFAULT_ASSIGNER_TAG] === true
}

/**
 * Listener-body bail. Called at the top of every event handler the
 * directive attaches. Bails when:
 *  - the rendered root is a non-supported tag (where `el.value` is
 *    meaningless), AND
 *  - the assigner is the default (no consumer override).
 *
 * Catches two cases without needing instance-level sentinel detection:
 *  1. A `useRegister`-using child component — its rendered root is
 *     usually a `<label>` / `<div>` / etc., and the inner
 *     `<input v-register>` handles binding. The parent's directive's
 *     listener on the rendered root would otherwise read `el.value`
 *     off the wrapper and clobber the form.
 *  2. A bare `<div v-register>` with no escape hatch — same story,
 *     the dev gets a deferred warn pointing at the recipe.
 *
 * Pre-installed `assignKey` AND `@update:registerValue` listener
 * shapes both bypass this bail (their assigner replaces the default,
 * stripping the tag). Post-installed `assignKey` (set via
 * `onMounted` or a ref callback) ALSO bypasses, because by the time
 * the next input event fires, the user's assigner is in place.
 */
function shouldBailListener(el: HTMLElement): boolean {
  if (SUPPORTED_TAGS.has(el.tagName)) return false
  return isDefaultAssigner((el as unknown as { [k: symbol]: unknown })[assignKey])
}

const getModelAssigner = (
  el: HTMLElement,
  vnode: VNode,
  registerValue: RegisterValue
): CustomDirectiveRegisterAssignerFn => {
  // developer escape hatch — Vue wires `onUpdate:registerValue` as either a
  // single function or an array of functions depending on how many listeners
  // are bound. We narrow before dispatching.
  //
  // User-supplied assigners receive `(value)` only; if they want their writes
  // to participate in persistence they must call
  // `registerValue.setValueWithInternalPath(value, customMeta)` themselves.
  // The default assigner below auto-attaches per-element meta.
  const fn: unknown = vnode.props?.['onUpdate:registerValue']
  if (isArray(fn)) {
    return (value) =>
      invokeArrayFns(
        fn.filter((x) => isFunction(x)) as ((...args: unknown[]) => unknown)[],
        value,
        registerValue
      )
  }
  if (isFunction(fn)) {
    return fn as CustomDirectiveRegisterAssignerFn
  }
  // Default-installed assigner. Tagged so the listener-body bail
  // (`shouldBailListener`) can distinguish it from consumer overrides
  // and prevent the bubbled-write bug on non-supported roots.
  const defaultAssigner: CustomDirectiveRegisterAssignerFn = (value) => {
    registerValue.setValueWithInternalPath(value, computePersistMeta(el, registerValue))
    return undefined
  }
  ;(defaultAssigner as unknown as DefaultAssignerCarrier)[DEFAULT_ASSIGNER_TAG] = true
  return defaultAssigner
}

/**
 * Idempotent reconciliation of a single element's opt-in across the
 * directive lifecycle. Called from `created` (oldValue undefined),
 * `beforeUpdate` (oldValue the previous RegisterValue), and as a
 * convenience from `beforeUnmount` (value undefined).
 *
 * Handles every transition: persist flag flipping in either direction,
 * `register()` path changing (e.g. dynamic v-for index), and the
 * cross-form / cross-SFC case where `register()` returns a value bound
 * to a different FormStore (different `persistOptIns` instance).
 */
function syncPersistOptIn(el: HTMLElement, value: unknown, oldValue: unknown): void {
  const wasOptedIn = isRegisterValue(oldValue) && oldValue.persist === true
  const wantsOptIn = isRegisterValue(value) && value.persist === true
  if (!wasOptedIn && !wantsOptIn) return
  const elementId = getOrAssignElementId(el)
  // Detach the old opt-in unless every dimension matches (persist still
  // requested, same canonical path, same registry instance).
  if (wasOptedIn) {
    const old = oldValue as RegisterValue
    const samePathAndRegistry =
      wantsOptIn &&
      (value as RegisterValue).path === old.path &&
      (value as RegisterValue).persistOptIns === old.persistOptIns
    if (!samePathAndRegistry) {
      old.persistOptIns.remove(elementId, old.path)
    }
  }
  // Attach the new opt-in. `add` is idempotent, so if oldValue already
  // had the same (path, registry) we just re-touch the same entry.
  // The sensitive-name check fires here (not on every keystroke) — it's
  // the act of OPTING IN that crosses the compliance threshold.
  if (wantsOptIn) {
    const v = value as RegisterValue
    enforceSensitiveCheck(v.path, v.acknowledgeSensitive)
    v.persistOptIns.add(elementId, v.path)
  }
}

function onCompositionStart(e: Event) {
  const target = e.target as ComposingTarget
  if (!target) return

  target.composing = true
}

function onCompositionEnd(e: Event) {
  const target = e.target as ComposingTarget
  if (target?.composing === true) {
    target.composing = false
    target.dispatchEvent(new Event('input'))
  }
}

function makeNoopAssigner(): CustomDirectiveRegisterAssignerFn {
  const noop: CustomDirectiveRegisterAssignerFn = (_) => undefined
  // Tag so `shouldBailListener` recognizes this as the default,
  // alongside the real default-model assigner.
  ;(noop as unknown as DefaultAssignerCarrier)[DEFAULT_ASSIGNER_TAG] = true
  return noop
}

function setAssignFunction(
  el: HTMLElement & { [AssignKey: symbol]: CustomDirectiveRegisterAssignerFn },
  vnode: VNode,
  value: RegisterValue<unknown> | undefined
) {
  // Pre-install respect: if the consumer installed `el[assignKey]`
  // BEFORE this directive's `created` hook ran (e.g. via a companion
  // directive ordered first in `withDirectives`, or by a custom
  // element's constructor), preserve their assigner across the
  // entire directive lifecycle. The default assigner is a fallback
  // for the common case where nobody overrides; it should NEVER
  // clobber an explicit consumer override.
  if (el[assignKey] !== undefined && !isDefaultAssigner(el[assignKey])) {
    return
  }

  // Invariant 4: `v-register="undefined"` is a graceful no-op. The
  // composable `useRegister()` returns `ComputedRef<undefined>` when
  // a child is rendered standalone (no parent passed registerValue);
  // the inner `<input v-register="register">` lands undefined here
  // and we silently install a no-op assigner. The composable already
  // emitted its own dev-warn at the call site, so a second warn from
  // the directive would be redundant noise.
  //
  // Other non-RegisterValue types still fall through to the warn —
  // those are likely typos (passing a string, an object literal, the
  // form API itself, etc.) and the developer benefits from a hint.
  if (value === undefined) {
    el[assignKey] = makeNoopAssigner()
    return
  }
  if (!isRegisterValue(value)) {
    warn(
      `v-register expected value of type RegisterValue, got value of type ${typeof value} instead. Please check your v-register value.`
    )
    el[assignKey] = makeNoopAssigner()
    return
  }

  el[assignKey] = getModelAssigner(el, vnode, value)
}

// We are exporting the v-model runtime directly as vnode hooks so that it can
// be tree-shaken in case v-model is never used.
const vRegisterText: RegisterTextCustomDirective = {
  created(el, { value, modifiers: { lazy, trim, number } }, vnode) {
    const castToNumber = number === true || vnode.props?.['type'] === 'number'
    if (isRegisterValue(value)) {
      value.registerElement(el)
      setAssignFunction(el, vnode, value)
    }
    addEventListener(el, lazy === true ? 'change' : 'input', (e) => {
      // Bail if this listener was attached on a non-supported root
      // (a `<label>` / `<div>` etc.) AND the assigner is the default.
      // The bubbled-write bug fires here without this guard: a
      // descendant's `input` event reaches this handler, reads
      // `el.value` off the wrapper (`''` in jsdom, `undefined` in
      // browsers), and clobbers the form. See `shouldBailListener`.
      if (shouldBailListener(el)) return
      const target = e.target as ComposingTarget
      if (target === null || target.composing) return
      let domValue: string | number = el.value
      if (trim === true) {
        domValue = domValue.trim()
      }
      if (castToNumber) {
        domValue = looseToNumber(domValue)
      }
      el[assignKey]?.(domValue)
    })
    if (trim === true) {
      addEventListener(el, 'change', () => {
        if (shouldBailListener(el)) return
        el.value = el.value.trim()
      })
    }
    if (lazy !== true) {
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
    if ((el as { composing?: boolean }).composing === true) return
    if (!isRegisterValue(value)) return

    const elValue =
      (number === true || el.type === 'number') && !/^0\d/.test(el.value)
        ? looseToNumber(el.value)
        : el.value
    const newValue = value.innerRef.value === null ? '' : value.innerRef.value

    if (elValue === newValue) {
      return
    }

    if (document.activeElement === el && el.type !== 'range') {
      // #8546
      if (lazy === true && value.innerRef.value === oldValue) {
        return
      }
      if (trim === true && el.value.trim() === newValue) {
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
      if (shouldBailListener(el)) return
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
      if (shouldBailListener(el)) return
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
      if (shouldBailListener(el)) return
      const selectedVal = Array.prototype.filter
        .call(el.options, (o: HTMLOptionElement) => o.selected)
        .map((o: HTMLOptionElement) => (number === true ? looseToNumber(getValue(o)) : getValue(o)))
      el[assignKey]?.(
        el.multiple ? (isSetModel ? new Set(selectedVal) : selectedVal) : selectedVal[0]
      )
      el._assigning = true
      void nextTick(() => {
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
    if (el._assigning !== true) {
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
    if (__DEV__) {
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

// Tags the directive's text/checkbox/radio/select variants handle
// natively. A v-register binding on anything else (a `<div>`, a
// `<span>`, a Vue component whose root is a non-form element) gets
// listeners attached normally — but the listener bodies bail (via
// `shouldBailListener`) when the assigner is still the default. This
// prevents the bubbled-write bug while letting consumer-installed
// `assignKey` / `@update:registerValue` shapes flow through.
//
// The dev-warn for the "no escape hatch" case is deferred to the
// next tick after `created`, so `useRegister`'s `onMounted` marker
// has a chance to set `REGISTER_OWNER_MARKER` on the rendered root
// before the warn check runs. Without the deferral, deeply-nested
// `useRegister` children would always warn (the directive can't
// reach the child instance via `binding.instance` — that's the
// page/parent component, whose `subTree` is the outer element tree,
// not the child component vnode directly).
const SUPPORTED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

// One-shot dev-warn dedupe so a v-for over 100 unsupported elements
// produces one warning, not 100. Keyed by element identity (WeakSet
// for GC-friendliness).
const warnedUnsupportedElements: WeakSet<HTMLElement> | null = __DEV__
  ? new WeakSet<HTMLElement>()
  : null

const vRegisterDynamic: RegisterModelDynamicCustomDirective = {
  created(el, binding, vnode) {
    // Per-element persist opt-in is reconciled at the dynamic level so
    // the per-tag variants stay focused on their input semantics.
    syncPersistOptIn(el, binding.value, undefined)

    // Always run the per-tag variant's `created` — listener-body bail
    // (`shouldBailListener`) prevents the bubbled-write bug on
    // non-supported roots while letting consumer overrides through.
    callModelHook(el, binding, vnode, null, 'created')

    // Defer the unsupported-element warn to nextTick. By then:
    //  - useRegister's onMounted has run, setting REGISTER_OWNER_MARKER
    //    on the el if the child component called useRegister()
    //  - any post-install assignKey override (via onMounted /
    //    ref-callback) is in place, so the assigner isn't default
    // anymore. The warn fires only when neither escape hatch was used.
    if (
      __DEV__ &&
      warnedUnsupportedElements !== null &&
      !SUPPORTED_TAGS.has(el.tagName) &&
      !warnedUnsupportedElements.has(el)
    ) {
      void nextTick(() => {
        if (warnedUnsupportedElements.has(el)) return
        const hasMarker =
          (el as unknown as { [k: symbol]: unknown })[REGISTER_OWNER_MARKER] === true
        const hasUserAssigner = !isDefaultAssigner(
          (el as unknown as { [k: symbol]: unknown })[assignKey]
        )
        if (hasMarker || hasUserAssigner) return
        warnedUnsupportedElements.add(el)
        warn(
          `[@chemical-x/forms] v-register on <${el.tagName.toLowerCase()}> is a no-op — ` +
            `non-input roots aren't bound to text-input semantics. For custom components: ` +
            `call \`useRegister()\` in the child's setup and re-bind v-register to an inner ` +
            `native element. Lower-level: install a custom assigner via the \`assignKey\` ` +
            `symbol on the element.`
        )
      })
    }
  },
  mounted(el, binding, vnode) {
    callModelHook(el, binding, vnode, null, 'mounted')
  },
  beforeUpdate(el, binding, vnode, prevVNode) {
    // Reactive opt-in toggling: `register('foo', { persist: rememberMe })`
    // re-evaluates on every parent render. `binding.oldValue` holds the
    // prior RegisterValue so the helper can diff persist / path / registry
    // and migrate the entry without thrashing.
    syncPersistOptIn(el, binding.value, binding.oldValue)
    callModelHook(el, binding, vnode, prevVNode, 'beforeUpdate')
  },
  updated(el, binding, vnode, prevVNode) {
    callModelHook(el, binding, vnode, prevVNode, 'updated')
  },
  beforeUnmount(el, { value }) {
    // Detach every listener the variant attached in `created`, regardless
    // of whether the binding is still a valid RegisterValue. An element
    // re-used by KeepAlive / v-show would otherwise double its listener
    // count on the next activation cycle.
    removeTrackedListeners(el)

    // Drop every opt-in this element ever held — `removeAllFor` sweeps
    // by elementId rather than (id, path), which covers the case where
    // the binding's path changed across updates and we don't want to
    // hunt for the latest entry.
    if (isRegisterValue(value)) {
      value.persistOptIns.removeAllFor(getOrAssignElementId(el))
    }

    if (!isRegisterValue(value)) return

    value.deregisterElement(el)

    // Remove internal state that the directive attaches directly to the
    // element. If the element is reused (<KeepAlive>, v-show), stale flags
    // like `composing: true` (IME in progress) would swallow user input.
    // The pre-rewrite code left these in place — a silent bug.
    delete (el as { composing?: boolean }).composing
    delete (el as { _assigning?: boolean })._assigning
    delete (el as unknown as { [k: symbol]: unknown })[assignKey]
  },
}

// No-op variant for <input type="file">. Setting el.value on a file input
// throws a DOMException for security reasons; the compile-time transform
// skips this case, and this runtime directive routes reactive type="file"
// (e.g. `:type="isUpload ? 'file' : 'text'"`) to a no-op too, still tracking
// the element for focus-state purposes.
const vRegisterFileNoop: RegisterModelDynamicCustomDirective = {
  created(el, { value }) {
    if (!isRegisterValue(value)) return
    value.registerElement(el)
    if (__DEV__) {
      warn(
        '[@chemical-x/forms] v-register on <input type="file"> is not supported. ' +
          'Handle uploads with a manual @change listener.'
      )
    }
  },
  beforeUnmount(el, { value }) {
    // The file-input variant attaches no listeners, but we still drain
    // the bag defensively — a runtime-typed `:type` binding that flipped
    // from 'text' to 'file' on a reused element would have left the text
    // variant's listeners attached.
    removeTrackedListeners(el)
    if (!isRegisterValue(value)) return
    value.deregisterElement(el)
  },
}

function resolveDynamicModel(tagName: string, type: unknown) {
  // tagName is always uppercase per DOM spec (el.tagName); type comes from
  // vnode.props and is usually a string, but reactive bindings (`:type="x"`)
  // can pass other values — guard defensively.
  if (tagName === 'SELECT') return vRegisterSelect
  if (tagName === 'TEXTAREA') return vRegisterText
  if (typeof type !== 'string') return vRegisterText
  if (type === 'file') return vRegisterFileNoop
  if (type === 'checkbox') return vRegisterCheckbox
  if (type === 'radio') return vRegisterRadio
  return vRegisterText
}

function callModelHook(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  binding: DirectiveBinding,
  vnode: VNode,
  prevVNode: VNode | null,
  hook: keyof ObjectDirective
) {
  const modelToUse = resolveDynamicModel(el.tagName, vnode.props?.['type'])
  const fn = modelToUse[hook] as DirectiveHook | undefined
  fn?.(el, binding, vnode, prevVNode)
}

export type VXCustomDirective =
  | typeof vRegisterText
  | typeof vRegisterCheckbox
  | typeof vRegisterSelect
  | typeof vRegisterRadio
  | typeof vRegisterDynamic

/**
 * The single exported directive, installed by `createChemicalXForms()` via
 * `app.directive('register', vRegister)`. Dispatches to the per-element-type
 * directive based on tagName + type.
 */
export const vRegister = vRegisterDynamic
