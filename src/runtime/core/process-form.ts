import { getCurrentScope, onScopeDispose, ref, watchEffect, type Ref } from 'vue'
import type {
  HandleSubmit,
  OnError,
  OnInvalidSubmitPolicy,
  OnSubmit,
  ReactiveValidationStatus,
  SubmitHandler,
  ValidationError,
  ValidationResponse,
  ValidationResponseWithoutValue,
} from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { __DEV__ } from './dev'
import { CxErrorCode } from './error-codes'
import { SubmitErrorHandlerError } from './errors'
import { canonicalizePath, type Path, type Segment } from './paths'

/**
 * Tracks FormStores for which we've already emitted the
 * "validate() called outside an effect scope" warning. One warn per
 * store keeps the diagnostic loud the first time and silent for the
 * rest of the run — important for hot-loop callers that would
 * otherwise spam the console (a tight test loop calling validate()
 * 1000 times shouldn't produce 1000 warnings).
 */
const warnedNoScopeStores: WeakSet<FormStore<GenericForm>> | null = __DEV__
  ? new WeakSet<FormStore<GenericForm>>()
  : null

/**
 * validate + handleSubmit, both built against a FormStore<F>. Replaces
 * use-form-store's validation factory + the submit wrapper in
 * use-abstract-form.ts.
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
  state: FormStore<F>,
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

    async function kickoff(data: unknown, path: Path | undefined, captured: number): Promise<void> {
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
        const response = await runValidation(data, path)
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
          errors: [
            {
              message: adapterThrowMessage(err),
              path: [],
              formKey: state.formKey,
              code: CxErrorCode.AdapterThrew,
            },
          ],
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
      const segments = pathInput === undefined ? undefined : toSegments(pathInput)
      const dataAtPath = segments === undefined ? state.form.value : state.getValueAtPath(segments)
      const localGen = ++gen
      queueMicrotask(() => {
        void kickoff(dataAtPath, segments, localGen)
      })
    })
    // Tie the watcher's lifetime to the caller's effect scope so
    // components that call validate() in setup release the watcher on
    // unmount. Tests calling validate() in a raw context simply leak
    // the watcher for the test's duration — acceptable given tests
    // tear down the module context per run.
    if (getCurrentScope() !== undefined) {
      onScopeDispose(stop)
    } else if (
      __DEV__ &&
      warnedNoScopeStores !== null &&
      !warnedNoScopeStores.has(state as FormStore<GenericForm>)
    ) {
      warnedNoScopeStores.add(state as FormStore<GenericForm>)
      console.warn(
        '[@chemical-x/forms] validate() called outside a Vue effect scope. ' +
          'The reactive watcher will not be released until the JS engine garbage-collects the form ' +
          '— move the call into setup() / a child component, or wrap in `effectScope().run(...)`. ' +
          'Tests can suppress this warning by mocking console.warn for the run.'
      )
    }
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
    const segments = pathInput === undefined ? undefined : toSegments(pathInput)
    const dataAtPath = segments === undefined ? state.form.value : state.getValueAtPath(segments)
    state.activeValidations.value += 1
    try {
      const response = await runValidation(dataAtPath, segments)
      return stripData(response)
    } finally {
      state.activeValidations.value = Math.max(0, state.activeValidations.value - 1)
    }
  }

  async function runValidation(
    data: unknown,
    path: Path | undefined
  ): Promise<ValidationResponse<F>> {
    // AbstractSchema.validateAtPath takes a canonical structured path
    // — Segment[] — so literal-dot field keys can't collide with the
    // sibling-pair form at the adapter boundary.
    const baseResult = (await state.schema.validateAtPath(data, path)) as ValidationResponse<F>
    // Required-empty augmentation. The schema can't tell the difference
    // between "user typed 0" and "user didn't answer" because storage
    // holds the slim default (`0` for `z.number()`) in both cases. We
    // close the gap by consulting the form's `transientEmptyPaths` set:
    // every path in there + a required leaf in the schema becomes a
    // synthesised "No value supplied" error. Empty set or no required leaves →
    // no-op, return the base result unchanged.
    const requiredErrors = collectRequiredEmptyErrors(state, path)
    if (requiredErrors.length === 0) return baseResult
    if (baseResult.success) {
      return {
        data: undefined,
        errors: requiredErrors,
        success: false,
        formKey: state.formKey,
      }
    }
    return {
      ...baseResult,
      errors: [...baseResult.errors, ...requiredErrors],
    }
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
   * Drives the submission-lifecycle refs on FormStore:
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
      // Use the in-flight counter on FormStore so two overlapping submit
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
        // Generation guard: if `reset()` fired while we were awaiting
        // validation, the consumer just zeroed the submission surface
        // — the validation result is for state that's been replaced.
        // Skip the schema-error write so reset's empty store stays
        // empty; still run the user's onError so they get the result
        // (it's their data, not ours, to discard).
        const generationStillValid = state.submissionGeneration.value === genAtEntry
        if (!result.success) {
          const errors = result.errors
          // Schema-only writer: user-injected errors (from
          // setFieldErrors / addFieldErrors / parseApiErrors-fed
          // entries) live in a separate store and are NOT clobbered by
          // the submit-time validation result.
          if (generationStillValid) {
            state.setAllSchemaErrors(errors)
          }
          // Apply the invalid-submit focus/scroll policy AFTER populating
          // the error store (so getFirstErrorElement walks the fresh
          // entries) and BEFORE the user's onError callback (so consumer
          // logic can override by calling .focus on something else).
          // Skip the policy too on a stale generation — the post-reset
          // form has no errors to focus.
          if (generationStillValid) {
            applyInvalidSubmitPolicy(state, invalidPolicy)
          }
          if (onError !== undefined) {
            try {
              await onError(errors)
            } catch (cause) {
              throw new SubmitErrorHandlerError('User-provided onError threw', { cause })
            }
          }
          return
        }
        // Schema-only clear: a successful submit means schema validation
        // passed, so the schema-error store goes empty. User-injected
        // errors persist — consumers managing their own warning/info
        // state via setFieldErrors keep ownership of that lifecycle.
        // Skip the clear when reset already cleared (and bumped gen) —
        // any errors injected by post-reset user mutations would be
        // wrongly wiped otherwise.
        if (generationStillValid) {
          state.clearSchemaErrors()
        }
        await onSubmit(result.data)
        // Notify subscribers (persistence's clear-on-success handler,
        // future hooks). Fires only when the user callback resolved —
        // validation-failure and callback-throw skip it.
        state.emitSubmitSuccess()
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

  return { validate, validateAsync, handleSubmit }
}

function toSegments(pathInput: string | Path): Path {
  return canonicalizePath(pathInput).segments
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

/**
 * Synthesise a "No value supplied" `ValidationError` for every path in the
 * form's `transientEmptyPaths` whose schema requires the leaf — i.e.
 * the schema is NOT `.optional()` / `.nullable()` / `.default(N)` /
 * `.catch(N)` at that leaf. When a `scope` is provided (per-path
 * `validate(path)` / `validateAsync(path)`), only paths inside the
 * scope contribute; full-form validation passes `undefined` and
 * checks every entry.
 *
 * Returns an empty array when nothing applies, so callers can
 * fast-path without inspecting the result.
 */
