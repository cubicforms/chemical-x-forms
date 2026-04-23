import type { ComputedRef, ObjectDirective, Ref } from 'vue'
import type {
  ArrayItem,
  ArrayPath,
  DeepPartial,
  FlatPath,
  GenericForm,
  IsObjectOrArray,
  NestedType,
} from './types-core'

export type FormKey = string

export type ValidationError = {
  message: string
  path: (string | number)[]
  formKey: FormKey
}

export type ValidationResponseSuccess<TData> = {
  data: TData
  errors: undefined
  success: true
  formKey: FormKey
}
export type ValidationResponseErrorWithoutData = {
  data: undefined
  errors: ValidationError[]
  success: false
  formKey: FormKey
}
export type ValidationResponseErrorWithData<TData> = {
  data: TData
  errors: ValidationError[]
  success: false
  formKey: FormKey
}

export type ValidationResponse<TData> =
  | ValidationResponseSuccess<TData>
  | ValidationResponseErrorWithData<TData>
  | ValidationResponseErrorWithoutData

export type InitialStateResponse<TData> =
  | ValidationResponseSuccess<TData>
  | ValidationResponseErrorWithData<TData>

export type ValidationResponseWithoutValue<Form> = Omit<ValidationResponse<Form>, 'data'>

// strict: validate the data against the provided schema
// lax: ONLY validate the shape of the data against the schema
export type ValidationMode = 'strict' | 'lax'

type GetInitialStateConfig<Form> = {
  useDefaultSchemaValues: boolean
  validationMode?: ValidationMode
  constraints?: DeepPartial<Form> | undefined
}

export type AbstractSchema<Form, GetValueFormType> = {
  getInitialState(config: GetInitialStateConfig<Form>): InitialStateResponse<Form>
  getSchemasAtPath(path: string): AbstractSchema<NestedType<Form, typeof path>, GetValueFormType>[]
  /**
   * Validate a subtree (when `path` is provided) or the whole form (when
   * `path` is `undefined`). Returns a `Promise` so adapters can back
   * validation onto async parsers (`zod.safeParseAsync`) and consumers can
   * express async refinements (`z.string().refine(async ...)`). Adapters
   * MUST NOT throw — errors are returned as a `success: false` response
   * with a populated `errors` array.
   */
  validateAtPath(data: unknown, path: string | undefined): Promise<ValidationResponse<Form>>
}

/**
 * Status the `validate()` reactive ref exposes. `pending: true` means a
 * validation call is in flight — `errors` / `success` / `formKey` reflect
 * the initial "no result yet" state. `pending: false` is the settled
 * state; the other fields mirror the latest `ValidationResponse`.
 *
 * Consumers narrow on `pending`: `if (!status.pending) { ... }` gives
 * access to the settled discriminated union (success or failure).
 */
export type PendingValidationStatus = {
  readonly pending: true
  readonly errors: undefined
  readonly success: false
  readonly formKey: FormKey
}

export type SettledValidationStatus<Form> = {
  readonly pending: false
} & ValidationResponseWithoutValue<Form>

export type ReactiveValidationStatus<Form> = PendingValidationStatus | SettledValidationStatus<Form>

/**
 * Optional policy that fires on submit-validation failure — the library
 * can focus and/or scroll the first errored field into view without the
 * consumer having to wire an `onError` callback. Off by default.
 */
export type OnInvalidSubmitPolicy = 'none' | 'focus-first-error' | 'scroll-to-first-error' | 'both'

/**
 * Field-level validation trigger mode.
 *
 * - `'none'` (default): no field-level validation. `handleSubmit` and
 *   explicit `validate()` / `validateAsync()` calls are the only
 *   validation surface.
 * - `'change'`: on every mutation via `setValueAtPath` (register,
 *   `setValue(path, ...)`, array helpers), schedule a debounced
 *   validation for the written path.
 * - `'blur'`: on `markFocused(path, false)` — i.e. when the user
 *   tabs away from a field — validate immediately (no debounce) for
 *   that path.
 */
