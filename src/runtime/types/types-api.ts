import type { ObjectDirective, Ref } from 'vue'
import type { Path } from '../core/paths'
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

export type DefaultValuesResponse<TData> =
  | ValidationResponseSuccess<TData>
  | ValidationResponseErrorWithData<TData>

export type ValidationResponseWithoutValue<Form> = Omit<ValidationResponse<Form>, 'data'>

// strict: validate the data against the provided schema
// lax: ONLY validate the shape of the data against the schema
export type ValidationMode = 'strict' | 'lax'

type GetDefaultValuesConfig<Form> = {
  useDefaultSchemaValues: boolean
  validationMode?: ValidationMode
  constraints?: DeepPartial<Form> | undefined
}

export type AbstractSchema<Form, GetValueFormType> = {
  /**
   * Structural fingerprint of the schema. Same shape → same string;
   * different shape → (best-effort) different string.
   *
   * The library uses this to detect schema mismatches at a shared
   * form key: two `useForm({ key: 'x', schema })` calls are allowed
   * to land on the same `FormStore` (the "shared store" semantic),
   * but only when their schemas agree. If the second call's
   * fingerprint differs from the first's, the library emits a
   * dev-mode warning — the first call's schema stays canonical and
   * the second call's schema is silently ignored.
   *
   * Guarantees adapter authors should provide:
   * - **Determinism:** equal shapes at different memory addresses
   *   must produce the same fingerprint. Referential equality fails
   *   99% of the time across files, so reference-identity is not a
   *   substitute.
   * - **Key-order-insensitivity** for record-like shapes (object,
   *   struct) — two shapes with the same keys but different iteration
   *   order must match.
   * - **Order-insensitivity for unbounded unions** — `a | b` and
   *   `b | a` must match (the set of members is what matters, not
   *   their source order).
   *
   * Compromises adapter authors may accept:
   * - Function-valued metadata (`.refine(fn)`, `.transform(fn)`,
   *   lazy defaults) is not stably hashable. Represent it as an
   *   opaque sentinel; two schemas differing only in refinement
   *   logic will look identical. The warning is a footgun catcher,
   *   not a soundness guarantee.
   */
  fingerprint(): string

  getDefaultValues(config: GetDefaultValuesConfig<Form>): DefaultValuesResponse<Form>
  /**
   * Return every sub-schema that could resolve at the given structured
   * path. Multiple results are only expected for discriminated / union
   * branches where the adapter can't decide a single winner until the
   * data lands. `path` is the canonical `Segment[]` — adapters walk it
   * segment-by-segment so literal-dot keys (`['user.name']`) don't
   * collide with the sibling-pair form (`['user', 'name']`).
   */
  getSchemasAtPath(path: Path): AbstractSchema<unknown, GetValueFormType>[]
  /**
   * Validate a subtree (when `path` is provided) or the whole form (when
   * `path` is `undefined`). `path` is the canonical `Segment[]`, not a
   * dotted string — two schemas with otherwise-colliding dotted forms
   * (`['user.name']` vs `['user', 'name']`) stay distinct at the
   * adapter boundary.
   *
   * Returns a `Promise` so adapters can back validation onto async
   * parsers (`zod.safeParseAsync`) and consumers can express async
   * refinements (`z.string().refine(async ...)`). Adapters MUST NOT
   * throw — errors are returned as a `success: false` response with a
   * populated `errors` array.
   */
  validateAtPath(data: unknown, path: Path | undefined): Promise<ValidationResponse<Form>>
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
 * - `'change'` (default): on every mutation via `setValueAtPath`
 *   (register, `setValue(path, ...)`, array helpers), schedule a
 *   debounced validation for the written path. Errors track the
 *   live `(value, schema)` continuously so consumers can render
 *   inline feedback without waiting for submit.
 * - `'blur'`: on `markFocused(path, false)` — i.e. when the user
 *   tabs away from a field — validate immediately (no debounce) for
 *   that path.
 * - `'none'`: explicit opt-out. `handleSubmit` and explicit
 *   `validate()` / `validateAsync()` calls are the only validation
 *   surface; the per-keystroke / per-blur path is disabled entirely.
 */
export type FieldValidationMode = 'change' | 'blur' | 'none'

export type FieldValidationConfig = {
  /** Trigger mode. Default `'change'`. */
  on?: FieldValidationMode
  /**
   * Debounce window for `on: 'change'`. Ignored when `on` is `'blur'`
   * or `'none'`. Default `125` ms.
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
 * Undo/redo configuration. `true` enables with default `max: 50`.
 * Pass an object to tune the bounded snapshot stack size.
 */
export type HistoryConfig = true | { max?: number }

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
  DefaultValues extends DeepPartial<Form>,
> = {
  schema: Schema | ((key: FormKey) => Schema)
  /**
   * Optional — omit for one-off forms. When absent, the runtime
   * allocates a collision-free synthetic id via Vue's `useId()`
   * (SSR-safe, positional, stable across server→client hydration).
   * Each anonymous `useForm` call resolves to a distinct `FormStore`.
   *
   * Pass an explicit string key when the form needs identity:
   * - cross-component lookup via `useFormContext(key)` (distant,
   *   non-descendant access);
   * - intentionally shared state (multiple `useForm({ key: 'x' })`
   *   calls resolving to the same store);
   * - a stable persistence storage-key default;
   * - a recognisable DevTools / `ValidationError.formKey` label.
   *
   * Descendant-only access via ambient `useFormContext<F>()` works
   * for anonymous forms too — it resolves via `provide`/`inject`,
   * not the registry's key space.
   */
  key?: FormKey
  defaultValues?: DefaultValues
  /**
   * How strictly to validate the schema's default values at
   * construction.
   *
   * - `'strict'` (default): the schema validates its derived defaults
   *   immediately. If validation fails, the resulting errors seed
   *   `schemaErrors` so `fieldErrors` is populated from the first
   *   frame — keeps the data layer honest about the schema's verdict
   *   without requiring a user mutation. The UI decides when to
   *   *show* errors (gate on `state.touched`, `state.submitCount`,
   *   etc.).
   * - `'lax'`: refinements are stripped during default-values
   *   derivation and the construction-time seed is skipped. Use this
   *   for multi-step wizards, field arrays with placeholder rows, or
   *   any form where mounting with invalid data is intentional.
   *
   * Runtime validation (per-field on mutation, full-form on submit)
   * is identical in both modes; the difference is purely about
   * construction-time behaviour.
   */
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
   * Default `{ on: 'change', debounceMs: 125 }` — errors track the
   * live `(value, schema)` continuously.
   *
   * - `{ on: 'change', debounceMs: 125 }` — every mutation via
   *   `setValueAtPath` schedules validation for that path after the
   *   debounce elapses. Rapid successive mutations reset the timer;
   *   in-flight runs are cancelled via `AbortController` so stale
   *   results can't clobber fresher ones.
   * - `{ on: 'blur' }` — validation fires immediately (no debounce)
   *   when the user tabs away from a registered field. Ignores
   *   `debounceMs`.
   * - `{ on: 'none' }` — explicit opt-out. `handleSubmit` and
   *   explicit `validate()` / `validateAsync()` calls are the only
   *   validation surface; per-keystroke / per-blur runs are disabled.
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

  /**
   * Opt-in undo/redo stack. `true` uses the default max of 50
   * snapshots; pass `{ max: N }` to tune. Off by default.
   *
   * Each mutation through `setValueAtPath` / `applyFormReplacement`
   * / field-array helpers pushes a snapshot onto the undo stack.
   * `undo()` pops one; `redo()` replays it. The stack is trimmed
   * FIFO when it exceeds `max`. `reset()` clears the history.
   */
  history?: HistoryConfig
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
  /**
   * Optimistic SSR-only mark. Called by the `vRegisterHint` template
   * transform's wrapping IIFE so that any field bound to `v-register`
   * starts life with `isConnected: true` server-side, preventing the
   * `false → true` flicker that would otherwise show up when the
   * directive's `created` hook (skipped during SSR) finally runs on
   * hydration. No-op on the client; see `FormStore.markConnectedOptimistically`.
   */
  markConnectedOptimistically: () => void
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

/**
 * Reactive per-field error store, keyed by `path.join('.')`. Exposed
 * as `FormFieldErrors<Form>` on the `useForm` return so consumers get
 * dot-access for known schema paths; the broader `FormErrorRecord`
 * type still types the underlying store / SSR-serialisation shape.
 */
export type FormErrorRecord = Record<string, ValidationError[]>
export type FormErrorStore = Map<FormKey, FormErrorRecord>

/**
 * Form-aware view of `fieldErrors`. A mapped type over the form's own
 * `FlatPath<Form>` union, so `fieldErrors.email` (dot access) works
 * for a form declaring `email` as a leaf. Dotted nested paths
 * (`'user.profile.email'`) are still present as keys — access those
 * via bracket notation because JS dot-access splits on literal dots.
 *
 * Server errors landing on paths outside the schema (rare, usually a
 * bug in the server's error shape) can be read via a cast to
 * `FormErrorRecord`.
 */
export type FormFieldErrors<Form extends GenericForm> = Partial<
  Record<FlatPath<Form>, ValidationError[]>
>

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

/**
 * Bundle of form-level reactive flags and counters returned as `state`
 * on `useForm()`. Separate from per-field state (reached via
 * `getFieldState(path)`) — this is the aggregate view.
 *
 * Internally backed by Vue's `reactive()` + `readonly()`:
 *   - Refs inside a reactive object auto-unwrap at property access, so
 *     `form.state.isSubmitting` returns `boolean`, not `Ref<boolean>`.
 *     Templates bind to primitives directly — no nested-ref footgun.
 *   - `readonly()` rejects writes at runtime and emits a dev-mode warning.
 *   - Reactivity tracking still flows through the underlying ComputedRefs,
 *     so `watch(() => form.state.isSubmitting, …)` fires on change.
 *   - Destructuring (`const { isSubmitting } = form.state`) is a one-shot
 *     snapshot — standard reactive() caveat. Use `toRefs()` if you need
 *     individually-reactive handles.
 *
 * The history fields (`canUndo` / `canRedo` / `historySize`) are always
 * present regardless of whether `history` is configured on `useForm`.
 * When history is disabled they resolve to `false` / `0`.
 */
export interface FormState {
  /**
   * `true` when any tracked leaf's current value differs from the value it
   * was initialised with. Returns `false` for a pristine form and for one
   * where every mutation has been undone back to its original.
   *
   * Comparisons use `Object.is`; object/array leaves are reference-compared,
   * so structural equality after a replace-with-equal-copy will still read
   * as dirty. Reset via `reset()` to restore the pristine baseline.
   */
  readonly isDirty: boolean

  /**
   * `true` when the form has no recorded errors. Driven by the same error
   * store `fieldErrors` exposes — a successful `validate()` / `handleSubmit`
   * run clears errors and flips this to true; a failed run populates them
   * and flips to false.
   */
  readonly isValid: boolean

  /**
   * `true` while a submit handler produced by `handleSubmit` is executing.
   * Flips on entry to the handler and off in a `finally` block — covers
   * both the validation phase and the user's async callback.
   */
  readonly isSubmitting: boolean

  /**
   * `true` while any validation run (reactive `validate()` re-run,
   * imperative `validateAsync(...)`, or the pre-submit validation inside
   * `handleSubmit`) is in flight. Drops back to `false` when every
   * in-flight run has settled.
   */
  readonly isValidating: boolean

  /**
   * Increments once per call to a submit handler, regardless of outcome
   * (validation failure, callback success, callback throw). Counts "how
   * many times did the user click submit", not "how many succeeded".
   */
  readonly submitCount: number

  /**
   * Captures whatever the user's submit callback (or its `onError` handler)
   * threw or rejected with. Cleared to `null` at the start of each new
   * submission attempt; stays `null` on successful completion.
   *
   * The handler still re-throws — `submitError` is the reactive mirror for
   * template consumers; imperative callers can use `try { await
   * handler(event) }` as normal.
   */
  readonly submitError: unknown

  /** `true` when the undo stack has at least one restorable snapshot. */
  readonly canUndo: boolean

  /** `true` when a prior `undo()` has pending replays on the redo stack. */
  readonly canRedo: boolean

  /**
   * Total snapshot count across both stacks. Primarily for debug
   * UIs — consumers driving undo/redo UI should use `canUndo` /
   * `canRedo` instead.
   */
  readonly historySize: number
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
   * validation success. Also writable (via the imperative methods below,
   * not via direct mutation) — `setFieldErrors`, `addFieldErrors`,
   * `clearFieldErrors`, `setFieldErrorsFromApi`.
   *
   * Typed as `Readonly<FormFieldErrors<Form>>` — a frozen view over the
   * form's own `FlatPath<Form>` mapped type. Dot access works for known
   * top-level paths (`fieldErrors.email`); bracket access is required
   * for dotted nested keys (`fieldErrors['user.profile.email']`)
   * because JS dot notation splits on literal dots.
   *
   * Internally backed by a `ComputedRef` wrapped in a Proxy:
   *   - **Templates** dot-access directly with no `.value` (the API
   *     object isn't a top-level setup binding, so Vue's auto-unwrap
   *     would not reach a nested ComputedRef otherwise).
   *   - **Readonly** at compile time (the type) and at runtime (Proxy
   *     `set` / `deleteProperty` traps reject writes; assignments fail
   *     silently and emit a dev-mode console warning pointing at the
   *     correct mutator).
   *   - **Reactive**: reads inside a render or `watchEffect` track the
   *     underlying ComputedRef as a dependency, exactly as a direct
   *     `.value` read would. Re-renders fire on error-state changes.
   *   - **Watchable from script** via the getter form:
   *     `watch(() => api.fieldErrors.email, …)`. Direct
   *     `watch(api.fieldErrors, …)` no longer works — `fieldErrors` is
   *     a plain reactive view, not a `Ref`.
   */
  fieldErrors: Readonly<FormFieldErrors<Form>>

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

  // --- Form-level state ---

  /**
   * Bundled reactive flags and counters for the form as a whole — see
   * the `FormState` type for the full shape and per-leaf semantics.
   * Consumers access the leaves directly (e.g. `form.state.isSubmitting`)
   * with no `.value` in scripts or templates.
   *
   * Per-field state (touched / focused / blurred / errors for one path)
   * lives behind `getFieldState(path)`; this `state` is the aggregate
   * view over the whole form.
   */
  state: FormState

  // --- Reset ---

  /**
   * Restore the form to its initial state. With no argument, re-evaluates
   * the schema's defaults. With `nextDefaultValues`, applies those
   * constraints over the schema defaults (same precedence rules as the
   * `useForm({ defaultValues })` option).
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
  reset: (nextDefaultValues?: DeepPartial<Form>) => void

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

  // --- Undo / redo ---

  /**
   * Revert the form to the previous snapshot. Returns `true` when a
   * snapshot was restored, `false` when the undo stack is at its
   * initial state (nothing to undo). Only present when
   * `history` is configured on `useForm`; otherwise a no-op returning
   * `false`.
   */
  undo: () => boolean

  /**
   * Replay a previously-undone snapshot. Returns `true` on success,
   * `false` when the redo stack is empty. Cleared on the next new
   * mutation.
   */
  redo: () => boolean

  // `canUndo`, `canRedo`, and `historySize` live on `state` — see above.

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
