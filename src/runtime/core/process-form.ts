import { computed, type Ref } from 'vue'
import type {
  ApiErrorDetails,
  ApiErrorEnvelope,
  HandleSubmit,
  OnError,
  OnInvalidSubmitPolicy,
  OnSubmit,
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
  function validate(pathInput?: string | Path): Ref<ValidationResponseWithoutValue<F>> {
    // Validation is computed lazily from form.value — the reactive Ref
    // updates whenever form mutates, so templates bound to this ref
    // reflect live validity without extra wiring.
    return computed(() => {
      const response = runValidation(pathInput)
      if (response.success) {
        return {
          errors: undefined,
          success: true,
          formKey: response.formKey,
        }
      }
      return {
        errors: response.errors,
        success: false,
        formKey: response.formKey,
      }
    }) as unknown as Ref<ValidationResponseWithoutValue<F>>
  }

  function runValidation(pathInput?: string | Path): ValidationResponse<F> {
    const dataAtPath =
      pathInput === undefined ? state.form.value : state.getValueAtPath(toSegments(pathInput))
    // AbstractSchema.validateAtPath expects a dotted-string path; the zod
    // adapter (Phase 1c / Phase 4) will be migrated to structured paths.
    // For now bridge both worlds.
    const stringPath = pathInput === undefined ? undefined : toDottedString(pathInput)
    return state.schema.validateAtPath(dataAtPath, stringPath) as ValidationResponse<F>
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
      try {
        const result = runValidation()
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

  return { validate, handleSubmit, setFieldErrorsFromApi }
}

function toSegments(pathInput: string | Path): Path {
  return canonicalizePath(pathInput).segments
}

function toDottedString(pathInput: string | Path): string {
  if (typeof pathInput === 'string') return pathInput
  return pathInput.map(String).join('.')
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