export type FieldValidationMode = 'change' | 'blur' | 'none'

export type FieldValidationConfig = {
  /** Trigger mode. Default `'none'`. */
  on?: FieldValidationMode
  /**
   * Debounce window for `on: 'change'`. Ignored when `on` is `'blur'`
   * or `'none'`. Default `200` ms.
   */
  debounceMs?: number
}

/**
 * Built-in storage backend keys — maps to `localStorage`,
 * `sessionStorage`, or a zero-dep IndexedDB wrapper. Consumers can
 * swap in a custom `FormStorage` object for anything else (encrypted
 * local storage, a cookie store, a native mobile bridge).
 */
export type FormStorageKind = 'local' | 'session' | 'indexeddb'

/**
 * Uniform async storage contract. `localStorage` / `sessionStorage`
 * are wrapped in `async` functions; the single-microtask cost is
 * negligible and the simpler contract beats a `T | Promise<T>` union
 * that every caller would have to handle.
 *
 * `getItem` returns `unknown` (not `string | null`) because IDB
 * stores structured-cloned values. The local/session adapters
 * stringify on write and parse on read, so from the caller's
 * perspective the contract is "give me back whatever I put in".
 */
export type FormStorage = {
  getItem(key: string): Promise<unknown>
  setItem(key: string, value: unknown): Promise<void>
  removeItem(key: string): Promise<void>
}

export type PersistIncludeMode = 'form' | 'form+errors'

/**
 * Opt-in persistence for the form's draft state. The library writes
 * (debounced) on every mutation and reads back on mount. Off by
 * default — no config → no reads, no writes, zero overhead.
 */
export type PersistConfig = {
  /**
   * Which backend to persist to. String shortcuts load built-in
   * adapters via dynamic import (tree-shakeable — a consumer who
   * picks `'local'` never pulls IndexedDB code). Pass a custom
   * `FormStorage` object for anything else.
   */
  storage: FormStorageKind | FormStorage

  /** Defaults to `chemical-x-forms:${formKey}`. */
  key?: string

  /** Debounce window for writes. Default `300` ms. */
  debounceMs?: number

  /**
   * `'form'` (default) persists only the form value. Errors on
   * reload are usually stale — fresh validation will repopulate
   * them. Use `'form+errors'` when the server-side error context
   * is expensive to reconstruct (complex cross-field refinements).
   */
  include?: PersistIncludeMode

  /**
   * Increment to invalidate all existing persisted payloads across
   * every client. Readers check `v` and drop mismatched entries.
   * Default `1`.
   */
  version?: number

  /** Clear the persisted entry when a submit handler resolves. Default `true`. */
  clearOnSubmitSuccess?: boolean
}

export type UseFormConfiguration<
  Form extends GenericForm,
  GetValueFormType,
  Schema extends AbstractSchema<Form, GetValueFormType>,
  InitialState extends DeepPartial<Form>,
