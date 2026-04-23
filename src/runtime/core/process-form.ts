import { getCurrentScope, onScopeDispose, ref, watchEffect, type Ref } from 'vue'
import type {
  ApiErrorDetails,
  ApiErrorEnvelope,
  HandleSubmit,
  OnError,
  OnInvalidSubmitPolicy,
  OnSubmit,
  ReactiveValidationStatus,
  SubmitHandler,
  ValidationResponse,
  ValidationResponseWithoutValue,
} from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormState } from './create-form-state'
import { SubmitErrorHandlerError } from './errors'
import {
  hydrateApiErrors,
  type HydrateApiErrorsOptions,
  type HydrateApiErrorsResult,
} from './hydrate-api-errors'
import { canonicalizePath, type Path } from './paths'

/**
 * validate + handleSubmit + setFieldErrorsFromApi, all built against a
 * FormState<F>. Replaces use-form-store's validation factory + the submit
 * wrapper in use-abstract-form.ts.
 *
 * Phase 5.6: validation is async end-to-end. `AbstractSchema.validateAtPath`
 * returns `Promise<ValidationResponse<F>>`, so every caller here awaits.
 * The reactive `validate()` ref carries a `pending` flag to distinguish
 * "in-flight" from "settled"; stale results are dropped via a per-call
 * generation counter.
 */

export type BuildProcessFormOptions = {
  /**
   * Policy applied inside handleSubmit when validation fails. Invoked
   * after the error store is populated and before the user's `onError`
   * callback. Default `'none'`.
   */
  onInvalidSubmit?: OnInvalidSubmitPolicy
}

