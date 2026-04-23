import { computed, getCurrentScope, onScopeDispose, type ComputedRef, type Ref } from 'vue'
import { createFormState, type FormState } from '../core/create-form-state'
import { buildFieldArrayApi } from '../core/field-arrays'
import { buildFieldStateAccessor, type FieldStateView } from '../core/field-state-api'
import { getComputedSchema } from '../core/get-computed-schema'
import { canonicalizePath, type Path, type Segment } from '../core/paths'
import { getAtPath } from '../core/path-walker'
import { buildProcessForm } from '../core/process-form'
import { buildRegister } from '../core/register-api'
import { useRegistry } from '../core/registry'
import type {
  AbstractSchema,
  CurrentValueContext,
  CurrentValueWithContext,
  FieldState,
  FormErrorRecord,
  FormKey,
  RegisterValue,
  UseAbstractFormReturnType,
  UseFormConfiguration,
  ValidationError,
  ValidationResponseWithoutValue,
} from '../types/types-api'
import type { DeepPartial, GenericForm } from '../types/types-core'

/**
 * useForm's abstract entry point. The Zod-typed `useForm` sitting at
 * ../composables/use-form.ts delegates here after wrapping its Zod schema
 * with `zodAdapter` — the result is an `AbstractSchema<Form, GetValueFormType>`
 * instance indistinguishable from a hand-rolled adapter.
 *
 * Wiring:
 * - Fetches the current Vue app's ChemicalXRegistry via useRegistry().
 * - Looks up (or creates) the FormState<F> for the configured key. If the
 *   registry has a pending hydration entry for the key, threads it into
 *   createFormState so the client side starts from the server's snapshot.
 * - Builds register / getFieldState / validate / handleSubmit /
 *   setFieldErrorsFromApi from that FormState via the Phase 1b factories.
 *
 * The old pre-rewrite implementation stitched together five separate Nuxt
 * useState composables and a cache in register.ts. This file collapses all
 * of that into one registry-backed closure.
 */

