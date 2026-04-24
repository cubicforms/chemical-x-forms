import { computed, type ComputedRef, type Ref } from 'vue'
import type {
  CurrentValueContext,
  CurrentValueWithContext,
  FieldState,
  FormErrorRecord,
  FormFieldErrors,
  OnInvalidSubmitPolicy,
  ReactiveValidationStatus,
  RegisterValue,
  UseAbstractFormReturnType,
  ValidationError,
  ValidationResponseWithoutValue,
} from '../types/types-api'
import type { DeepPartial, GenericForm } from '../types/types-core'
import type { FormState } from './create-form-state'
import { buildFieldArrayApi } from './field-arrays'
import { buildFieldStateAccessor } from './field-state-api'
import type { HistoryModule } from './history'
import { getAtPath } from './path-walker'
import { canonicalizePath, type Path, type Segment } from './paths'
import { buildProcessForm } from './process-form'
import { buildRegister } from './register-api'

export type BuildFormApiOptions = {
  /** Forwarded to buildProcessForm. See `UseFormConfiguration.onInvalidSubmit`. */
  onInvalidSubmit?: OnInvalidSubmitPolicy
  /**
   * Pre-wired history module for undo/redo. When omitted, the public
   * `undo` / `redo` / `canUndo` / `canRedo` / `historySize` fields
   * are inert no-op stubs — consumers get a consistent API shape
   * without opting into the feature.
   */
  history?: HistoryModule
}

/**
 * Build the public form API from a FormState. Extracted from
 * `useAbstractForm` so that both the top-level form entry (which creates
 * a fresh state) and `useFormContext` (which resolves state from an
 * ambient provide/inject) produce identical API shapes without
 * duplicating the wiring.
 *
 * `buildFormApi` does not interact with the registry, consumer ref-counts,
 * or the current Vue instance — those concerns belong to the caller. This
 * function is pure over (FormState, options) → api.
 */