export function buildProcessForm<F extends GenericForm>(
  state: FormState<F>,
  options: BuildProcessFormOptions = {}
) {
  const invalidPolicy: OnInvalidSubmitPolicy = options.onInvalidSubmit ?? 'none'

  function validate(pathInput?: string | Path): Readonly<Ref<ReactiveValidationStatus<F>>> {
    // Start in a pending state — the first async run has not settled yet.
    // When validation fires, this ref writes `{ pending: false, ... }`
    // with the resolved status; stale writes (older generation) are
    // dropped so a slow earlier run can't overwrite a newer result.
    const result = ref<ReactiveValidationStatus<F>>({
      pending: true,
      errors: undefined,
      success: false,
      formKey: state.formKey,
    }) as Ref<ReactiveValidationStatus<F>>

    let gen = 0

    async function kickoff(
      data: unknown,
      stringPath: string | undefined,
      captured: number
    ): Promise<void> {
      // Runs on a microtask outside the watchEffect's sync frame. Reads
      // and writes to reactive state inside this function DO NOT track
      // against the effect — the activeEffect stack is empty here —
      // so writing to `activeValidations` / `result` can't re-trigger
      // the watchEffect below.
      state.activeValidations.value += 1
      result.value = {
        pending: true,
        errors: undefined,
        success: false,
        formKey: state.formKey,
      }
      try {
        const response = await runValidation(data, stringPath)
        if (captured !== gen) return
        result.value = settled(response)
      } catch (err) {
        if (captured !== gen) return
        // Adapters are contractually "return errors, don't throw"; if
        // one does throw we don't want the validate() ref to hang in
        // `pending: true` forever. Wrap the throw as a single
        // adapter-level error so the form surfaces something.
        result.value = {
          pending: false,
          errors: [{ message: adapterThrowMessage(err), path: [], formKey: state.formKey }],
          success: false,
          formKey: state.formKey,
        }
      } finally {
        state.activeValidations.value = Math.max(0, state.activeValidations.value - 1)
      }
    }

    const stop = watchEffect(() => {
      // Read form.value (or the subtree at path) so the effect re-runs
      // on any mutation. We must NOT touch any other reactive state
      // here — the writes in `kickoff` would otherwise re-trigger the
      // effect in a hot loop. Deferring via `queueMicrotask` puts the
      // writes on a clean task where `activeEffect` is null.
      const dataAtPath =
        pathInput === undefined ? state.form.value : state.getValueAtPath(toSegments(pathInput))
      const stringPath = pathInput === undefined ? undefined : toDottedString(pathInput)
      const localGen = ++gen
      queueMicrotask(() => {
        void kickoff(dataAtPath, stringPath, localGen)
      })
    })
    // Tie the watcher's lifetime to the caller's effect scope so
    // components that call validate() in setup release the watcher on
    // unmount. Tests calling validate() in a raw context simply leak
    // the watcher for the test's duration — acceptable given tests
    // tear down the module context per run.
    if (getCurrentScope() !== undefined) onScopeDispose(stop)
    return result as Readonly<Ref<ReactiveValidationStatus<F>>>
  }

  /**
   * Imperative one-shot validation. Doesn't subscribe to form reactivity;
   * each call runs validation once against the current form snapshot.
   * Used by consumers who want to `await` a single validation run — the
   * debounced field-level path in 5.7, server-side round-trips, tests.
   */
  async function validateAsync(
    pathInput?: string | Path
  ): Promise<ValidationResponseWithoutValue<F>> {
    const dataAtPath =
      pathInput === undefined ? state.form.value : state.getValueAtPath(toSegments(pathInput))
    const stringPath = pathInput === undefined ? undefined : toDottedString(pathInput)
    state.activeValidations.value += 1
    try {
      const response = await runValidation(dataAtPath, stringPath)
      return stripData(response)
    } finally {
      state.activeValidations.value = Math.max(0, state.activeValidations.value - 1)
    }
  }

  async function runValidation(
    data: unknown,
    stringPath: string | undefined
  ): Promise<ValidationResponse<F>> {
    // AbstractSchema.validateAtPath expects a dotted-string path; the zod
    // adapter (Phase 1c / Phase 4) will be migrated to structured paths.
    // For now bridge both worlds.
    return (await state.schema.validateAtPath(data, stringPath)) as ValidationResponse<F>
  }

  /**
   * handleSubmit(onSubmit, onError?) builds a submit handler. On success:
   * clear errors, call onSubmit. On failure: populate errors via
   * setAllErrors, then call onError if provided.
   *
   * If the user's onError throws/rejects, the thrown value is re-thrown
   * wrapped in SubmitErrorHandlerError — prior versions swallowed this
   * into a console.error, which masked real bugs.
   *
   * Drives the submission-lifecycle refs on FormState:
   *   - `isSubmitting` flips true at entry, false in `finally`.
   *   - `submitCount` increments once per call, regardless of outcome —
   *     "how many times did the user click submit" is the consumer-facing
   *     question, independent of whether anything awaited.
   *   - `submitError` clears at entry and captures anything thrown from
   *     the user callback (or the wrapped error-handler error). Re-throws
   *     after capturing so imperative callers (`await handler(event)`)
   *     still see the rejection; template `@submit="..."` callers read
   *     `submitError` instead.
   *
   * Phase 5.6: the pre-dispatch validation is now async, so the handler
   * awaits `runValidation` before branching on success/failure. The
   * `isValidating` ref (backed by `state.activeValidations`) is true
   * for the validation window.
   */
  const handleSubmit: HandleSubmit<F> = (onSubmit: OnSubmit<F>, onError?: OnError) => {
    const submitHandler: SubmitHandler = async (event?: Event): Promise<void> => {
      if (
        event !== undefined &&
        'preventDefault' in event &&
        typeof event.preventDefault === 'function'
      ) {
        event.preventDefault()
      }
      // Use the in-flight counter on FormState so two overlapping submit
      // handlers don't clobber each other: the first completion only
      // flips isSubmitting to false when the counter reaches zero, not
      // unconditionally. submitError is shared across runs by design — a
      // later run's success / failure replaces the earlier capture,
      // UNLESS a `reset()` fired between entry and throw (see below).
      const genAtEntry = state.submissionGeneration.value
      state.activeSubmissions.value += 1
      state.isSubmitting.value = true
      state.submitError.value = null
      // Abort any in-flight per-field validation runs so their late
      // writes can't clobber the authoritative submit result. Also
      // clears debounce timers that never fired.
      state.cancelFieldValidation()
      state.activeValidations.value += 1
      let validationSettled = false
      try {
        const result = await runValidation(state.form.value, undefined)
        state.activeValidations.value = Math.max(0, state.activeValidations.value - 1)
        validationSettled = true
        if (!result.success) {
          const errors = result.errors
          state.setAllErrors(errors)
          // Apply the invalid-submit focus/scroll policy AFTER populating
          // the error store (so getFirstErrorElement walks the fresh
          // entries) and BEFORE the user's onError callback (so consumer
          // logic can override by calling .focus on something else).
          applyInvalidSubmitPolicy(state, invalidPolicy)
          if (onError !== undefined) {
            try {
              await onError(errors)
            } catch (cause) {
              throw new SubmitErrorHandlerError('User-provided onError threw', { cause })
            }
          }
          return
        }
        state.clearErrors()
        await onSubmit(result.data)
      } catch (err) {
        // Only publish the error if `reset()` hasn't fired since this
        // submission began. Otherwise the consumer just zeroed the
        // submission surface and we'd undo their intent by re-raising
        // into `submitError`. We still re-throw so imperative callers
        // (`await handler(event)`) observe the rejection.
        if (state.submissionGeneration.value === genAtEntry) {
          state.submitError.value = err
        }
        throw err
      } finally {
        // If validation threw before we decremented, drop the counter now
        // so `isValidating` doesn't hang true after a failed submit.
        if (!validationSettled) {
          state.activeValidations.value = Math.max(0, state.activeValidations.value - 1)
        }
        state.activeSubmissions.value = Math.max(0, state.activeSubmissions.value - 1)
        // `activeSubmissions` always decrements (the submission is done),
        // but the *visible* lifecycle counters — `isSubmitting` and
        // `submitCount` — only update when the submission's generation
        // still matches. A post-reset completion is a no-op from the
        // consumer's point of view: reset already flipped `isSubmitting`
        // to false and zeroed `submitCount`, and the finished submission
        // belongs to the prior generation.
        if (state.submissionGeneration.value === genAtEntry) {
          state.isSubmitting.value = state.activeSubmissions.value > 0
          state.submitCount.value += 1
        }
      }
    }
    return submitHandler
  }

  /**
   * setFieldErrorsFromApi accepts an API-shaped payload, hydrates it, and
   * populates the form's error map. Returns the structured hydrate result
   * so the caller can detect malformed payloads.
   *
   * The optional `limits` object caps entries and path depth — see
   * `HydrateApiErrorsOptions`. Passing untrusted / gateway-passthrough
   * payloads without narrower caps is a DoS surface; defaults (1 000
   * entries, depth 32) are conservative but consumers who know their
   * server should tune them.
   */
  function setFieldErrorsFromApi(
    payload: ApiErrorEnvelope | ApiErrorDetails | null | undefined,
    limits?: Omit<HydrateApiErrorsOptions, 'formKey'>
  ): HydrateApiErrorsResult {
    const result = hydrateApiErrors(payload, {
      formKey: state.formKey,
      ...(limits ?? {}),
    })
    if (result.ok) {
      state.setAllErrors(result.errors)
    }
    return result
  }

  return { validate, validateAsync, handleSubmit, setFieldErrorsFromApi }
}

