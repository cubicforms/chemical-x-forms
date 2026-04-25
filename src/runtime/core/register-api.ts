import { computed, type Ref } from 'vue'
import type { RegisterValue } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { canonicalizePath, type Path } from './paths'

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

export function buildRegister<F extends GenericForm>(state: FormStore<F>) {
  return function register(pathInput: string | Path): RegisterValue<unknown> {
    const { segments } = canonicalizePath(pathInput)

    const innerRef = computed(() => state.getValueAtPath(segments)) as Readonly<Ref<unknown>>

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

      setValueWithInternalPath: (value: unknown): boolean => {
        state.setValueAtPath(segments, value)
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
    }
  }
}