> = {
  schema: Schema | ((key: FormKey) => Schema)
  // Required by design: forms without an explicit key silently share state
  // across unrelated components. The runtime `requireFormKey` still throws
  // for non-TS consumers passing `undefined` / `''`.
  key: FormKey
  initialState?: InitialState
  validationMode?: ValidationMode
  /**
   * What to do when a submit attempt fails validation. Fires after the
   * error store is populated and before the user's `onError` callback.
   * Default `'none'` — consumers who want this behaviour must opt in.
   *
   * - `'focus-first-error'`: calls `.focus({ preventScroll: true })` on
   *   the first errored field's first connected, visible element.
   * - `'scroll-to-first-error'`: calls `.scrollIntoView()` on it.
   * - `'both'`: scroll then focus (focus-with-preventScroll means the
   *   browser doesn't do its own scroll and undo the explicit one).
   * - `'none'` (default): no-op.
   *
   * If no errored field has a currently-mounted, visible element (every
   * candidate is unmounted or `display:none`), this policy silently
   * no-ops rather than throwing.
   */
  onInvalidSubmit?: OnInvalidSubmitPolicy

  /**
   * Configure per-field validation that fires between submit attempts.
   * Default `{ on: 'none' }` — no field validation.
   *
   * - `{ on: 'change', debounceMs: 200 }` — every mutation via
   *   `setValueAtPath` schedules validation for that path after the
   *   debounce elapses. Rapid successive mutations reset the timer;
   *   in-flight runs are cancelled via `AbortController` so stale
   *   results can't clobber fresher ones.
   * - `{ on: 'blur' }` — validation fires immediately (no debounce)
   *   when the user tabs away from a registered field. Ignores
   *   `debounceMs`.
   *
   * Runs concurrently with `handleSubmit`'s full-form validation:
   * field runs in flight are aborted at submit entry so the submit
   * result is authoritative. Aborted on `reset()` too.
   */
  fieldValidation?: FieldValidationConfig

  /**
   * Opt-in persistence of the form's draft state. Off by default.
   * See `docs/recipes/persistence.md` for the tradeoff table and
   * backend picker guidance. Key fields:
   *
   * - `storage: 'local' | 'session' | 'indexeddb' | FormStorage`
   * - `key?`: persisted entry key. Defaults to
   *   `chemical-x-forms:${formKey}`.
   * - `debounceMs?`: write debounce. Default `300` ms.
   * - `version?`: bump to invalidate existing entries.
   * - `clearOnSubmitSuccess?`: default `true`.
   */
  persist?: PersistConfig
}

export type FormStore<TData extends GenericForm> = Map<FormKey, TData>

export type FormSummaryValue = {
  originalValue: unknown
  previousValue: unknown
  currentValue: unknown
  pristine: boolean
  dirty: boolean
}
export type FormSummaryValueRecord = Record<string, FormSummaryValue>
export type FormSummaryStore = Map<FormKey, FormSummaryValueRecord>

export type OnSubmit<Form extends GenericForm> = (form: Form) => void | Promise<void>
export type OnError = (error: ValidationError[]) => void | Promise<void>

/**
 * `handleSubmit(onSubmit, onError?)` returns a submit handler — a function
 * that runs validation and dispatches to `onSubmit` (success) or `onError`
 * (failure). Bind it directly to a form's `@submit.prevent` or invoke it
 * programmatically.
 *
 * The returned handler optionally accepts the originating `Event` so it can
 * sit on `@submit` directly (without `.prevent` if you want to call
 * `event.preventDefault()` yourself).
 */
export type SubmitHandler = (event?: Event) => Promise<void>
export type HandleSubmit<Form extends GenericForm> = (
  onSubmit: OnSubmit<Form>,
  onError?: OnError
) => SubmitHandler

export type MetaTrackerValue = {
  updatedAt: string | null
  rawValue: unknown
  isConnected: boolean
  formKey: FormKey
  path: string | null
}
export type MetaTracker = Record<string, MetaTrackerValue>
export type MetaTrackerStore = Map<FormKey, MetaTracker>

export type CurrentValueContext<WithMeta extends boolean = false> = {
  withMeta?: WithMeta
}

type RemapLeafNodes<T, V, Q = NonNullable<T>> =
  Q extends Record<string, unknown>
    ? { [K in keyof Q]: RemapLeafNodes<Q[K], V> }
    : Q extends Array<infer U>
      ? Array<RemapLeafNodes<U, V>>
      : V

export type CurrentValueWithContext<Value, FormSubtree = Value> = {
  currentValue: Readonly<Ref<Value>>
  meta: Readonly<Ref<DeepPartial<RemapLeafNodes<FormSubtree, MetaTrackerValue>>>>
}

