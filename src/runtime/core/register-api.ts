import { computed, type Ref } from 'vue'
import type { RegisterOptions, RegisterValue, WriteMeta } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { __DEV__ } from './dev'
import { canonicalizePath, type Path } from './paths'
import { PERSISTENCE_MODULE_KEY } from './persistence'

/**
 * Register API factory. Given a FormStore, returns a `register(path)` that
 * produces a RegisterValue suitable for the v-register directive.
 *
 * Changes from the pre-rewrite register.ts:
 *
 * - No `elementHelperCache`: that cache was a workaround for the
 *   inefficiency of recreating focus/blur listeners per registration.
 *   Now, listeners are created per-element-registration and stored on the
 *   element itself via a symbol, then removed on deregistration. Simpler
 *   and less state.
 * - No metaTracker.rawValue aliasing: innerRef reads form.value directly
 *   via getValueAtPath. The pre-rewrite code dual-tracked raw vs form
 *   values to paper over reactive-update timing; with the new synchronous
 *   diff-apply writer, that's unnecessary.
 * - Cross-form isolation is by construction: every call to buildRegister
 *   closes over a FormStore<F> unique to one form.
 */

const INTERACTIVE_TAG_NAMES = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

const cxListenersSymbol: unique symbol = Symbol('chemical-x-forms:focus-listeners')

type ElementWithListeners = HTMLElement & {
  [cxListenersSymbol]?: {
    handleFocus: (event: FocusEvent) => void
    handleBlur: (event: FocusEvent) => void
  }
}

function attachFocusListeners<F extends GenericForm>(
  state: FormStore<F>,
  segments: Path,
  element: HTMLElement
): void {
  const target = element as ElementWithListeners
  if (target[cxListenersSymbol] !== undefined) return
  const handleFocus = (): void => state.markFocused(segments, true)
  const handleBlur = (): void => state.markFocused(segments, false)
  element.addEventListener('focus', handleFocus)
  element.addEventListener('blur', handleBlur)
  target[cxListenersSymbol] = { handleFocus, handleBlur }
}

function detachFocusListeners(element: HTMLElement): void {
  const target = element as ElementWithListeners
  const listeners = target[cxListenersSymbol]
  if (listeners === undefined) return
  element.removeEventListener('focus', listeners.handleFocus)
  element.removeEventListener('blur', listeners.handleBlur)
  delete target[cxListenersSymbol]
}

/**
 * Dedupes the dev-mode "register({ persist: true }) without `persist:`
 * configured" warning. Keyed by FormStore so each form warns at most
 * once across all of its `register()` call sites — multiple paths
 * opting in produce one warning, not N. WeakSet auto-clears when the
 * FormStore is GC'd, so a remount with a different config gets a
 * fresh check.
 *
 * `null` in production so the WeakSet allocation tree-shakes out.
 */
const warnedMissingPersistConfig: WeakSet<FormStore<GenericForm>> | null = __DEV__
  ? new WeakSet<FormStore<GenericForm>>()
  : null

export function buildRegister<F extends GenericForm>(state: FormStore<F>) {
  return function register(
    pathInput: string | Path,
    options?: RegisterOptions
  ): RegisterValue<unknown> {
    const { segments, key: pathKey } = canonicalizePath(pathInput)

    const innerRef = computed(() => state.getValueAtPath(segments)) as Readonly<Ref<unknown>>

    const persist = options?.persist === true
    const acknowledgeSensitive = options?.acknowledgeSensitive === true

    // Dev-only: opt-in declared but the form has no persistence wired.
    // Without this warning the directive silently records the opt-in,
    // no writes ever land, and the dev concludes "persistence is broken"
    // when the actual issue is a missing `persist:` option on `useForm()`.
    // Symmetric to wirePersistence's "configured but no opt-ins" warning;
    // together they cover both halves of the misuse space. Deduped per
    // FormStore so a template with N opted-in paths produces one warning,
    // not N.
    //
    // Skipped during SSR: `wirePersistence` is intentionally not run on
    // the server (persistence is a client-only concern), so
    // `state.modules.has(PERSISTENCE_MODULE_KEY)` is always false during
    // SSR — even for forms that DID configure `persist:`. Without this
    // gate the warning would falsely fire on every server-rendered
    // `register({ persist: true })`. The client-side hydration pass
    // re-runs the check against a freshly-wired module and warns
    // correctly if the misuse is real.
    if (__DEV__ && persist && !state.isSSR && warnedMissingPersistConfig !== null) {
      const formStore = state as FormStore<GenericForm>
      if (
        !state.modules.has(PERSISTENCE_MODULE_KEY) &&
        !warnedMissingPersistConfig.has(formStore)
      ) {
        warnedMissingPersistConfig.add(formStore)
        const display = segments.map((s) => String(s)).join('.')
        // No inline source frame here. `register()` is overwhelmingly
        // called from compiled `<template>` render functions, where
        // Vite's sourcemap for attribute-value expressions
        // (`v-register="register(...)"`) maps back to the surrounding
        // element / closing-tag region, not the actual `register(`
        // token — adding a frame would be actively misleading. The
        // path name in the message (`'${display}'`) is the reliable
        // anchor: `grep "register('${display}'"` finds the call site.
        // The console auto-renders its own clickable stack below the
        // message anyway.
        console.warn(
          `[@chemical-x/forms] register('${display}', { persist: true }) was used on form ` +
            `"${state.formKey}", but no \`persist:\` option is configured on useForm(). The ` +
            `opt-in is recorded, but no writes will land in any storage backend. Add ` +
            `\`persist: 'local'\` (or another backend) to your useForm() options. To find the ` +
            `offending call, search your codebase for \`register('${display}'\`. See ` +
            `./docs/recipes/persistence.md.`
        )
      }
    }

    return {
      innerRef,

      registerElement: (element: HTMLElement): void => {
        // Skip non-form elements. Prevents accidental registration of
        // component wrapper divs (a fallthrough-attribute scenario in the
        // pre-rewrite code).
        if (!INTERACTIVE_TAG_NAMES.has(element.tagName)) return
        const added = state.registerElement(segments, element)
        if (added) attachFocusListeners(state, segments, element)
      },

      deregisterElement: (element: HTMLElement): void => {
        detachFocusListeners(element)
        state.deregisterElement(segments, element)
      },

      setValueWithInternalPath: (value: unknown, meta?: WriteMeta): boolean => {
        state.setValueAtPath(segments, value, meta)
        return true
      },

      // Called by the `vRegisterHint` compile-time transform's wrapping
      // IIFE on every server-side render of `<element v-register="…">`.
      // Without it, every SSR'd FieldState serialises `isConnected: false`
      // (because Vue skips directive lifecycle during SSR) and the client
      // briefly shows that stale flag until hydration runs the directive's
      // `created` hook. The mark only takes effect when `state.isSSR` is
      // true; on the client this is a no-op so the directive lifecycle
      // remains the source of truth.
      markConnectedOptimistically: (): void => {
        state.markConnectedOptimistically(segments)
      },

      // --- Persistence opt-in (internal; the directive is the only
      // legitimate consumer) ---
      path: pathKey,
      persist,
      acknowledgeSensitive,
      persistOptIns: state.persistOptIns,
    }
  }
}
