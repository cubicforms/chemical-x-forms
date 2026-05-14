import { getCurrentScope, onScopeDispose, readonly, ref } from 'vue'
import { StepperLateRegistrationError } from '../core/errors'
import { useRegistry } from '../core/registry'
import { createStepperRegistry } from '../core/stepper-registry'
import type {
  AnyForm,
  KeysOf,
  StepperNavOptions,
  StepperOptions,
  UseStepperReturnType,
} from '../types/types-stepper'

/**
 * Multistep-form orchestrator. Composes existing `useForm` instances
 * into a wizard with navigation, status aggregation (PR 3), browser
 * history (PR 4), and activation-lifecycle defer (so a step's async
 * `defaultValues` factory only fires when the step becomes current).
 *
 * Construction-time invariants:
 *   - At least one form.
 *   - No duplicate keys across the forms array.
 *   - Each form's `key` is non-empty.
 *
 * Navigation behavior:
 *   - `next()` / `back()` past either end is a silent no-op + dev
 *     console warning. Crashing here would punish consumers who wire
 *     navigation buttons without also disabling them at the bounds.
 *   - `goTo(unknownKey)` throws — typo safety for an explicit jump
 *     the consumer is asking for by literal value.
 *
 * Each form gets a ref-count via `registry.trackConsumer(key)`. This
 * pins the FormStore for the stepper's lifetime — so a step's state
 * survives even when its component is unmounted between visits
 * (v-if pattern). The ref is released on `onScopeDispose`.
 */
export function useStepper<Forms extends readonly AnyForm[]>(
  forms: Forms,
  _options: StepperOptions
): UseStepperReturnType<Forms> {
  if (forms.length === 0) {
    throw new Error('[attaform] useStepper requires at least one form.')
  }

  const seenKeys = new Set<string>()
  for (const form of forms) {
    if (form.key === '') {
      throw new Error('[attaform] useStepper: every form must have a non-empty key.')
    }
    if (seenKeys.has(form.key)) {
      throw new Error(
        `[attaform] useStepper: duplicate form key "${form.key}". Each step needs a distinct key.`
      )
    }
    seenKeys.add(form.key)
  }

  const stepperRegistry = createStepperRegistry()
  const formKeys = forms.map((form) => form.key)
  const initialKey = formKeys[0] as KeysOf<Forms>
  const current = ref(initialKey) as ReturnType<typeof ref<KeysOf<Forms>>>

  stepperRegistry.claim(initialKey, true)
  for (let i = 1; i < formKeys.length; i += 1) {
    stepperRegistry.claim(formKeys[i]!, false)
  }

  const registry = useRegistry()

  // Late-registration guard. The defer-claim contract relies on
  // `useStepper` winning the race against the microtask-deferred
  // factory settle. If any participating form's factory has already
  // started settling, the claim is too late to honor the privacy
  // guarantee — throw with a clear message instead of silently
  // degrading.
  for (const key of formKeys) {
    const store = registry.forms.get(key)
    if (
      store !== undefined &&
      store.defaultValuesFactory.value !== undefined &&
      store.factorySettleStarted.value
    ) {
      throw new StepperLateRegistrationError(key)
    }
  }

  // Wire each form's `stepperHandle` so `useAbstractForm.settle` can
  // consult the deferral signal before firing an async-defaults
  // factory. Bound by `key` (not by the form return object) so
  // future late-arriving forms that resolve to the same store inherit
  // the claim.
  for (const key of formKeys) {
    const store = registry.forms.get(key)
    if (store !== undefined) {
      store.stepperHandle.value = {
        shouldDefer: () => stepperRegistry.shouldDefer(key),
        registerActivation: (callback) => stepperRegistry.registerActivation(key, callback),
      }
    }
  }

  if (getCurrentScope() !== undefined) {
    const releases: Array<() => void> = []
    for (const key of formKeys) {
      releases.push(registry.trackConsumer(key))
    }
    onScopeDispose(() => {
      for (const release of releases) release()
      for (const key of formKeys) {
        const store = registry.forms.get(key)
        if (store !== undefined) store.stepperHandle.value = undefined
      }
      stepperRegistry.dispose()
    })
  }

  function indexOf(key: string): number {
    return formKeys.indexOf(key)
  }

  function setCurrent(nextKey: KeysOf<Forms>): void {
    const priorKey = current.value as KeysOf<Forms>
    if (priorKey === nextKey) return
    stepperRegistry.markCurrent(nextKey, priorKey)
    current.value = nextKey
  }

  function next(_options?: StepperNavOptions): void {
    const idx = indexOf(current.value as string)
    if (idx === formKeys.length - 1) {
      // eslint-disable-next-line no-console
      console.warn(
        `[attaform] useStepper.next(): already on the last step ("${current.value as string}"). Disable the button at the end of the wizard.`
      )
      return
    }
    setCurrent(formKeys[idx + 1] as KeysOf<Forms>)
  }

  function back(_options?: StepperNavOptions): void {
    const idx = indexOf(current.value as string)
    if (idx === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[attaform] useStepper.back(): already on the first step ("${current.value as string}"). Disable the button at the start of the wizard.`
      )
      return
    }
    setCurrent(formKeys[idx - 1] as KeysOf<Forms>)
  }

  function goTo(key: KeysOf<Forms>, _options?: StepperNavOptions): void {
    if (!seenKeys.has(key as string)) {
      throw new Error(
        `[attaform] useStepper.goTo("${String(key)}"): unknown step key. Known keys: ${formKeys.map((k) => `"${k}"`).join(', ')}.`
      )
    }
    setCurrent(key)
  }

  return {
    current: readonly(current) as Readonly<typeof current>,
    forms,
    count: forms.length,
    next,
    back,
    goTo,
  } as UseStepperReturnType<Forms>
}
