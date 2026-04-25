import { computed, reactive, readonly, type ComputedRef, type Ref } from 'vue'
import type {
  CurrentValueContext,
  CurrentValueWithContext,
  FieldState,
  FormErrorRecord,
  FormFieldErrors,
  FormState,
  OnInvalidSubmitPolicy,
  ReactiveValidationStatus,
  RegisterValue,
  UseAbstractFormReturnType,
  ValidationError,
  ValidationResponseWithoutValue,
} from '../types/types-api'
import type { DeepPartial, GenericForm } from '../types/types-core'
import { __DEV__ } from './dev'
import type { FormStore } from './create-form-store'
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
 * Build the public form API from a FormStore. Extracted from
 * `useAbstractForm` so that both the top-level form entry (which creates
 * a fresh state) and `useFormContext` (which resolves state from an
 * ambient provide/inject) produce identical API shapes without
 * duplicating the wiring.
 *
 * `buildFormApi` does not interact with the registry, consumer ref-counts,
 * or the current Vue instance — those concerns belong to the caller. This
 * function is pure over (FormStore, options) → api.
 */
export function buildFormApi<Form extends GenericForm, GetValueFormType extends GenericForm = Form>(
  state: FormStore<Form>,
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
  // `state.errors` is keyed by canonical `PathKey` (JSON-stringified
  // Segment[]), so every entry here already represents a distinct
  // structured path. The dotted-key derivation is best-effort: paths
  // with a literal `.` inside a single segment (`['user.name']`)
  // produce the same record key as the sibling pair (`['user',
  // 'name']`). This collision only surfaces in pathological schemas
  // that declare both shapes on the same form — in that case the
  // errors merge under the shared dotted key. Consumers who need
  // collision-free access read from `state.errors` via the validate()
  // / getFieldState() paths instead of the legacy dotted record.
  //
  // The internal computed stays — laziness + dependency tracking are
  // useful. The public surface wraps it in a Proxy (see fieldErrorsView
  // below) so templates can dot-access directly without `.value`, and
  // the readonly contract is enforced at runtime via set/delete traps.
  const fieldErrorsComputed = computed<FormErrorRecord>(() => {
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

  const fieldErrors = createReadonlyErrorView(fieldErrorsComputed)

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

  // --- Form-level state bundle ---
  // Vue auto-unwraps refs that are top-level on a setup return, but not
  // refs nested in a return *object* — those render as their wrapper
  // (always truthy) and silently break bindings like `:disabled`. We
  // work around it by placing the 9 scalars inside `reactive()`, which
  // unwraps ref values on property access at any depth; `readonly()`
  // layers a runtime write-guard on top.
  //
  // Named `formState` locally to avoid shadowing the `state: FormStore<F>`
  // param this function receives; exposed as `state` on the public return.
  const formState = readonly(
    reactive({
      isDirty,
      isValid,
      isSubmitting,
      isValidating,
      submitCount,
      submitError,
      canUndo,
      canRedo,
      historySize,
    })
  ) as FormState

  // --- Reset ---
  const reset = (nextDefaultValues?: DeepPartial<Form>): void => {
    state.reset(nextDefaultValues)
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
    fieldErrors: fieldErrors as unknown as Readonly<FormFieldErrors<Form>>,
    setFieldErrors,
    addFieldErrors,
    clearFieldErrors,
    setFieldErrorsFromApi,
    state: formState,
    reset: reset as UseAbstractFormReturnType<Form, GetValueFormType>['reset'],
    resetField: resetField as UseAbstractFormReturnType<Form, GetValueFormType>['resetField'],
    focusFirstError,
    scrollToFirstError,
    undo,
    redo,
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
  state: FormStore<F>,
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

/**
 * Wrap a `ComputedRef<FormErrorRecord>` in a Proxy that exposes the
 * underlying record's keys directly on the public object.
 *
 * Why a Proxy and not the bare ComputedRef:
 *   - Vue templates auto-unwrap refs only when they are top-level keys
 *     of the setup return. `useForm()` returns an API object, so any
 *     ref nested inside (`fieldErrors`, etc.) does NOT auto-unwrap.
 *     Authors hit this as `anon.fieldErrors.value.email` in templates,
 *     which is a footgun. The Proxy lets them write
 *     `anon.fieldErrors.email` directly.
 *   - Readonly is preserved: `set` / `deleteProperty` / `defineProperty`
 *     traps reject writes. Consumers must go through `setFieldErrors`,
 *     `addFieldErrors`, or `clearFieldErrors`. (Type-level `Readonly<>`
 *     enforces this at compile time too.)
 *   - Reactivity is preserved: every trap that delegates to
 *     `source.value` reads the ComputedRef inside the consumer's render
 *     scope, so Vue tracks the dependency exactly as it would for a
 *     direct `.value` read. Templates re-render on error changes.
 *   - Laziness is preserved: the underlying ComputedRef only recomputes
 *     when its inputs (state.errors) change AND a trap that reads
 *     `source.value` fires.
 */
function createReadonlyErrorView<T extends FormErrorRecord>(source: ComputedRef<T>): T {
  const target: T = Object.create(null) as T
  return new Proxy(target, {
    get(_, key) {
      return (source.value as Record<string | symbol, unknown>)[key as string]
    },
    has(_, key) {
      return key in source.value
    },
    ownKeys() {
      return Reflect.ownKeys(source.value as object)
    },
    getOwnPropertyDescriptor(_, key) {
      const desc = Reflect.getOwnPropertyDescriptor(source.value as object, key)
      // Proxy invariant: when the underlying target ({}) lacks the key,
      // the descriptor we report MUST have configurable: true. The
      // delegated descriptor inherits configurable: true from the plain
      // object record, but we set it explicitly to be defensive.
      if (desc !== undefined) desc.configurable = true
      return desc
    },
    set() {
      if (__DEV__) {
        console.warn(
          '[@chemical-x/forms] fieldErrors is read-only — write via setFieldErrors / addFieldErrors / clearFieldErrors.'
        )
      }
      return false
    },
    deleteProperty() {
      if (__DEV__) {
        console.warn('[@chemical-x/forms] fieldErrors is read-only — clear via clearFieldErrors.')
      }
      return false
    },
    defineProperty() {
      return false
    },
    setPrototypeOf() {
      return false
    },
  })
}
