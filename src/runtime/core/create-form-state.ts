import { reactive, ref, type Ref } from 'vue'
import type {
  AbstractSchema,
  FormKey,
  InitialStateResponse,
  ValidationError,
  ValidationMode,
} from '../types/types-api'
import type { DeepPartial, GenericForm } from '../types/types-core'
import { diffAndApply } from './diff-apply'
import { canonicalizePath, type Path, type PathKey, type Segment } from './paths'
import { getAtPath, setAtPath } from './path-walker'

/**
 * Per-form closure state — the single store owned by each `useForm` call.
 * Replaces five separate `useState`-backed composables from the pre-rewrite
 * code (form, summary, element, field-state, meta-tracker, error), and in
 * doing so fixes the cross-form DOM state collision that stemmed from those
 * stores being keyed only by `path` instead of `(formKey, path)`.
 *
 * This is NOT a singleton. Each call to `useForm` creates its own FormState
 * instance and holds onto it via closure. The registry (Phase 2) provides
 * SSR hydration; otherwise the state is per-component-per-form.
 */

/** Per-path field status. Replaced wholesale (not mutated in place) on every change. */
export type FieldRecord = {
  readonly path: Path
  readonly updatedAt: string | null
  readonly isConnected: boolean
  readonly focused: boolean | null
  readonly blurred: boolean | null
  readonly touched: boolean | null
}

/** Per-path DOM element tracking. Client-only. */
export type ElementRecord = {
  readonly elements: Set<HTMLElement>
}

export type FormState<F extends GenericForm> = {
  readonly formKey: FormKey
  readonly form: Ref<F>
  readonly fields: Map<PathKey, FieldRecord>
  readonly elements: Map<PathKey, ElementRecord>
  readonly errors: Map<PathKey, ValidationError[]>
  readonly originals: Map<PathKey, unknown>
  readonly schema: AbstractSchema<F, F>

  // --- submission lifecycle ---
  // Driven by buildProcessForm's handleSubmit wrapper. See use-abstract-form.ts
  // for the public readonly surface. Mutations happen in exactly one place
  // (the submit handler) so there's no "source of truth" ambiguity — these
  // refs live on FormState so a `reset()` can clear them too.
  readonly isSubmitting: Ref<boolean>
  readonly submitCount: Ref<number>
  readonly submitError: Ref<unknown>

  // --- form mutations ---
  applyFormReplacement(next: F): void
  setValueAtPath(path: Path, value: unknown): void
  getValueAtPath(path: Path): unknown

  // --- errors ---
  setErrorsForPath(path: Path, errors: ValidationError[]): void
  setAllErrors(errors: readonly ValidationError[]): void
  addErrors(errors: readonly ValidationError[]): void
  clearErrors(path?: Path): void
  getErrorsForPath(path: Path): ValidationError[]

  // --- DOM ---
  registerElement(path: Path, element: HTMLElement): boolean
  deregisterElement(path: Path, element: HTMLElement): number
  markFocused(path: Path, focused: boolean): void
  markTouched(path: Path): void

  // --- derived ---
  isPristineAtPath(path: Path): boolean
  getFieldRecord(path: Path): FieldRecord | undefined
  getOriginalAtPath(path: Path): unknown
}

/**
 * Hydration payload shape accepted by `createFormState`. When provided, the
 * initial form value comes from here rather than from `schema.getInitialState`.
 * Used to replay SSR state on the client; originals are reconstructed from
 * the schema because they're not serialised.
 */
export type FormStateHydration = {
  readonly form: unknown
  readonly errors: ReadonlyArray<readonly [string, unknown]>
  readonly fields: ReadonlyArray<readonly [string, unknown]>
}

export type CreateFormStateOptions<F extends GenericForm> = {
  readonly formKey: FormKey
  readonly schema: AbstractSchema<F, F>
  readonly initialState?: DeepPartial<F> | undefined
  readonly validationMode?: ValidationMode | undefined
  readonly hydration?: FormStateHydration | undefined
}