// This generic generates full paths and paths that point to string arrays
// This staisfies ts edge case for multi-select and multi-checkbox elements
export type RegisterFlatPath<Form, Key extends keyof Form = keyof Form> =
  IsObjectOrArray<Form> extends true
    ? Key extends string
      ? Form[Key] extends infer Value
        ? Value extends Array<infer ArrayItem>
          ? ArrayItem extends string
            ? `${Key}` | `${Key}.${number}`
            : `${Key}.${number}.${RegisterFlatPath<ArrayItem>}`
          : Value extends GenericForm
            ? `${Key}.${RegisterFlatPath<Value>}`
            : `${Key}`
        : never
      : Key extends number
        ?
            | `${Key}`
            | (Form[Key] extends GenericForm
                ? `${Key}.${RegisterFlatPath<Form[Key]>}`
                : Form[Key] extends Array<infer ArrayItem>
                  ? IsObjectOrArray<ArrayItem> extends true
                    ? `${Key}.${number}.${RegisterFlatPath<ArrayItem>}`
                    : ArrayItem extends string
                      ? `${Key}` | `${Key}.${number}`
                      : `${Key}.${number}`
                  : never)
        : never
    : never

export type RegisterValue<Value = unknown> = {
  innerRef: Readonly<Ref<Value>>
  registerElement: (el: HTMLElement) => void
  deregisterElement: (el: HTMLElement) => void
  setValueWithInternalPath: (value: unknown) => boolean
}

export type CustomDirectiveRegisterAssignerFn = (value: unknown) => void
export type CustomRegisterDirective<T, Modifiers extends string = string> = ObjectDirective<
  T & {
    _assigning?: boolean
    [S: symbol]: CustomDirectiveRegisterAssignerFn
  },
  RegisterValue,
  Modifiers,
  string
>

// bring in this RegisterModelDynamicCustomDirective type once PR #12605 in vuejs/core enters production (currently in main but not released)
// https://github.com/vuejs/core/pull/12605
// export type RegisterTextCustomDirective = CustomRegisterDirective<
// HTMLInputElement | HTMLTextAreaElement,
// "trim" | "number" | "lazy"
// >

export type RegisterTextCustomDirective = CustomRegisterDirective<
  HTMLInputElement | HTMLTextAreaElement,
  string
>

export type RegisterCheckboxCustomDirective = CustomRegisterDirective<HTMLInputElement>
export type RegisterRadioCustomDirective = CustomRegisterDirective<HTMLInputElement>

// bring in this RegisterModelDynamicCustomDirective type once PR #12605 in vuejs/core enters production (currently in main but not released)
// https://github.com/vuejs/core/pull/12605
// export type RegisterTextCustomDirective = CustomRegisterDirective<
// HTMLInputElement | HTMLTextAreaElement,
// "trim" | "number" | "lazy"
// >
// export type RegisterSelectCustomDirective = CustomRegisterDirective<HTMLSelectElement, "number">
export type RegisterSelectCustomDirective = CustomRegisterDirective<HTMLSelectElement, string>

// bring in this RegisterModelDynamicCustomDirective type once PR #12605 in vuejs/core enters production (currently in main but not released)
// https://github.com/vuejs/core/pull/12605
// export type RegisterModelDynamicCustomDirective = ObjectDirective<
// HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, RegisterValue, "trim" | "number" | "lazy"
// >
export type RegisterModelDynamicCustomDirective = ObjectDirective<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  RegisterValue,
  string
>
export type RegisterDirective =
  | RegisterTextCustomDirective
  | RegisterCheckboxCustomDirective
  | RegisterSelectCustomDirective
  | RegisterRadioCustomDirective
  | RegisterModelDynamicCustomDirective

export type SetValueCallback<Payload> = (value: DeepPartial<Payload>) => DeepPartial<Payload>
export type SetValuePayload<Payload> = DeepPartial<Payload> | SetValueCallback<Payload>