function collectRequiredEmptyErrors<F extends GenericForm>(
  state: FormStore<F>,
  scope: Path | undefined
): ValidationError[] {
  if (state.transientEmptyPaths.size === 0) return []
  const errors: ValidationError[] = []
  for (const pathKey of state.transientEmptyPaths) {
    // PathKey is `JSON.stringify(segments)` per `canonicalizePath`, so
    // recovering the structured segments is `JSON.parse(...)`. Don't
    // round-trip through `canonicalizePath(pathKey)` — that would treat
    // the JSON-encoded string as a NEW dotted path and produce a single
    // segment containing the literal JSON.
    const segments = JSON.parse(pathKey) as Segment[]
    if (scope !== undefined && !pathStartsWith(segments, scope)) continue
    if (!state.schema.isRequiredAtPath(segments)) continue
    errors.push({
      // The path is in `transientEmptyPaths` — the user hasn't
      // committed a value yet (or explicitly cleared via `unset` /
      // a numeric DOM clear). The schema requires a value here.
      // Message wording differentiates from a generic schema failure
      // ("Expected number, received string") so consumers showing
      // raw errors don't surface a vague "No value supplied" — devs see at
      // a glance that the user just hasn't supplied this field.
      message: 'No value supplied',
      path: [...segments],
      formKey: state.formKey,
      code: CxErrorCode.NoValueSupplied,
    })
  }
  return errors
}

/**
 * `true` if `target`'s segments start with `prefix`. Used by
 * `collectRequiredEmptyErrors` to honour the per-path scope of
 * `validate(path)` — only transient-empty paths inside the validated
 * subtree raise required errors. An empty prefix matches every path.
 */
function pathStartsWith(target: Path, prefix: Path): boolean {
  if (prefix.length > target.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (!Object.is(target[i], prefix[i])) return false
  }
  return true
}

function applyInvalidSubmitPolicy<F extends GenericForm>(
  state: FormStore<F>,
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