function toSegments(pathInput: string | Path): Path {
  return canonicalizePath(pathInput).segments
}

function toDottedString(pathInput: string | Path): string {
  if (typeof pathInput === 'string') return pathInput
  return pathInput.map(String).join('.')
}

function settled<F extends GenericForm>(
  response: ValidationResponse<F>
): ReactiveValidationStatus<F> {
  if (response.success) {
    return { pending: false, errors: undefined, success: true, formKey: response.formKey }
  }
  return { pending: false, errors: response.errors, success: false, formKey: response.formKey }
}

function stripData<F extends GenericForm>(
  response: ValidationResponse<F>
): ValidationResponseWithoutValue<F> {
  if (response.success) {
    return { errors: undefined, success: true, formKey: response.formKey }
  }
  return { errors: response.errors, success: false, formKey: response.formKey }
}

function adapterThrowMessage(err: unknown): string {
  if (err instanceof Error) return `Adapter validateAtPath threw: ${err.message}`
  return 'Adapter validateAtPath threw a non-Error value'
}

function applyInvalidSubmitPolicy<F extends GenericForm>(
  state: FormState<F>,
  policy: OnInvalidSubmitPolicy
): void {
  if (policy === 'none') return
  const target = state.getFirstErrorElement()
  if (target === null) return
  if (policy === 'scroll-to-first-error') {
    target.element.scrollIntoView()
    return
  }
  if (policy === 'focus-first-error') {
    target.element.focus()
    return
  }
  // 'both' — scroll first, then focus with preventScroll so the
  // browser doesn't undo the explicit scroll.
  target.element.scrollIntoView()
  target.element.focus({ preventScroll: true })
}