type DeepFlatten<T> =
  // If it's not an object, just leave it as-is
  T extends object
    ? {
        // Re-map every property key of T
        [K in keyof T]: DeepFlatten<T[K]>
      }
    : T
export type DOMFieldState = {
  focused: boolean | null
  blurred: boolean | null
  touched: boolean | null
}
export type FieldState = DeepFlatten<
  DOMFieldState & {
    meta: MetaTrackerValue
    /**
     * Validation errors for this field's path. Populated automatically when
     * `handleSubmit` validates, and manually via `setFieldErrors` /
     * `setFieldErrorsFromApi`. Empty array when there are no errors for the
     * field — safe to read without a null check.
     */
    errors: ValidationError[]
  } & FormSummaryValue
>
export type DOMFieldStateStore = Map<string, DOMFieldState | undefined>

/** Reactive per-field error store, keyed by `path.join('.')`. */
export type FormErrorRecord = Record<string, ValidationError[]>
export type FormErrorStore = Map<FormKey, FormErrorRecord>

/**
 * Normalised API error envelope — the shape cubic-forms (and many DRF-style
 * APIs) return for 4xx validation failures. Both the wrapped
 * `{ error: { details } }` form and the raw `{ details }` form are accepted.
 */
export type ApiErrorDetails = Record<string, string | string[]>
export type ApiErrorEnvelope = {
  error?: {
    details?: ApiErrorDetails
    [k: string]: unknown
  }
  details?: ApiErrorDetails
}