export function createFormState<F extends GenericForm>(
  options: CreateFormStateOptions<F>
): FormState<F> {
  const { formKey, schema, initialState, validationMode = 'lax', hydration } = options

  // Schema is ALWAYS consulted: we need the schema-derived originals even
  // when hydrating, so pristine/dirty computation survives SSR round-trip.
  // The form's actual starting value, though, prefers hydration data.
  const schemaResponse: InitialStateResponse<F> = schema.getInitialState({
    useDefaultSchemaValues: true,
    constraints: initialState,
    validationMode,
  })
  const schemaInitialData = schemaResponse.data

  const initialData: F = hydration !== undefined ? (hydration.form as F) : schemaInitialData

  const form = ref(initialData) as Ref<F>

  // Per-path state. `reactive(new Map())` uses Vue's collection handlers —
  // reads of specific keys track those keys only, so a change to one field
  // doesn't invalidate computeds watching another.
  const fields = reactive(new Map<PathKey, FieldRecord>()) as Map<PathKey, FieldRecord>
  const elements = reactive(new Map<PathKey, ElementRecord>()) as Map<PathKey, ElementRecord>
  const errors = reactive(new Map<PathKey, ValidationError[]>()) as Map<PathKey, ValidationError[]>

  // Originals are captured at init and on first appearance of a path; never
  // re-assigned. Not reactive — the set is append-only per form's lifetime.
  const originals = new Map<PathKey, unknown>()

  // Submission lifecycle refs. Initial values encode "no submission has
  // happened yet": not in flight, zero attempts, no captured error.
  const isSubmitting = ref(false)
  const submitCount = ref(0)
  const submitError = ref<unknown>(null)

  // Populate originals by diffing from empty-form to schema-initial. This is
  // always the schema's shape regardless of hydration, so pristine/dirty
  // comparisons are against what the form was supposed to start as.
  const initStamp = new Date().toISOString()
  diffAndApply({}, schemaInitialData, [], (patch) => {
    if (patch.kind !== 'added') return
    const { key } = canonicalizePath(patch.path)
    originals.set(key, patch.newValue)
  })

  // Populate fields from either the hydration payload (preserves exact
  // server-side timestamps and flags) or by walking initialData for leaves.
  if (hydration !== undefined) {
    for (const [rawKey, record] of hydration.fields) {
      fields.set(rawKey as PathKey, record as FieldRecord)
    }
    for (const [rawKey, errs] of hydration.errors) {
      errors.set(rawKey as PathKey, errs as ValidationError[])
    }
  } else {
    diffAndApply({}, initialData, [], (patch) => {
      if (patch.kind !== 'added') return
      const { key } = canonicalizePath(patch.path)
      fields.set(key, {
        path: patch.path,
        updatedAt: initStamp,
        isConnected: false,
        focused: null,
        blurred: null,
        touched: null,
      })
    })
  }

  function touchFieldRecord(
    pathKey: PathKey,
    path: Path,
    patch: Partial<Omit<FieldRecord, 'path'>>
  ): void {
    const current = fields.get(pathKey)
    fields.set(pathKey, {
      path,
      updatedAt: patch.updatedAt ?? current?.updatedAt ?? null,
      isConnected: patch.isConnected ?? current?.isConnected ?? false,
      focused: patch.focused ?? current?.focused ?? null,
      blurred: patch.blurred ?? current?.blurred ?? null,
      touched: patch.touched ?? current?.touched ?? null,
    })
  }

  function applyFormReplacement(next: F): void {
    const prev = form.value
    if (Object.is(prev, next)) return
    form.value = next
    const now = new Date().toISOString()
    diffAndApply(prev, next, [], (patch) => {
      const { key } = canonicalizePath(patch.path)
      if (patch.kind === 'added' && !originals.has(key)) {
        originals.set(key, patch.newValue)
      }
      touchFieldRecord(key, patch.path, { updatedAt: now })
    })
  }

  function setValueAtPath(path: Path, value: unknown): void {
    const nextForm = setAtPath(form.value, path, value) as F
    applyFormReplacement(nextForm)
  }

  function getValueAtPath(path: Path): unknown {
    return getAtPath(form.value, path)
  }

  // --- Errors ---

  function setErrorsForPath(path: Path, entries: ValidationError[]): void {
    const { key } = canonicalizePath(path)
    if (entries.length === 0) {
      errors.delete(key)
      return
    }
    errors.set(key, [...entries])
  }

  function setAllErrors(entries: readonly ValidationError[]): void {
    errors.clear()
    for (const err of entries) {
      const { key } = canonicalizePath(err.path as Path)
      const current = errors.get(key)
      if (current === undefined) {
        errors.set(key, [err])
      } else {
        errors.set(key, [...current, err])
      }
    }
  }

  function addErrors(entries: readonly ValidationError[]): void {
    for (const err of entries) {
      const { key } = canonicalizePath(err.path as Path)
      const current = errors.get(key)
      if (current === undefined) {
        errors.set(key, [err])
      } else {
        errors.set(key, [...current, err])
      }
    }
  }

  function clearErrors(path?: Path): void {
    if (path === undefined) {
      errors.clear()
      return
    }
    const { key } = canonicalizePath(path)
    errors.delete(key)
  }

  function getErrorsForPath(path: Path): ValidationError[] {
    const { key } = canonicalizePath(path)
    return errors.get(key) ?? []
  }

  // --- DOM ---

  function registerElement(path: Path, element: HTMLElement): boolean {
    const { key } = canonicalizePath(path)
    const record = elements.get(key)
    if (record === undefined) {
      elements.set(key, { elements: new Set([element]) })
    } else {
      if (record.elements.has(element)) return false
      record.elements.add(element)
    }
    touchFieldRecord(key, path, { isConnected: true })
    return true
  }

  function deregisterElement(path: Path, element: HTMLElement): number {
    const { key } = canonicalizePath(path)
    const record = elements.get(key)
    if (record === undefined) return 0
    record.elements.delete(element)
    const remaining = record.elements.size
    if (remaining === 0) {
      elements.delete(key)
      touchFieldRecord(key, path, { isConnected: false })
    }
    return remaining
  }

  function markFocused(path: Path, focused: boolean): void {
    const { key } = canonicalizePath(path)
    touchFieldRecord(key, path, {
      focused,
      blurred: !focused,
      // `touched` becomes true on blur (matches the pre-rewrite contract).
      touched: focused ? (fields.get(key)?.touched ?? null) : true,
    })
  }

  function markTouched(path: Path): void {
    const { key } = canonicalizePath(path)
    touchFieldRecord(key, path, { touched: true })
  }

  // --- Derived ---

  function isPristineAtPath(path: Path): boolean {
    const { key, segments } = canonicalizePath(path)
    if (!originals.has(key)) return true
    return Object.is(getAtPath(form.value, segments), originals.get(key))
  }

  function getFieldRecord(path: Path): FieldRecord | undefined {
    const { key } = canonicalizePath(path)
    return fields.get(key)
  }

  function getOriginalAtPath(path: Path): unknown {
    const { key } = canonicalizePath(path)
    return originals.get(key)
  }

  return {
    formKey,
    form,
    fields,
    elements,
    errors,
    originals,
    schema,
    isSubmitting,
    submitCount,
    submitError,

    applyFormReplacement,
    setValueAtPath,
    getValueAtPath,

    setErrorsForPath,
    setAllErrors,
    addErrors,
    clearErrors,
    getErrorsForPath,

    registerElement,
    deregisterElement,
    markFocused,
    markTouched,

    isPristineAtPath,
    getFieldRecord,
    getOriginalAtPath,
  }
}

export type { Path, PathKey, Segment }