export function useAbstractForm<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<Form>
  >
): UseAbstractFormReturnType<Form, GetValueFormType> {
  const key = requireFormKey(configuration.key)

  // Resolve the schema (accepts either an AbstractSchema or a factory).
  const resolvedSchema = getComputedSchema(key, configuration.schema) as unknown as AbstractSchema<
    Form,
    Form
  >

  // One FormState per (app, formKey). Multiple useForm calls with the same
  // key resolve to the same instance — matches the pre-rewrite "shared
  // store" semantic that forms with the same key were intended to share.
  const registry = useRegistry()
  const existing = registry.forms.get(key) as FormState<Form> | undefined
  const state: FormState<Form> =
    existing ?? buildFreshState<Form>(key, resolvedSchema, configuration, registry)

  // Ref-count this consumer. When the component's effect scope tears down,
  // release the count; the registry evicts the FormState once the last
  // consumer disposes. Guarded on `getCurrentScope()` so callers without an
  // effect-scope context (defensive — setup() always provides one) don't
  // leak a pinned consumer. See registry.trackConsumer for the counter.
  if (getCurrentScope() !== undefined) {
    const releaseConsumer = registry.trackConsumer(key)
    onScopeDispose(releaseConsumer)
  }

  // --- API surface ---
  const register = buildRegister(state) as (path: string | Path) => RegisterValue<unknown>
  const getFieldStateBuilt = buildFieldStateAccessor(state)
  const {
    validate: validateBuilt,
    handleSubmit,
    setFieldErrorsFromApi: setFromApiBuilt,
  } = buildProcessForm(state)

  const getFieldState = (pathInput: string) =>
    getFieldStateBuilt(pathInput) as unknown as Ref<FieldState>

  const validate = (pathInput?: string) =>
    validateBuilt(pathInput) as Ref<ValidationResponseWithoutValue<Form>>

  // Back-compat: setFieldErrorsFromApi previously returned ValidationError[].
  // New implementation returns the structured HydrateApiErrorsResult but we
  // still emit the errors array to match the documented return — consumers
  // wanting the structured result should call the underlying hydrate helper
  // directly.
  const setFieldErrorsFromApi = (
    payload: Parameters<typeof setFromApiBuilt>[0]
  ): ValidationError[] => setFromApiBuilt(payload).errors

  // --- getValue / setValue (overloaded) ---
  function getValueImpl(
    pathOrContext?: string | CurrentValueContext<boolean>,
    maybeContext?: CurrentValueContext<boolean>
  ): unknown {
    if (pathOrContext === undefined) {
      return state.form as unknown as Readonly<Ref<GetValueFormType>>
    }
    if (typeof pathOrContext === 'object') {
      // { withMeta: true|false } at position 0
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
      // setValue(value) — whole-form replacement.
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
  // `state.originals` is a plain (non-reactive) Map, but it only grows inside
  // applyFormReplacement — which also mutates the reactive `form` ref. Reading
  // `state.form.value` inside the computed is what establishes the dependency
  // edge; originals being non-reactive is an optimisation (the set doesn't
  // change independently of form.value, so tracking it would only add noise).
  const isDirty = computed<boolean>(() => {
    for (const [pathKey, original] of state.originals) {
      const segments = JSON.parse(pathKey) as Path
      if (!Object.is(getAtPath(state.form.value, segments), original)) return true
    }
    return false
  })

  // `state.errors` is a Vue-reactive Map; reading `.size` in the computed
  // tracks per-key changes via Vue's collection handlers.
  const isValid = computed<boolean>(() => state.errors.size === 0)

  // --- Submission lifecycle ---
  // The underlying refs live on FormState so `reset()` can clear them in one
  // place. Exposing via `computed` gives consumers a read-only view —
  // mutation happens only inside handleSubmit's wrapper.
  const isSubmitting = computed<boolean>(() => state.isSubmitting.value)
  const submitCount = computed<number>(() => state.submitCount.value)
  const submitError = computed<unknown>(() => state.submitError.value)

  // --- Reset ---
  const reset = (nextInitialState?: DeepPartial<Form>): void => {
    state.reset(nextInitialState)
  }

  const resetField = (pathInput: string): void => {
    const segments = canonicalizePath(pathInput).segments
    state.resetField(segments)
  }

  // --- Field arrays ---
  // Typed on the public return (ArrayPath<Form> + ArrayItem<Form, Path>);
  // the untyped core helpers accept `(string, unknown)` and the
  // cast on the way out of `return` recovers the narrowed shape.
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
    register: register as UseAbstractFormReturnType<Form, GetValueFormType>['register'],
    key,
    fieldErrors: fieldErrors as Readonly<ComputedRef<FormErrorRecord>>,
    setFieldErrors,
    addFieldErrors,
    clearFieldErrors,
    setFieldErrorsFromApi,
    isDirty,
    isValid,
    isSubmitting,
    submitCount,
    submitError,
    reset: reset as UseAbstractFormReturnType<Form, GetValueFormType>['reset'],
    resetField: resetField as UseAbstractFormReturnType<Form, GetValueFormType>['resetField'],
    append: fieldArrays.append as UseAbstractFormReturnType<Form, GetValueFormType>['append'],
    prepend: fieldArrays.prepend as UseAbstractFormReturnType<Form, GetValueFormType>['prepend'],
    insert: fieldArrays.insert as UseAbstractFormReturnType<Form, GetValueFormType>['insert'],
    remove: fieldArrays.remove as UseAbstractFormReturnType<Form, GetValueFormType>['remove'],
    swap: fieldArrays.swap as UseAbstractFormReturnType<Form, GetValueFormType>['swap'],
    move: fieldArrays.move as UseAbstractFormReturnType<Form, GetValueFormType>['move'],
    replace: fieldArrays.replace as UseAbstractFormReturnType<Form, GetValueFormType>['replace'],
  }
}

function buildFreshState<F extends GenericForm>(
  key: FormKey,
  schema: AbstractSchema<F, F>,
  configuration: UseFormConfiguration<F, F, AbstractSchema<F, F>, DeepPartial<F>>,
  registry: ReturnType<typeof useRegistry>
): FormState<F> {
  const pending = registry.pendingHydration.get(key)
  if (pending !== undefined) registry.pendingHydration.delete(key)
  const state = createFormState<F>({
    formKey: key,
    schema,
    initialState: configuration.initialState,
    validationMode: configuration.validationMode,
    hydration: pending,
  })
  // Storage type is FormState<GenericForm>; the lookup above narrows back to F
  // via the `existing as FormState<Form>` cast.
  ;(registry.forms as Map<FormKey, FormState<GenericForm>>).set(
    key,
    state as unknown as FormState<GenericForm>
  )
  return state
}

function contextualiseValue<F extends GenericForm>(
  state: FormState<F>,
  segments: Path,
  context: CurrentValueContext<boolean>
): unknown {
  // withMeta: true returns { currentValue, meta } per UseAbstractFormReturnType.
  // For now we return the simple shape — the meta field is a stub until Phase 2
  // finishes. No existing tests exercise this branch; trace to zero consumer
  // coverage means the simple implementation doesn't regress anything.
  const currentValue = computed(() => getAtPath(state.form.value, segments))
  if (context.withMeta === true) {
    return {
      currentValue: currentValue as Readonly<Ref<unknown>>,
      meta: computed(() => ({})) as Readonly<Ref<unknown>>,
    } as unknown as CurrentValueWithContext<unknown>
  }
  return currentValue as Readonly<Ref<unknown>>
}

function requireFormKey(key: FormKey | undefined): FormKey {
  if (key === undefined || key === null || key === '') {
    throw new Error(
      '[@chemical-x/forms] useForm requires an explicit `key` option. ' +
        'Anonymous forms share state across unrelated components; pass a unique string per form.'
    )
  }
  return key
}

export type { FieldStateView }
