import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  ref,
  watch,
  type ComputedRef,
} from 'vue'
import { StepperLateRegistrationError } from '../core/errors'
import { useRegistry } from '../core/registry'
import { resolveTrichotomy } from '../core/resolve-default-values'
import { createStepperRegistry } from '../core/stepper-registry'
import { buildStepperStatusesProxy } from '../core/stepper-statuses-proxy'
import type {
  AggregateError,
  AllValues,
  AnyForm,
  FormStatus,
  KeysOf,
  Statuses,
  StepperNavOptions,
  StepperOptions,
  UseStepperReturnType,
} from '../types/types-stepper'

/** Pending sentinel returned by `stepper.statuses[key]` when the form hasn't
 *  yet wired a FormStore (defensive — useStepper guards against this, but
 *  the snapshot fallback keeps templates from crashing). */
const PENDING_STATUS: FormStatus = {
  isValid: false,
  isDirty: false,
  isSubmitted: false,
  errorCount: 0,
}

/** Shape we read off each participating form at runtime. Loosely typed
 *  against `AnyForm` (which only requires `key`) — the runtime objects
 *  returned by `useForm` always satisfy this richer shape. */
type StatusSourceForm = {
  readonly meta: {
    readonly valid: boolean
    readonly dirty: boolean
    readonly isSubmitted: boolean
    readonly errorCount: number
    readonly errors: ReadonlyArray<{
      readonly path: ReadonlyArray<string | number>
      readonly message: string
      readonly code?: string
    }>
  }
  readonly values: unknown
}

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
  options: StepperOptions<Forms>
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

  // Resolve `defaultStatuses` (the trichotomy mirror). Sync values
  // apply immediately at construction; async factories register and
  // populate `seedRef` on resolution. While the async seed is
  // pending, the status falls back to the pending sentinel.
  const seedRef = ref<Statuses<Forms> | undefined>(undefined)
  const seedInput = options.defaultStatuses as
    | Statuses<Forms>
    | (() => Statuses<Forms>)
    | (() => Promise<Statuses<Forms>>)
    | undefined
  if (seedInput !== undefined) {
    const resolved = resolveTrichotomy(seedInput)
    if (resolved.kind === 'sync') {
      seedRef.value = resolved.value
    } else {
      const eager = resolved.factory()
      if (eager instanceof Promise) {
        void eager.then((value) => {
          seedRef.value = value as Statuses<Forms>
        })
      } else {
        seedRef.value = eager as Statuses<Forms>
      }
    }
  }
  // Construction-time validation: any key in the seed that isn't a
  // participating form is a typo and throws.
  if (seedRef.value !== undefined) {
    for (const seedKey of Object.keys(seedRef.value)) {
      if (!seenKeys.has(seedKey)) {
        throw new Error(
          `[attaform] useStepper.defaultStatuses: key "${seedKey}" is not in the forms array. Known keys: ${formKeys.map((k) => `"${k}"`).join(', ')}.`
        )
      }
    }
  }

  // Build per-form FormStatus computeds — each tracks its participating
  // form's `meta` reactively. Resolution priority:
  //   1. store.defaultsResolved === true → derive from form.meta
  //   2. else seed value for this key → frozen seed
  //   3. else → pending sentinel
  // `defaultsResolved` is the right gate (not `isHydrating`) because
  // deferred stepper forms have `isHydrating: false` BEFORE
  // activation — the factory hasn't fired, so meta is the trivial
  // pending shape rather than real data.
  const statusComputeds: Record<string, ComputedRef<FormStatus>> = {}
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i] as AnyForm
    const source = form as unknown as StatusSourceForm
    const key = form.key
    statusComputeds[key] = computed<FormStatus>(() => {
      const store = registry.forms.get(key)
      const resolved = store?.defaultsResolved.value === true
      const meta = source.meta
      if (resolved && meta !== undefined && meta !== null) {
        return {
          isValid: meta.valid,
          isDirty: meta.dirty,
          isSubmitted: meta.isSubmitted,
          errorCount: meta.errorCount,
        }
      }
      const seedMap = seedRef.value as Record<string, FormStatus> | undefined
      if (seedMap !== undefined && Object.hasOwn(seedMap, key)) {
        return seedMap[key] as FormStatus
      }
      return PENDING_STATUS
    })
  }
  const statuses = buildStepperStatusesProxy<Statuses<Forms>>(
    statusComputeds as Record<keyof Statuses<Forms>, ComputedRef<FormStatus>>
  )

  // `onStatusChange` handler captured once for both the per-form
  // material-change watch AND the synthetic nav-away invocation in
  // `setCurrent` below.
  const statusChangeHandler = options.onStatusChange

  // Wire per-form material-change watches. Fires only when the
  // 4-scalar tuple (\`isValid\`, \`isDirty\`, \`isSubmitted\`,
  // \`errorCount\`) actually moves; identical writes don't re-fire.
  // Async returns are fire-and-forget — navigation is never gated on
  // the handler's promise. A separate \`onBeforeLeave\` (future) would
  // cover nav-blocking guards.
  if (statusChangeHandler !== undefined) {
    for (let i = 0; i < forms.length; i += 1) {
      const form = forms[i] as AnyForm
      const key = form.key
      const statusComputed = statusComputeds[key]
      if (statusComputed === undefined) continue
      watch(statusComputed, (next, prev) => {
        if (
          prev !== undefined &&
          prev.isValid === next.isValid &&
          prev.isDirty === next.isDirty &&
          prev.isSubmitted === next.isSubmitted &&
          prev.errorCount === next.errorCount
        ) {
          return
        }
        void statusChangeHandler(next, form as unknown as Forms[number])
      })
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

  // Cross-form aggregates. `allValues` exposes each form's existing
  // values proxy under its key — read-only by way of the proxies'
  // own traps. `allErrors` is a computed flat list ordered by forms
  // array, then per-form order.
  const allValuesObject: Record<string, unknown> = {}
  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i] as AnyForm
    const source = form as unknown as StatusSourceForm
    Object.defineProperty(allValuesObject, form.key, {
      enumerable: true,
      configurable: false,
      get: () => source.values,
    })
  }
  const allValues = allValuesObject as AllValues<Forms>

  const allErrors = computed<readonly AggregateError[]>(() => {
    const flat: AggregateError[] = []
    for (let i = 0; i < forms.length; i += 1) {
      const form = forms[i] as AnyForm
      const source = form as unknown as StatusSourceForm
      const errors = source.meta?.errors
      if (errors === undefined) continue
      for (const error of errors) {
        const entry: { -readonly [P in keyof AggregateError]: AggregateError[P] } = {
          formKey: form.key,
          path: error.path,
          message: error.message,
        }
        if (error.code !== undefined) entry.code = error.code
        flat.push(entry)
      }
    }
    return flat
  })

  function setCurrent(nextKey: KeysOf<Forms>): void {
    const priorKey = current.value as KeysOf<Forms>
    if (priorKey === nextKey) return
    stepperRegistry.markCurrent(nextKey, priorKey)
    current.value = nextKey
    // Synthetic nav-away invocation. `onStatusChange` fires for the
    // form being left, regardless of whether anything materially
    // changed — useful for autosave-on-step-leave patterns.
    if (statusChangeHandler !== undefined) {
      const priorIdx = formKeys.indexOf(priorKey as string)
      if (priorIdx !== -1) {
        const priorForm = forms[priorIdx] as AnyForm
        const priorStatus = statusComputeds[priorKey as string]?.value
        if (priorStatus !== undefined) {
          void statusChangeHandler(priorStatus, priorForm as unknown as Forms[number])
        }
      }
    }
  }

  function next(_options?: StepperNavOptions): void {
    const idx = indexOf(current.value as string)
    if (idx === formKeys.length - 1) {
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
    statuses,
    allValues,
    allErrors: readonly(allErrors),
    next,
    back,
    goTo,
  } as UseStepperReturnType<Forms>
}