export function buildFormApi<Form extends GenericForm, GetValueFormType extends GenericForm = Form>(
  state: FormState<Form>,
  options: BuildFormApiOptions = {}
): UseAbstractFormReturnType<Form, GetValueFormType> {
  const register = buildRegister(state) as (path: string | Path) => RegisterValue<unknown>
  const getFieldStateBuilt = buildFieldStateAccessor(state)
  // Don't set `onInvalidSubmit: undefined` — exactOptionalPropertyTypes
  // treats an explicit-undefined value differently from an omitted
  // property. Only pass the key when the consumer opted in.
  const processOptions =
    options.onInvalidSubmit !== undefined ? { onInvalidSubmit: options.onInvalidSubmit } : {}
  const {
    validate: validateBuilt,
    validateAsync: validateAsyncBuilt,
    handleSubmit,
    setFieldErrorsFromApi: setFromApiBuilt,
  } = buildProcessForm(state, processOptions)

  const getFieldState = (pathInput: string) =>
    getFieldStateBuilt(pathInput) as unknown as Ref<FieldState>

  const validate = (pathInput?: string) =>
    validateBuilt(pathInput) as Ref<ReactiveValidationStatus<Form>>

  const validateAsync = (pathInput?: string) =>
    validateAsyncBuilt(pathInput) as Promise<ValidationResponseWithoutValue<Form>>

  // Back-compat: setFieldErrorsFromApi previously returned ValidationError[].
  // New implementation returns the structured HydrateApiErrorsResult but we
  // still emit the errors array to match the documented return — consumers
  // wanting the structured result should call the underlying hydrate helper
  // directly.
  const setFieldErrorsFromApi = (
    payload: Parameters<typeof setFromApiBuilt>[0],
    limits?: Parameters<typeof setFromApiBuilt>[1]
  ): ValidationError[] => setFromApiBuilt(payload, limits).errors

  // --- getValue / setValue (overloaded) ---
  function getValueImpl(
    pathOrContext?: string | CurrentValueContext<boolean>,
    maybeContext?: CurrentValueContext<boolean>
  ): unknown {
    if (pathOrContext === undefined) {
      return state.form as unknown as Readonly<Ref<GetValueFormType>>
    }
    if (typeof pathOrContext === 'object') {
      return contextualiseValue(state, [], pathOrContext)
    }
    const segments = canonicalizePath(pathOrContext).segments
    if (maybeContext !== undefined) {
      return contextualiseValue(state, segments, maybeContext)
    }
    return computed(() => getAtPath(state.form.value, segments)) as Readonly<Ref<unknown>>
  }

  function setValueImpl(pathOrValue: unknown, maybeValue?: unknown): boolean {
    if (arguments.length === 1) {
      state.applyFormReplacement(pathOrValue as Form)
      return true
    }
    const segments = canonicalizePath(pathOrValue as string | Path).segments
    state.setValueAtPath(segments, maybeValue)
    return true
  }

  // --- Error store API — dotted-key record for back-compat ---
  const fieldErrors = computed<FormErrorRecord>(() => {
    const record: FormErrorRecord = {}
    for (const [, entries] of state.errors) {
      for (const err of entries) {
        const dottedKey = (err.path as ReadonlyArray<Segment>).map(String).join('.')
        const existingForKey = record[dottedKey]
        if (existingForKey === undefined) record[dottedKey] = [err]
        else existingForKey.push(err)
      }
    }
    return record
  })

  function setFieldErrors(errors: ValidationError[]): void {
    state.setAllErrors(errors)
  }

  function addFieldErrors(errors: ValidationError[]): void {
    state.addErrors(errors)
  }

  function clearFieldErrors(path?: string | (string | number)[]): void {
    if (path === undefined) {
      state.clearErrors()
      return
    }
    const segments = canonicalizePath(path as string | Path).segments
    state.clearErrors(segments)
  }

  // --- Form-level aggregates ---
  // Each entry in `state.originals` stores its canonical `segments`
  // alongside the recorded `value`, so this loop skips `JSON.parse` per
  // iteration. See phase 5.1 notes.
  const isDirty = computed<boolean>(() => {
    for (const [, { segments, value: original }] of state.originals) {
      if (!Object.is(getAtPath(state.form.value, segments), original)) return true
    }
    return false
  })

  const isValid = computed<boolean>(() => state.errors.size === 0)

  // --- Submission lifecycle ---
  const isSubmitting = computed<boolean>(() => state.isSubmitting.value)
  const submitCount = computed<number>(() => state.submitCount.value)
  const submitError = computed<unknown>(() => state.submitError.value)

  // --- Validation lifecycle ---
  const isValidating = computed<boolean>(() => state.activeValidations.value > 0)

  // --- History (undo/redo) ---
  // When the consumer doesn't configure history, fall back to inert
  // stubs so the public API shape stays consistent whether or not
  // the feature is enabled.
  const history = options.history
  const undo = history?.undo ?? (() => false)
  const redo = history?.redo ?? (() => false)
  const canUndo = history?.canUndo ?? computed(() => false)
  const canRedo = history?.canRedo ?? computed(() => false)
  const historySize = history?.historySize ?? computed(() => 0)

  // --- Reset ---
  const reset = (nextInitialState?: DeepPartial<Form>): void => {
    state.reset(nextInitialState)
  }

  const resetField = (pathInput: string): void => {
    const segments = canonicalizePath(pathInput).segments
    state.resetField(segments)
  }

  // --- Focus / scroll to first error ---
  const focusFirstError = (options?: { preventScroll?: boolean }): boolean => {
    const target = state.getFirstErrorElement()
    if (target === null) return false
    target.element.focus(options)
    return true
  }

  const scrollToFirstError = (options?: ScrollIntoViewOptions): boolean => {
    const target = state.getFirstErrorElement()
    if (target === null) return false
    target.element.scrollIntoView(options)
    return true
  }

  // --- Field arrays ---
  const fieldArrays = buildFieldArrayApi(state)

  return {
    getFieldState: getFieldState as UseAbstractFormReturnType<
      Form,
      GetValueFormType
    >['getFieldState'],
    handleSubmit,
    getValue: getValueImpl as UseAbstractFormReturnType<Form, GetValueFormType>['getValue'],
    setValue: setValueImpl as UseAbstractFormReturnType<Form, GetValueFormType>['setValue'],
    validate: validate as UseAbstractFormReturnType<Form, GetValueFormType>['validate'],
    validateAsync: validateAsync as UseAbstractFormReturnType<
      Form,
      GetValueFormType
    >['validateAsync'],
    register: register as UseAbstractFormReturnType<Form, GetValueFormType>['register'],
    key: state.formKey,
    fieldErrors: fieldErrors as unknown as Readonly<ComputedRef<FormFieldErrors<Form>>>,
    setFieldErrors,
    addFieldErrors,
    clearFieldErrors,
    setFieldErrorsFromApi,
    isDirty,
    isValid,
    isSubmitting,
    submitCount,
    submitError,
    isValidating,
    reset: reset as UseAbstractFormReturnType<Form, GetValueFormType>['reset'],
    resetField: resetField as UseAbstractFormReturnType<Form, GetValueFormType>['resetField'],
    focusFirstError,
    scrollToFirstError,
    undo,
    redo,
    canUndo,
    canRedo,
    historySize,
    append: fieldArrays.append as UseAbstractFormReturnType<Form, GetValueFormType>['append'],
    prepend: fieldArrays.prepend as UseAbstractFormReturnType<Form, GetValueFormType>['prepend'],
    insert: fieldArrays.insert as UseAbstractFormReturnType<Form, GetValueFormType>['insert'],
    remove: fieldArrays.remove as UseAbstractFormReturnType<Form, GetValueFormType>['remove'],
    swap: fieldArrays.swap as UseAbstractFormReturnType<Form, GetValueFormType>['swap'],
    move: fieldArrays.move as UseAbstractFormReturnType<Form, GetValueFormType>['move'],
    replace: fieldArrays.replace as UseAbstractFormReturnType<Form, GetValueFormType>['replace'],
  }
}

function contextualiseValue<F extends GenericForm>(
  state: FormState<F>,
  segments: Path,
  context: CurrentValueContext<boolean>
): unknown {
  const currentValue = computed(() => getAtPath(state.form.value, segments))
  if (context.withMeta === true) {
    return {
      currentValue: currentValue as Readonly<Ref<unknown>>,
      meta: computed(() => ({})) as Readonly<Ref<unknown>>,
    } as unknown as CurrentValueWithContext<unknown>
  }
  return currentValue as Readonly<Ref<unknown>>
}
