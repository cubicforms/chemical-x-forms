/**
 * The `v-register` directive. Two-way binding with `v-model`-like
 * semantics, but writes go through the form's `RegisterValue` so
 * dirty / pristine / touched / errors stay coherent across the form.
 *
 * Bind to a native input, select, textarea, checkbox, or radio:
 *
 * ```vue
 * <input v-register="form.register('email')" />
 * ```
 *
 * Installed automatically by `createChemicalXForms()`; the export is
 * for advanced consumers who install directives manually. Works
 * identically under Nuxt, bare Vue CSR, and bare Vue +
 * `@vue/server-renderer` — Vue skips directive lifecycle hooks during
 * SSR, so the directive is a safe no-op server-side.
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

/**
 * Symbol slot used by custom directive integrations to install an
 * assigner on the bound element. Read by the v-register directive
 * when a DOM event fires:
 *
 * ```ts
 * import { assignKey } from '@chemical-x/forms'
 * el[assignKey] = (value) => myCustomWriter(value)
 * ```
 *
 * Most consumers never need this — the built-in directives wire
 * default assigners for text inputs, checkboxes, radios, and selects.
 */
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

/**
 * Type guard for a `RegisterValue`. Returns `true` when `val` looks
 * like the object returned from `form.register(path)`.
 *
 * ```ts
 * if (isRegisterValue(slotValue)) {
 *   // slotValue.innerRef is now a Ref<unknown>
 * }
 * ```
 *
 * Useful when building wrapper components that accept either a
 * `RegisterValue` or a plain ref via the same prop.
 */
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
    return (value) => {
      invokeArrayFns(
        fn.filter((x) => isFunction(x)) as ((...args: unknown[]) => unknown)[],
        value,
        registerValue
      )
      // Multi-listener case: no single boolean to surface. Return
      // undefined so the listener treats this as "succeeded" — matches
      // the back-compat contract for consumer-installed assigners.
      return undefined
    }
  }
  if (isFunction(fn)) {
    return fn as CustomDirectiveRegisterAssignerFn
  }
  // Default-installed assigner. Tagged so the listener-body bail
  // (`shouldBailListener`) can distinguish it from consumer overrides
  // and prevent the bubbled-write bug on non-supported roots.
  //
  // Returns the underlying setValue boolean so listeners (e.g.
  // vRegisterSelect's change handler) can detect rejection and gate
  // post-write side effects like the `_assigning` flag.
  const defaultAssigner: CustomDirectiveRegisterAssignerFn = (value) => {
    return registerValue.setValueWithInternalPath(value, computePersistMeta(el, registerValue))
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

/**
 * Migrate the element's registration entry across binding-value
 * transitions. Symmetric with `syncPersistOptIn` for the
 * persistence opt-in dimension; this one tracks element-to-path
 * registration the form's element map relies on for
 * `getFieldState(path).meta.isConnected`, `focusFirstError`, and
 * `scrollToFirstError`.
 *
 * Cases:
 *   - undefined → undefined: nothing to do.
 *   - undefined → RV: register the new RV's element (the per-tag
 *     `created` hook skipped this when the binding mounted with an
 *     undefined value, so we have to catch up here).
 *   - RV → undefined: deregister the old RV's element.
 *   - RV → RV (same path + same form): no-op. `register('foo')`
 *     returns a fresh closure on every parent re-render; without
 *     the early-out, every tick would deregister-and-re-register
 *     the element, thrashing the `isConnected` flag.
 *   - RV → RV (different path or different form): deregister old,
 *     register new. Covers dynamic-path templates
 *     (`v-register="form.register(\`item.${i}\`)"`) and the
 *     cross-form case where a wrapper component switches the
 *     `registerValue` it forwards.
 */
function syncElementRegistration(el: HTMLElement, value: unknown, oldValue: unknown): void {
  const wasRegistered = isRegisterValue(oldValue)
  const isRegistered = isRegisterValue(value)
  if (!wasRegistered && !isRegistered) return

  if (wasRegistered && isRegistered) {
    const old = oldValue
    const next = value
    if (old.path === next.path && old.persistOptIns === next.persistOptIns) return
  }

  if (wasRegistered) {
    oldValue.deregisterElement(el)
  }
  if (isRegistered) {
    value.registerElement(el)
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
      `v-register expected a RegisterValue, got '${typeof value}'. ` +
        `Bind to form.register('field') — not the field's ref, value, or path string.`
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
      // Deferred-to-blur trim: only trim here when this listener is
      // already on `change` (i.e. `.lazy.trim`). Per-keystroke trim
      // on the `input` event fights Vue's `:value` patch — when the
      // user types a trailing space the trimmed write reaches the
      // model first, Vue's patch then sees `el.value` ahead of the
      // model and rewrites the DOM back to the trimmed form,
      // swallowing the space the user is still typing. The `change`-
      // bound normalization listener below catches the canonical
      // trimmed write at blur instead.
      if (trim === true && lazy === true) {
        domValue = domValue.trim()
      }
      if (castToNumber) {
        // Empty after the (deferred) trim — most commonly a backspace-
        // clear on `<input type="number">` or a `.number` text input.
        // Mark the path blank rather than skipping silently:
        // storage gets the slim default (0), the UI shows blank via
        // `displayValue.value === ''`, and submit-time validation
        // raises "No value supplied" if the schema demands a number (the
        // public-housing footgun fix). Without this, the directive's
        // pre-fix skip-on-empty silently desynced storage from UI.
        //
        // `<input type="number">` quirk: the browser blanks `el.value`
        // mid-typing for malformed input (`1e` is incomplete scientific
        // notation, so the browser hides the typed text from
        // `el.value` even though it's still visually in the DOM).
        // `validity.badInput` is `true` in that case and `false` for
        // a genuine empty field — we use it to distinguish a real
        // user-clear (mark) from a transient mid-edit (skip). Without
        // this guard, typing `1e` into a `type="number"` field fires
        // `markBlank`, `displayValue` recomputes to `''`,
        // Vue patches the DOM and yanks the user's `1e` away.
        if (domValue === '') {
          // Guard against non-input elements with custom assigners
          // (the directive bails on default-assigner non-inputs via
          // `shouldBailListener`, but a consumer-installed assigner
          // can land on any tag — `validity` only exists on form
          // controls). The cast types `validity` as optional to
          // capture that shape.
          const validity = (el as { validity?: ValidityState }).validity
          if (validity?.badInput === true) {
            return
          }
          if (isRegisterValue(value)) {
            value.lastTypedForm.value = null
            value.markBlank()
          }
          return
        }
        const typedString = domValue
        domValue = looseToNumber(domValue)
        if (typeof domValue !== 'number') {
          // Non-castable garbage like "abc" — text input with `.number`,
          // not protected by the beforeinput filter (e.g. consumer
          // pasted via JS or programmatic `el.value = 'abc'`). Treat
          // as the empty case so the gate's slim-primitive rejection
          // doesn't surface a dev warning for a transient mid-edit
          // state.
          if (isRegisterValue(value)) {
            value.lastTypedForm.value = null
            value.markBlank()
          }
          return
        }
        if (!Number.isFinite(domValue)) {
          // Overflow: parseFloat returned Infinity / -Infinity for
          // values past Number.MAX_VALUE (e.g. `1e309`). Don't commit
          // — Zod's z.number() rejects non-finite, and
          // JSON.stringify() renders Infinity as `null`, both confusing
          // for devs and downstream consumers. Snap the DOM back to
          // the last good displayValue so the user gets immediate
          // visual feedback that their input was rejected (analogous
          // to a native `<input type="number" max>` cap). Storage
          // stays at whatever the last finite write committed.
          if (isRegisterValue(value)) {
            const target = value.displayValue.value
            if (el.value !== target) el.value = target
          }
          return
        }
        // Castable: record the user's typed string so `displayValue`
        // surfaces it mid-typing. Storage commits real-time via the
        // assigner below; without `lastTypedForm`, Vue's `:value`
        // patch would write `String(cast)` (e.g. `'100'`) into the
        // DOM and yank the user away from the `1e2` they're typing.
        // The blur normalizer clears `lastTypedForm` so the post-blur
        // DOM matches storage exactly.
        if (isRegisterValue(value)) value.lastTypedForm.value = typedString
      }
      el[assignKey]?.(domValue)
    })
    if (trim === true || castToNumber) {
      addEventListener(el, 'change', () => {
        if (shouldBailListener(el)) return
        // Mirror Vue's `castValue(el.value, trim, castToNumber)` so the
        // visible DOM normalizes after blur for both modifiers — without
        // the cast branch, a user typing ` 12 ` into a `.number` input
        // sees ` 12 ` stick after blur instead of `12`.
        let normalized: string | number = el.value
        if (trim === true) normalized = normalized.trim()
        if (castToNumber) {
          const cast = looseToNumber(normalized)
          if (typeof cast === 'number' && Number.isFinite(cast)) {
            // Blur: clear the typed-form override so `displayValue`
            // returns `String(storage)`. The DOM then patches to the
            // canonical form (`'1e2'` → `'100'`, `'01'` → `'1'`,
            // `'1.'` → `'1'`). Honest by design — what the user sees
            // after blur matches what's in storage. The model commit
            // is gated on `lazy !== true` because the lazy listener
            // already wrote on the same change event ahead of this
            // handler.
            if (isRegisterValue(value)) value.lastTypedForm.value = null
            el.value = String(cast)
            if (lazy !== true) el[assignKey]?.(cast)
          } else {
            // Uncastable mid-edit residue (lone '.', '-', 'abc') OR
            // overflow (`1e309` parses to Infinity). Native
            // `<input type="number">` blur behaviour clears in both
            // cases; we match that. The keystroke listener has
            // already markBlank'd uncastable input under
            // non-lazy, but under `.lazy.number` (or for an overflow
            // pasted directly via the change event) this is the first
            // chance, so re-mark defensively.
            if (isRegisterValue(value)) {
              value.lastTypedForm.value = null
              value.markBlank()
            }
            el.value = ''
          }
          return
        }
        el.value = typeof normalized === 'number' ? String(normalized) : normalized
        // Catch up the model on blur for non-lazy `.trim`. The input
        // listener wrote the raw mid-typing value (deferred trim);
        // here on `change` we commit the canonical trimmed form so
        // the DOM and the model agree once the user leaves the
        // field. Under `.lazy.trim`, the input listener (on
        // `change`) already wrote the trimmed value, so this branch
        // skips to avoid a redundant duplicate write.
        if (trim === true && lazy !== true) {
          el[assignKey]?.(normalized)
        }
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
    // `.number` × text input — block non-numeric characters at the
    // DOM layer so `el.value` never holds garbage. Native
    // `<input type="number">` already filters at the browser layer,
    // so we skip the listener there to avoid double-filtering. The
    // regex allows an optional leading `-`, a single `.`, any number
    // of digits, and an optional scientific-notation suffix
    // (`[eE][+-]?\d*`) so devs get parity with native `type="number"`
    // for inputs like `1e3`. Partial states (just `-`, `1.`, `1e`,
    // `1e-`) are accepted as the user is still typing; the blur
    // normalizer commits the cast value (or clears the DOM if the
    // residue is non-castable). Composition events
    // (`insertCompositionText`) aren't blocked — IME input proceeds
    // normally and the directive's `compositionend` handler catches
    // the final value.
    if (number === true && vnode.props?.['type'] !== 'number') {
      addEventListener(el, 'beforeinput', (e) => {
        const ev = e as InputEvent
        if (
          ev.inputType !== 'insertText' &&
          ev.inputType !== 'insertFromPaste' &&
          ev.inputType !== 'insertFromDrop'
        ) {
          return
        }
        const data = ev.data
        if (data === null) return
        const start = el.selectionStart ?? 0
        const end = el.selectionEnd ?? 0
        const next = el.value.slice(0, start) + data + el.value.slice(end)
        if (!/^-?\d*\.?\d*([eE][+-]?\d*)?$/.test(next)) ev.preventDefault()
      })
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
    // Skip the el.value sync while the user is mid-IME-composition;
    // overwriting `el.value` would clobber the unresolved input.
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

    // ShadowRoot-aware activeElement check: a v-register'd input mounted
    // inside a shadow tree's `activeElement` lives on the rootNode, not
    // on `document`. Falling back to `document.activeElement === el` for
    // shadow-mounted inputs would always be `false`, defeating the
    // lazy/trim escape-hatches below.
    const rootNode = el.getRootNode()
    const activeElement =
      rootNode instanceof Document || rootNode instanceof ShadowRoot ? rootNode.activeElement : null
    if (activeElement === el && el.type !== 'range') {
      // Lazy escape: the consumer chose `change`-only updates. While
      // the user is still editing, suppress reverse-syncs that would
      // otherwise revert their typing on every parent re-render.
      if (lazy === true && value.innerRef.value === oldValue) {
        return
      }
      // Trim escape: same rationale — the trimmed-but-otherwise-equal
      // value is what we'd land on at blur anyway, so don't fight the
      // user's whitespace mid-typing.
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
            'Checkbox bound to an array model is missing a `value` attribute — ' +
              'cannot determine which item to add or remove. ' +
              'Add value="..." to each <input type="checkbox">.'
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
            'Checkbox bound to a Set model is missing a `value` attribute — ' +
              'cannot determine which item to add or remove. ' +
              'Add value="..." to each <input type="checkbox">.'
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

function setChecked(el: HTMLInputElement, { value, oldValue }: DirectiveBinding, _vnode: VNode) {
  // store the v-registerer value on the element so it can be accessed by the
  // change listener.
  if (!isRegisterValue(value)) return

  const originalValue = value.innerRef.value
  let checked: boolean

  // Read the option-value via `getValue(el)` rather than
  // `vnode.props?.['value']`. On SSR + hydration, Vue skips
  // `patchProp` for hoisted static `value="..."` attributes — vnode
  // props don't carry the value AND `el._value` is never set, so the
  // old code returned undefined and unchecked the box even when the
  // DOM `value` attribute matched the model. `getValue` (post the
  // static-attr fix) checks `_value` first, then the DOM property,
  // so all three paths (Vue dynamic, Vue hydrated static, manual
  // setAttribute) resolve identically.
  if (isArray(originalValue)) {
    checked = looseIndexOf(originalValue, getValue(el)) > -1
  } else if (isSet(originalValue)) {
    checked = originalValue.has(getValue(el))
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
    setAssignFunction(el, vnode, value)
    addEventListener(el, 'change', () => {
      if (shouldBailListener(el)) return
      el[assignKey]?.(getValue(el))
    })
  },
  // Initial checked-state sync runs in `mounted`, NOT `created` —
  // Vue's directive lifecycle fires `created` BEFORE the element's
  // attributes are patched (`type`, `value`, `_value` etc. aren't on
  // the element yet), so `getValue(el)` would return `undefined` and
  // every radio in a group would mount unchecked regardless of the
  // model. Checkbox already uses `mounted: setChecked` for the same
  // reason.
  mounted(el, { value }) {
    if (!isRegisterValue(value)) return
    // Read the option-value via `getValue(el)` rather than
    // `vnode.props?.['value']` so SSR-hydrated static `value="..."`
    // attributes (which don't surface in vnode.props because Vue's
    // static-attr fast path skips patchProp) still resolve correctly.
    el.checked = looseEqual(value.innerRef.value, getValue(el))
  },
  beforeUpdate(el, { value, oldValue }, vnode) {
    if (!isRegisterValue(value)) return

    setAssignFunction(el, vnode, value)
    if (value.innerRef.value !== oldValue) {
      el.checked = looseEqual(value.innerRef.value, getValue(el))
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
      const wrote = el[assignKey]?.(
        el.multiple ? (isSetModel ? new Set(selectedVal) : selectedVal) : selectedVal[0]
      )
      // Only set `_assigning` when the write actually landed. A
      // rejected write (slim-primitive gate said no) should NOT
      // suppress the next `updated` hook's `setSelected` — we want
      // the DOM to revert to `innerRef.value` since the form state
      // didn't change. `undefined` from a consumer-installed assigner
      // counts as "succeeded" for back-compat (their assigner has no
      // way to signal otherwise).
      if (wrote !== false) {
        el._assigning = true
        void nextTick(() => {
          el._assigning = false
        })
      }
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

function setSelected(el: HTMLSelectElement, value: unknown) {
  if (!isRegisterValue(value)) return

  // Use the model value directly — mirrors Vue's reference
  // `vModelSelect.setSelected`. Pre-fix this went through a
  // `getBaseValue` indirection that read DOM-current selection state
  // instead of the model, returning an empty Set for single-select
  // numeric models. The downstream `looseEqual('1', Set{})` always
  // failed, so `selectedIndex` ended at `-1` (no option highlighted)
  // even though the bound value matched an option. Single-select with
  // number / string / boolean now correctly drives the DOM via
  // `looseEqual` (which coerces primitives through `String(...)`),
  // and multi-select uses the Array / Set membership it always did.
  const externalValue = value.innerRef.value
  const isMultiple = el.multiple
  const isArrayValue = isArray(externalValue)

  if (isMultiple && !isArrayValue && !isSet(externalValue)) {
    if (__DEV__) {
      warn(
        `<select multiple v-register> expected an Array or Set, got ` +
          `${Object.prototype.toString.call(externalValue).slice(8, -1)}. ` +
          `Bind to a list-typed schema (e.g. z.array(z.string()) or z.set(z.string())).`
      )
    }
    return
  }
  // Symmetric misuse: non-multiple select bound to an Array / Set
  // model. The change handler would write `selectedVal[0]` (scalar)
  // back, which the slim-primitive gate rejects against an Array
  // path — so the user's clicks silently fail. Mount-time
  // `looseEqual('a', ['a', 'b'])` also returns false, so no option
  // ever appears highlighted. Bail with a dev-warn pointing at the
  // fix (`add multiple` for list bindings, or use a scalar model).
  if (!isMultiple && (isArrayValue || isSet(externalValue))) {
    if (__DEV__) {
      warn(
        `<select v-register> (no \`multiple\` attribute) expected a scalar value for its ` +
          `binding, but got ${Object.prototype.toString.call(externalValue).slice(8, -1)}. ` +
          `Add the \`multiple\` attribute to bind to a list, or use a scalar schema (e.g. ` +
          `\`z.string()\`) for a single-select binding.`
      )
    }
    return
  }

  if (isMultiple) {
    // Precompute a `Set<string>` of stringified model members once,
    // then do O(1) lookups per option. Drops the per-option work
    // from O(N) to O(1), so total `setSelected` cost is O(N + M)
    // for an N-item model and an M-option <select> — matters for
    // long forms (thousands of options or selected items). Both
    // Array and Set primitive paths share this; only object-valued
    // option binds (rare) keep their original identity comparisons.
    const stringifiedMembers = new Set<string>()
    const iter: Iterable<unknown> = isArrayValue
      ? (externalValue as ReadonlyArray<unknown>)
      : (externalValue as Set<unknown>)
    for (const v of iter) stringifiedMembers.add(String(v))

    for (let i = 0, l = el.options.length; i < l; i++) {
      const option = el.options[i]
      if (!option) continue
      const optionValue = getValue(option)
      const optionType = typeof optionValue
      if (optionType === 'string' || optionType === 'number') {
        option.selected = stringifiedMembers.has(String(optionValue))
      } else if (isArrayValue) {
        // Object option, Array model: structural equality via
        // `looseIndexOf` (mirrors Vue's reference).
        option.selected = looseIndexOf(externalValue, optionValue) > -1
      } else {
        // Object option, Set model: identity-based `.has` (Sets
        // can't structurally compare without iterating, and Vue's
        // reference uses identity here).
        option.selected = (externalValue as Set<unknown>).has(optionValue)
      }
    }
    return
  }

  // Non-multiple: find the first option matching the scalar model
  // and set selectedIndex; clear if nothing matches.
  for (let i = 0, l = el.options.length; i < l; i++) {
    const option = el.options[i]
    if (!option) continue
    if (looseEqual(getValue(option), externalValue)) {
      if (el.selectedIndex !== i) el.selectedIndex = i
      return
    }
  }
  if (el.selectedIndex !== -1) el.selectedIndex = -1
}

// retrieve raw value set via :value bindings
//
// `explicitRequired` is the checkbox-array / checkbox-Set caller's way
// of saying "the user must have provided an option-value via either a
// dynamic `:value` binding (Vue sets `el._value`) OR a static `value`
// attribute (DOM has `value` attribute set). If neither is present,
// the default `el.value` of 'on' would silently add the bogus literal
// 'on' to the array on every toggle — surface as undefined so the
// caller can warn instead."
//
// Without the `hasAttribute('value')` fallback, the SSR + static-attr
// hydration path fails: Vue's hydration skips patchProp for hoisted
// static attributes, `el._value` is never set, but the DOM still
// reflects the rendered `value="apple"` attribute. We need to honor
// either signal.
function getValue(el: HTMLOptionElement | HTMLInputElement, explicitRequired = false) {
  if ('_value' in el) return el._value
  if (explicitRequired && !el.hasAttribute('value')) return undefined
  return el.value
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
    // Same diff for the form's element map. Catches the
    // `useRegister`-driven swap (binding mounted with `undefined`,
    // a real RV arrives on the next render), the dynamic-path case,
    // and the cross-form swap. Same-path + same-form transitions
    // short-circuit so identity-stable bindings don't thrash.
    syncElementRegistration(el, binding.value, binding.oldValue)
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
 * The `v-register` directive. Bind a form field to a native input,
 * select, textarea, checkbox, or radio:
 *
 * ```vue
 * <input v-register="form.register('email')" />
 * <select v-register="form.register('country')">
 *   <option value="us">US</option>
 *   <option value="uk">UK</option>
 * </select>
 * ```
 *
 * The directive picks the right binding strategy automatically based
 * on the element's `tagName` and `type`. Registered globally by
 * `createChemicalXForms()` — most consumers never import it
 * directly, but it's exposed for advanced integrations that wire
 * directives manually.
 */
export const vRegister = vRegisterDynamic