export type UseAbstractFormReturnType<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
> = {
  getFieldState: (path: FlatPath<Form, keyof Form, true>) => Ref<FieldState>
  handleSubmit: HandleSubmit<Form>
  getValue: {
    (): Readonly<Ref<GetValueFormType>>
    <Path extends FlatPath<Form>>(path: Path): Readonly<Ref<NestedType<GetValueFormType, Path>>>
    <WithMeta extends boolean>(
      context: CurrentValueContext<WithMeta>
    ): WithMeta extends true
      ? CurrentValueWithContext<GetValueFormType>
      : Readonly<Ref<GetValueFormType>>
    <Path extends FlatPath<Form>, WithMeta extends boolean>(
      path: Path,
      context: CurrentValueContext<WithMeta>
    ): WithMeta extends true
      ? CurrentValueWithContext<NestedType<GetValueFormType, Path>>
      : Readonly<Ref<NestedType<GetValueFormType, Path>>>
  }
  setValue: {
    <Value extends SetValuePayload<Form>>(value: Value): boolean
    <Path extends FlatPath<Form>, Value extends SetValuePayload<NestedType<Form, Path>>>(
      path: Path,
      value: Value
    ): boolean
  }

  /**
   * Reactive validation status for the whole form (or a subtree when a
   * path is given). The returned ref's value carries a `pending` flag —
   * `true` while the async validator is in flight, `false` when settled.
   * Consumers typically gate rendering on `!status.value.pending` before
   * trusting `success` / `errors`.
   *
   * Re-runs whenever the form (or the subtree at `path`) mutates. Stale
   * in-flight validations are dropped via an internal generation counter,
   * so the ref only ever writes results from the most recent call.
   */
  validate: (path?: FlatPath<Form>) => Readonly<Ref<ReactiveValidationStatus<Form>>>

  /**
   * Imperative one-shot validation. Resolves to a settled
   * `ValidationResponseWithoutValue` (success + undefined errors, or
   * failure + populated errors) for the whole form when called without a
   * path, or for the subtree at `path`. Unlike `validate()`, this does
   * not subscribe to form reactivity — each call runs validation once
   * against the current form state.
   *
   * `isValidating` is flipped `true` while the returned promise is
   * in flight.
   */
  validateAsync: (path?: FlatPath<Form>) => Promise<ValidationResponseWithoutValue<Form>>
  // register is generic so the RegisterValue narrows to the specific path's
  // leaf type. Without the generic, `typeof path` in the return would resolve
  // to the full `RegisterFlatPath<Form>` union, and every register call
  // would produce a RegisterValue<union-of-every-leaf | undefined>.
  register: <Path extends RegisterFlatPath<Form, keyof Form>>(
    path: Path
  ) => RegisterValue<NestedType<Form, Path> | undefined>
  key: FormKey

  // --- Reactive field-error API ---

  /**
   * Reactive map of field errors keyed by the dotted path. Populated
   * automatically by `handleSubmit` on validation failure and cleared on
   * validation success. Also writable via `setFieldErrors` /
   * `setFieldErrorsFromApi` for server-side hydration.
   */
  fieldErrors: Readonly<ComputedRef<FormErrorRecord>>

  /** Replace all field errors for this form with the provided list. */
  setFieldErrors: (errors: ValidationError[]) => void

  /** Append errors to the existing set, preserving current entries. */
  addFieldErrors: (errors: ValidationError[]) => void

  /**
   * Clear errors for a specific path (string or path-array), or — when called
   * with no arguments — clear every field error for this form.
   */
  clearFieldErrors: (path?: string | (string | number)[]) => void

  /**
   * Convenience for server-error hydration: accepts either the wrapped
   * `{ error: { details } }` envelope or a raw `{ path: [msg] }` record,
   * maps it to `ValidationError[]`, stamps the current form key, and calls
   * `setFieldErrors`. Returns the produced errors for downstream use.
   *
   * The optional `limits` object caps entry count and path depth so
   * attacker-controlled payloads (gateway passthroughs, untrusted
   * microservices) can't DoS the form. Defaults: 1 000 entries, depth 32.
   * Over-budget payloads are rejected wholesale; over-depth individual
   * keys are dropped but the rest of the payload still applies.
   */
  setFieldErrorsFromApi: (
    payload: ApiErrorEnvelope | ApiErrorDetails | null | undefined,
    limits?: { maxEntries?: number; maxPathDepth?: number }
  ) => ValidationError[]

  // --- Form-level aggregates ---

  /**
   * `true` when any tracked leaf's current value differs from the value it
   * was initialised with. Returns `false` for a pristine form and for one
   * where every mutation has been undone back to its original.
   *
   * Comparisons use `Object.is`; object/array leaves are reference-compared,
   * so structural equality after a replace-with-equal-copy will still read
   * as dirty. Reset via `reset()` to restore the pristine baseline.
   */
  isDirty: Readonly<ComputedRef<boolean>>

  /**
   * `true` when the form has no recorded errors. Driven by the same error
   * store `fieldErrors` exposes — a successful `validate()` / `handleSubmit`
   * run clears errors and flips this to true; a failed run populates them
   * and flips to false.
   */
  isValid: Readonly<ComputedRef<boolean>>

  // --- Submission lifecycle ---

  /**
   * `true` while a submit handler produced by `handleSubmit` is executing.
   * Flips on entry to the handler and off in a `finally` block — covers
   * both the validation phase and the user's async callback.
   */
  isSubmitting: Readonly<ComputedRef<boolean>>

  /**
   * Increments once per call to a submit handler, regardless of outcome
   * (validation failure, callback success, callback throw). Counts "how
   * many times did the user click submit", not "how many succeeded".
   */
  submitCount: Readonly<ComputedRef<number>>

  /**
   * Captures whatever the user's submit callback (or its `onError` handler)
   * threw or rejected with. Cleared to `null` at the start of each new
   * submission attempt; stays `null` on successful completion.
   *
   * The handler still re-throws — `submitError` is the reactive mirror for
   * template consumers; imperative callers can use `try { await
   * handler(event) }` as normal.
   */
  submitError: Readonly<ComputedRef<unknown>>

  /**
   * `true` while any validation run (reactive `validate()` re-run,
   * imperative `validateAsync(...)`, or the pre-submit validation inside
   * `handleSubmit`) is in flight. Drops back to `false` when every
   * in-flight run has settled.
   */
  isValidating: Readonly<ComputedRef<boolean>>

  // --- Reset ---

  /**
   * Restore the form to its initial state. With no argument, re-evaluates
   * the schema's defaults. With `nextInitialState`, applies those
   * constraints over the schema defaults (same precedence rules as the
   * `useForm({ initialState })` option).
   *
   * Side-effects beyond replacing `form`:
   *   - `originals` is rebuilt against the new baseline (so a follow-up
   *     `setValue` to any leaf will correctly flip `isDirty`);
   *   - `fieldErrors` is cleared;
   *   - per-field `touched` / `focused` / `blurred` are cleared (the
   *     `isConnected` DOM flag is preserved);
   *   - submission lifecycle (`isSubmitting` / `submitCount` /
   *     `submitError`) resets to the "pre-submission" state.
   */
  reset: (nextInitialState?: DeepPartial<Form>) => void

  /**
   * Restore a single field (or a whole sub-tree, when `path` names a
   * container like `'user'` rather than a leaf like `'user.name'`) to the
   * value captured in `originals`. Clears errors and resets touched flags
   * for the target and any descendants. Does not touch siblings or
   * submission state.
   *
   * No-ops if the path is not tracked (e.g. a freshly-named key that has
   * never been set or appeared in schema defaults).
   */
  resetField: (path: FlatPath<Form>) => void

  // --- Focus / scroll to first error ---

  /**
   * Focuses the first errored field's first connected, visible element.
   * Returns `true` when an element was focused, `false` when no
   * qualifying element was found (no errors, or every errored field is
   * unmounted / hidden).
   *
   * Honours `preventScroll`: pass `true` to suppress the browser's
   * default scroll-on-focus and do the scrolling yourself (pair with
   * `scrollToFirstError`).
   */
  focusFirstError: (options?: { preventScroll?: boolean }) => boolean

  /**
   * Scrolls the first errored field's first connected, visible element
   * into view. Returns `true` when the call happened, `false` when no
   * qualifying element was found.
   *
   * `options` is forwarded to `Element.scrollIntoView` unchanged — the
   * default is the browser's `{ block: 'start' }` behaviour.
   */
  scrollToFirstError: (options?: ScrollIntoViewOptions) => boolean

  // --- Field arrays ---
  //
  // Typed helpers for the common list-editing operations. `Path` is narrowed
  // to `ArrayPath<Form>` so calling these against a non-array path is a
  // compile error; `value` is narrowed to the array's element type so
  // appending a mismatched shape is also a compile error.
  //
  // Out-of-range behaviour differs by helper:
  //   - `remove` / `swap` / `move` / `replace` guard explicitly and no-op
  //     when any index is `< 0` or `>= length`.
  //   - `insert` delegates to `Array.prototype.splice`, which clamps
  //     `index` into `[0, length]` and treats negatives as offsets from
  //     the end (`splice(-1, 0, v)` inserts just before the last item).
  //     It therefore *does* insert at a clamped position rather than
  //     no-op — matching the ergonomic consumers expect from `splice`.
  append: <Path extends ArrayPath<Form>>(path: Path, value: ArrayItem<Form, Path>) => void
  prepend: <Path extends ArrayPath<Form>>(path: Path, value: ArrayItem<Form, Path>) => void
  insert: <Path extends ArrayPath<Form>>(
    path: Path,
    index: number,
    value: ArrayItem<Form, Path>
  ) => void
  remove: <Path extends ArrayPath<Form>>(path: Path, index: number) => void
  swap: <Path extends ArrayPath<Form>>(path: Path, a: number, b: number) => void
  move: <Path extends ArrayPath<Form>>(path: Path, from: number, to: number) => void
  replace: <Path extends ArrayPath<Form>>(
    path: Path,
    index: number,
    value: ArrayItem<Form, Path>
  ) => void
}
