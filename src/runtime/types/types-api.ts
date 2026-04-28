import type { ObjectDirective, Ref } from 'vue'
import type { Path, PathKey } from '../core/paths'
import type { PersistOptInRegistry } from '../core/persistence/opt-in-registry'
import type {
  ArrayItem,
  ArrayPath,
  DeepPartial,
  FlatPath,
  GenericForm,
  IsObjectOrArray,
  NestedReadType,
  NestedType,
  WithIndexedUndefined,
  WriteShape,
} from './types-core'

/**
 * Identifier for a form. A `FormKey` is the string passed via
 * `useForm({ key })`, used to look up a form by name from a distant
 * component, namespace persisted drafts, and label errors and
 * DevTools entries. Anonymous `useForm` calls allocate one
 * automatically; you only need to pick one when the form needs
 * stable identity.
 */
export type FormKey = string

/**
 * One validation failure. `path` points at the offending field as a
 * structured array — `['user', 'address', 0, 'line1']` for a nested
 * field, `[]` for a form-level error. `formKey` identifies which
 * form produced the error so a single error list can be routed to
 * multiple forms.
 *
 * Returned by `validate()` / `validateAsync()` / `handleSubmit`'s
 * `onError` callback, and by `parseApiErrors` for server responses.
 */
export type ValidationError = {
  /** Human-readable message describing the failure. */
  message: string
  /** Structured path of the offending field. Empty array means a form-level error. */
  path: (string | number)[]
  /** Identifies which form produced this error. */
  formKey: FormKey
}

/** Settled validation result when the form (or subtree) parsed successfully. */
export type ValidationResponseSuccess<TData> = {
  /** The parsed value at the validated subtree (whole form when `validate()` was called without a path). */
  data: TData
  errors: undefined
  success: true
  formKey: FormKey
}
/** Settled validation result when no data could be produced (e.g. a top-level type mismatch). */
export type ValidationResponseErrorWithoutData = {
  data: undefined
  /** Non-empty list of failures. */
  errors: ValidationError[]
  success: false
  formKey: FormKey
}
/** Settled validation result when the parser produced partial data alongside failures. */
export type ValidationResponseErrorWithData<TData> = {
  data: TData
  errors: ValidationError[]
  success: false
  formKey: FormKey
}

/**
 * Settled validation result. Discriminate on `success`:
 *
 * ```ts
 * if (result.success) {
 *   // result.data is the parsed value, errors is undefined
 * } else {
 *   // result.errors is non-empty, data may or may not be set
 * }
 * ```
 */
export type ValidationResponse<TData> =
  | ValidationResponseSuccess<TData>
  | ValidationResponseErrorWithData<TData>
  | ValidationResponseErrorWithoutData

/**
 * Result of resolving the form's default values. Always returns at
 * least the shape derived from the schema; `errors` carry any
 * failures from validating those defaults against the schema.
 */
export type DefaultValuesResponse<TData> =
  | ValidationResponseSuccess<TData>
  | ValidationResponseErrorWithData<TData>

/**
 * Trimmed `ValidationResponse` that omits the `data` payload. Used by
 * `validate()` / `validateAsync()` since consumers usually only need
 * the success flag and error list at those entry points.
 */
export type ValidationResponseWithoutValue<Form> = Omit<ValidationResponse<Form>, 'data'>

/**
 * How strictly to validate when deriving default values at construction.
 *
 * - `'strict'` (default): the schema's defaults are validated immediately;
 *   any failures populate `fieldErrors` from the first frame so the data
 *   layer is honest about the schema's verdict. The UI decides when to
 *   *show* errors (gate on `state.touched`, `state.submitCount`, etc.).
 * - `'lax'`: refinements are stripped during default-values derivation
 *   and the construction-time validation is skipped. Useful for multi-step
 *   wizards or forms that intentionally mount with placeholder data.
 *
 * Runtime validation (per-field and on submit) is identical in both modes.
 */
export type ValidationMode = 'strict' | 'lax'

type GetDefaultValuesConfig<Form> = {
  useDefaultSchemaValues: boolean
  validationMode?: ValidationMode
  constraints?: DeepPartial<WriteShape<Form>> | undefined
}

/**
 * The contract a schema adapter implements so the form runtime can
 * read defaults, validate, and walk paths against any underlying
 * schema library.
 *
 * Most consumers never touch this type directly — pass a Zod schema
 * to `useForm` from `@chemical-x/forms/zod` (or `/zod-v3`) and the
 * adapter is wired automatically. Implement this interface only when
 * adding support for a new schema library (Valibot, ArkType, custom).
 */
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
   * Return the schema-prescribed default value at the given path. The
   * runtime uses this to fill structural gaps so every `setValue` write
   * leaves the form satisfying the slim schema (objects/arrays/primitives
   * without refines).
   *
   * Semantics:
   * - **Object property path:** the property's schema default.
   * - **Array element path:** the element default (paths past the
   *   array's current length still resolve — every position resolves
   *   to the same element type).
   * - **Tuple position path:** the position-specific default. Out-of-
   *   range positions return `undefined`.
   * - **Optional/Default/Nullable/Readonly/Catch/Pipe wrappers:** the
   *   inner default.
   * - **Discriminated union:** the first variant's default (matches
   *   `validateAtPath`'s first-success semantic).
   * - **Leaf:** the primitive default (`''`, `0`, `false`, etc., or the
   *   wrapper's `.default(x)` value when present).
   * - **Path doesn't exist in schema:** `undefined`.
   *
   * Adapters may return `undefined` when the path can't be resolved;
   * callers treat that as "don't fill" and fall back to existing data.
   */
  getDefaultAtPath(path: Path): unknown
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
  /**
   * Sync sister to `getSchemasAtPath` / `validateAtPath`. Returns the
   * set of primitive `typeof`-style kinds the path's leaf schema
   * accepts at write time. Wrappers (`.optional`, `.nullable`,
   * `.default`, `.refine`, `.transform`, `.pipe`, `.readonly`,
   * `.catch`, `.lazy`) are peeled; refinement-level constraints
   * (`.email()`, `.min(N)`, enum membership, literal equality, regex)
   * are IGNORED — they're a validation-time concern.
   *
   * Used by `setValueAtPath` to gate writes synchronously without
   * round-tripping through async `validateAtPath`. The returned set
   * unions across union branches and intersects across intersection
   * sides.
   *
   * Conventions:
   * - Empty set → permissive ("unknown / unconstrained"). The runtime
   *   gate treats this as "accept anything." Surfaces for `z.any()` /
   *   `z.unknown()` / `z.never()` and the lazy-peel-failure case.
   * - For `z.enum(['a','b'])` (string entries): returns `{'string'}`.
   *   For numeric enums: `{'number'}`.
   * - For `z.literal(x)`: returns `{primitiveKindOf(x)}`.
   * - For `z.object(...)`: `{'object'}`. For `z.array(...)`: `{'array'}`.
   *   The runtime walker recurses into entries / elements at write time.
   * - For nullable / optional wrappers: adds `'null'` / `'undefined'`
   *   to the inner's set.
   */
  getSlimPrimitiveTypesAtPath(path: Path): Set<SlimPrimitiveKind>
  /**
   * Return `true` if the leaf at `path` is required — i.e. the schema
   * does NOT admit "empty" via `.optional()`, `.nullable()`,
   * `.default(N)`, or `.catch(N)` at the leaf or any wrapper.
   *
   * Used by the submit / validate path to surface a "Required" error
   * when a field is in the form's `transientEmptyPaths` set (the user
   * cleared it or never answered) AND the schema treats the field as
   * required. Without this, a strict `z.number()` would silently
   * accept the slim default (`0`) for an unanswered field — the
   * "public-housing" footgun where `$0 income` passes validation.
   *
   * Semantics:
   * - **Optional / Nullable / Default / Catch** at any wrapper layer
   *   (root or nested) → `false`. The schema author opted into
   *   accepting empty.
   * - **Readonly / Pipe / Lazy** wrappers are transparent — peel and
   *   re-check the inner schema.
   * - **Union / Discriminated union** → `false` if ANY branch admits
   *   empty (the union accepts what the most permissive branch
   *   accepts). This matches the parse-time "first success wins"
   *   semantic of `validateAtPath`.
   * - **Intersection** → `true` if EITHER side requires the path
   *   (intersection requires both sides to accept; if one rejects
   *   empty, the intersection rejects empty).
   * - **Path doesn't exist in schema** → `false` (can't enforce
   *   what we don't know about).
   * - **Empty path (root)** → `true` (the root form is always
   *   required as an object).
   *
   * Refinement-level constraints (`.min(1)`, `.refine(...)`,
   * `.email()`) are NOT consulted here — those run at parse time
   * inside `validateAtPath` and surface as schema errors regardless.
   * `isRequiredAtPath` only answers the "is this leaf at all
   * required?" question; the refinements layer on top.
   */
  isRequiredAtPath(path: Path): boolean
}

/**
 * The set of primitive "kinds" the slim-primitive write contract
 * recognises. Drawn from `typeof` plus a few well-known reference
 * shapes (`Date`, `Array`, `Map`, `Set`, plain `object`, `null`).
 *
 * The runtime gate's `slimKindOf(value)` returns one of these for a
 * value; the adapter's `getSlimPrimitiveTypesAtPath(path)` returns
 * the set of kinds the path's leaf schema accepts. A write is gated
 * by `accepted.has(slimKindOf(value))`.
 */
export type SlimPrimitiveKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'bigint'
  | 'date'
  | 'null'
  | 'undefined'
  | 'object'
  | 'array'
  | 'symbol'
  | 'function'
  | 'map'
  | 'set'

/**
 * The "no result yet" status returned by the reactive `validate()` ref
 * while a validation run is in flight.
 *
 * Narrow against `pending` to access the settled fields:
 *
 * ```ts
 * const status = form.validate()
 * watchEffect(() => {
 *   if (status.value.pending) return
 *   // status.value.success / status.value.errors are now safe to read
 * })
 * ```
 */
export type PendingValidationStatus = {
  readonly pending: true
  readonly errors: undefined
  readonly success: false
  readonly formKey: FormKey
}

/** Settled status of a reactive `validate()` call. Mirrors the latest result. */
export type SettledValidationStatus<Form> = {
  readonly pending: false
} & ValidationResponseWithoutValue<Form>

/**
 * The value type of the ref returned by `validate()`. Discriminate on
 * `pending` to switch between in-flight and settled states.
 */
export type ReactiveValidationStatus<Form> = PendingValidationStatus | SettledValidationStatus<Form>

/**
 * What to do when a submit attempt fails validation. The library can
 * focus and/or scroll the first errored field into view without
 * wiring an `onError` callback yourself. Off by default.
 *
 * - `'none'` (default): no automatic UI nudge.
 * - `'focus-first-error'`: focus the first errored field's first
 *   visible element (with `preventScroll: true` so it doesn't fight
 *   any `'scroll-to-first-error'` choice you make).
 * - `'scroll-to-first-error'`: scroll that element into view.
 * - `'both'`: scroll first, then focus.
 *
 * If no errored field has a currently mounted, visible element, the
 * policy silently no-ops.
 */
export type OnInvalidSubmitPolicy = 'none' | 'focus-first-error' | 'scroll-to-first-error' | 'both'

/**
 * When per-field validation runs between submit attempts.
 *
 * - `'change'` (default): every keystroke / write schedules a
 *   debounced validation for the affected path. Errors track the
 *   live value continuously so the UI can show inline feedback
 *   without waiting for submit.
 * - `'blur'`: validate immediately when the user tabs away from a
 *   registered field. No debounce.
 * - `'none'`: opt out entirely. `handleSubmit` and explicit
 *   `validate()` / `validateAsync()` calls are the only validation
 *   surfaces.
 */
export type FieldValidationMode = 'change' | 'blur' | 'none'

/** Per-field validation configuration passed via `useForm({ fieldValidation })`. */
export type FieldValidationConfig = {
  /** When validation runs. Default `'change'`. */
  on?: FieldValidationMode
  /**
   * Debounce window in milliseconds for `on: 'change'`. Ignored when
   * `on` is `'blur'` or `'none'`. Default `125`.
   */
  debounceMs?: number
}

/**
 * Built-in storage backends:
 *
 * - `'local'` — browser `localStorage` (persists across tabs and reloads).
 * - `'session'` — browser `sessionStorage` (cleared when the tab closes).
 * - `'indexeddb'` — IndexedDB via a zero-dependency wrapper (handles
 *   structured-cloneable data; suitable for larger drafts).
 *
 * For anything else (encrypted storage, a native bridge, a cookie
 * store) pass a custom `FormStorage` object instead.
 */
export type FormStorageKind = 'local' | 'session' | 'indexeddb'

/**
 * Custom persistence backend. Implement this when none of the built-in
 * `'local'` / `'session'` / `'indexeddb'` backends fit (e.g. encrypted
 * storage, a cross-window broadcast layer, or a native mobile bridge).
 *
 * All methods are async. Pass values through unchanged — `getItem`
 * should return whatever `setItem` was given, including non-string
 * values. The library handles serialization for the built-in
 * `'local'` / `'session'` backends; custom adapters can store the
 * value directly if their backing store accepts structured data.
 *
 * `listKeys(prefix)` returns every key starting with `prefix`. The
 * library uses it on mount to clean up entries left over from older
 * schema versions (each persisted entry carries a schema fingerprint
 * suffix; mismatched entries are dropped automatically).
 */
export type FormStorage = {
  /** Fetch the value previously stored under `key`. Resolve to `null`/`undefined` for misses. */
  getItem(key: string): Promise<unknown>
  /** Persist `value` under `key`. */
  setItem(key: string, value: unknown): Promise<void>
  /** Remove the entry at `key`. No-op if not present. */
  removeItem(key: string): Promise<void>
  /** Return every key in this backend whose name starts with `prefix`. */
  listKeys(prefix: string): Promise<string[]>
}

/**
 * What to include when persisting:
 *
 * - `'form'` (default) — only the form value. Errors get repopulated
 *   by validation on reload anyway.
 * - `'form+errors'` — also persist the current error list. Useful when
 *   the error context is expensive to recompute (e.g. cross-field
 *   refinements that depend on server data).
 */
export type PersistIncludeMode = 'form' | 'form+errors'

/**
 * Per-write metadata. Used internally to flag which writes should
 * reach the persistence layer (e.g. only writes from elements opted
 * into persistence via `register(path, { persist: true })`).
 *
 * Custom directive integrations may set `persist: true` to forward
 * a write to the configured storage adapter; otherwise leave unset.
 */
export type WriteMeta = {
  /** When `true`, this write is forwarded to the configured persistence backend. */
  readonly persist?: boolean
  /**
   * When `true`, the path being written is added to the FormStore's
   * `transientEmptyPaths` set — meaning storage holds a real, schema-
   * conformant value (the slim default) but the UI should display the
   * field as empty. The next write to that path WITHOUT this flag
   * implicitly removes the path from the set (the user typed something
   * real). Internal — set by `markTransientEmpty()` on the register
   * binding and by the `unset` translation in `setValue` / `reset` /
   * `useAbstractForm` construction. Don't set from consumer code.
   */
  readonly transientEmpty?: boolean
}

/**
 * Undo/redo configuration passed via `useForm({ history })`.
 *
 * - `true` — enable with the default snapshot cap (`max: 50`).
 * - `{ max }` — enable and tune the bounded snapshot stack size.
 *
 * When enabled, every mutation pushes a snapshot; `undo()` /
 * `redo()` walk the stacks. `reset()` clears history.
 */
export type HistoryConfig = true | { max?: number }

/**
 * Full options bag for `useForm({ persist })`. Use this when you need
 * to override defaults beyond picking the backend.
 *
 * For backend-only setup, the shorthand forms are equivalent:
 *
 * ```ts
 * useForm({ persist: 'local' })
 * // same as
 * useForm({ persist: { storage: 'local' } })
 * ```
 */
export type PersistConfigOptions = {
  /**
   * Where to persist. Pass `'local'` / `'session'` / `'indexeddb'` to
   * use a built-in backend, or a custom `FormStorage` object for
   * anything else. The built-in backends are loaded on demand, so
   * picking `'local'` doesn't pull in IndexedDB code.
   */
  storage: FormStorageKind | FormStorage

  /**
   * Storage key namespace. Defaults to `chemical-x-forms:${formKey}`.
   * Override when you need a custom prefix (e.g. multi-tenant apps
   * where the same form key may exist per-tenant).
   */
  key?: string

  /** How long to wait after the last mutation before writing. Default `300` ms. */
  debounceMs?: number

  /**
   * What to persist. `'form'` (default) is sufficient for most cases —
   * fresh validation on reload repopulates errors. Pick `'form+errors'`
   * when the error state is expensive to recompute (e.g. server-side
   * cross-field validation).
   */
  include?: PersistIncludeMode

  /**
   * When `true` (default), the persisted entry is wiped after
   * `handleSubmit`'s submit callback resolves successfully. Set to
   * `false` if you need the draft to survive across submissions.
   */
  clearOnSubmitSuccess?: boolean
}

/**
 * Persistence configuration for `useForm({ persist })`. Off by default —
 * with no config, the form does no reads, no writes, and pulls in no
 * storage code.
 *
 * Three input forms; pick the one that reads best at the call site:
 *
 * ```ts
 * // shorthand: built-in backend
 * useForm({ persist: 'local' })
 *
 * // shorthand: custom adapter
 * useForm({ persist: encryptedStorage })
 *
 * // full options bag
 * useForm({ persist: { storage: 'local', debounceMs: 500 } })
 * ```
 *
 * Per-field opt-in: setting `persist` is necessary but not sufficient.
 * Each field that should actually persist also needs
 * `register('foo', { persist: true })` — sensitive fields must opt in
 * explicitly so they don't accidentally land in client-side storage.
 */
export type PersistConfig = FormStorageKind | FormStorage | PersistConfigOptions

/**
 * Configuration object passed to `useForm`. All fields except `schema`
 * are optional.
 *
 * ```ts
 * const form = useForm({
 *   schema: z.object({ email: z.string().email() }),
 *   defaultValues: { email: '' },
 *   fieldValidation: { on: 'change', debounceMs: 200 },
 *   persist: 'local',
 * })
 * ```
 */
export type UseFormConfiguration<
  Form extends GenericForm,
  GetValueFormType,
  Schema extends AbstractSchema<Form, GetValueFormType>,
  DefaultValues extends DeepPartial<WriteShape<Form>>,
> = {
  /**
   * The schema describing the form's shape and validation rules.
   * Pass a Zod schema directly when using `@chemical-x/forms/zod` or
   * `@chemical-x/forms/zod-v3`; the abstract entry point accepts any
   * adapter that implements `AbstractSchema`.
   *
   * For schemas that depend on the form's identity, pass a factory
   * `(key) => schema` instead — the library calls it once per form.
   */
  schema: Schema | ((key: FormKey) => Schema)
  /**
   * Optional identifier for this form. Omit for one-off forms; the
   * library allocates a unique key automatically (SSR-safe, stable
   * across server→client hydration).
   *
   * Pass a string key when the form needs identity:
   * - to look it up from a distant component via `useFormContext(key)`;
   * - to share state across components (multiple `useForm({ key })`
   *   calls with the same key resolve to the same form);
   * - to give DevTools and validation errors a recognisable label;
   * - to namespace persisted drafts.
   *
   * Keys starting with `__cx:` are reserved for internal use and
   * throw `ReservedFormKeyError` if passed.
   */
  key?: FormKey
  /**
   * Initial values applied over the schema's defaults. Each field
   * falls back to the schema default (or the primitive default for
   * the slot's type) when not provided here.
   *
   * Values must satisfy the slim primitive type at each path
   * (string / number / boolean / Date / etc.) but do NOT have to
   * satisfy refinements (`.email()`, enum membership, `.min(N)`).
   * Refinement-invalid defaults pass through and surface as field
   * errors — this lets you rehydrate stale saved data without losing
   * the user's input.
   */
  defaultValues?: DefaultValues
  /**
   * How strictly to validate default values at construction.
   *
   * - `'strict'` (default): the schema is run against the derived
   *   defaults immediately; any failures populate `fieldErrors` from
   *   the first frame. The UI decides when to *show* errors — gate
   *   on `state.touched`, `state.submitCount`, etc.
   * - `'lax'`: refinements are stripped during defaults derivation
   *   and construction-time validation is skipped. Useful for
   *   multi-step wizards, field arrays seeded with placeholder
   *   rows, or any form intentionally mounting with incomplete data.
   *
   * Runtime validation (per-field on edit, full-form on submit) is
   * identical in both modes.
   */
  validationMode?: ValidationMode
  /**
   * Automatic UI nudge on submit-validation failure. Fires after
   * errors are populated and before your `onError` callback runs.
   * Default `'none'`.
   *
   * - `'focus-first-error'`: focus the first errored field's first
   *   visible element (without scrolling).
   * - `'scroll-to-first-error'`: scroll it into view.
   * - `'both'`: scroll, then focus.
   *
   * If no errored field has a currently-mounted, visible element,
   * the policy silently no-ops.
   */
  onInvalidSubmit?: OnInvalidSubmitPolicy

  /**
   * When per-field validation runs between submit attempts. Default
   * `{ on: 'change', debounceMs: 125 }` — errors track the live
   * value continuously.
   *
   * - `{ on: 'change', debounceMs }` — schedule validation after the
   *   user stops typing. Rapid successive edits reset the timer;
   *   stale in-flight runs are cancelled.
   * - `{ on: 'blur' }` — validate immediately when the user tabs
   *   away from the field. Ignores `debounceMs`.
   * - `{ on: 'none' }` — opt out. `handleSubmit` and explicit
   *   `validate*()` calls are the only validation surfaces.
   *
   * Field validation always defers to `handleSubmit`'s full-form
   * run on submit — the submit result is authoritative.
   */
  fieldValidation?: FieldValidationConfig

  /**
   * Opt-in persistence of the form's draft state. Off by default —
   * with no config, no reads, no writes, no storage code is loaded.
   *
   * Three input forms; pick the one that reads best:
   *
   * ```ts
   * useForm({ persist: 'local' })            // built-in backend
   * useForm({ persist: encryptedStorage })   // custom backend
   * useForm({ persist: { storage: 'local', debounceMs: 500 } })
   * ```
   *
   * Per-field opt-in is required: every field that should actually
   * persist needs `register(path, { persist: true })`. Without any
   * opt-ins, the form mounts but never writes to storage — and a
   * dev-mode warning surfaces the misconfiguration. This guard
   * prevents sensitive fields from accidentally leaking to
   * client-side storage.
   *
   * Switching backends across reloads (e.g. `'local'` → `'session'`)
   * automatically clears the previous backend's entry so old drafts
   * don't orphan.
   */
  persist?: PersistConfig

  /**
   * Opt-in undo/redo. Off by default. `true` enables with a 50-snapshot
   * cap; `{ max: N }` tunes the cap.
   *
   * Every mutation pushes a snapshot. `undo()` pops one; `redo()`
   * replays it. `reset()` clears history. Reactive flags
   * `state.canUndo` / `state.canRedo` / `state.historySize` reflect
   * the current stack.
   */
  history?: HistoryConfig
}

/**
 * App-level defaults applied to every `useForm` call. Set these once
 * per app via `createChemicalXForms({ defaults })` (bare Vue) or
 * `chemicalX.defaults` (Nuxt module).
 *
 * Resolution order (per-form wins):
 *
 *   useForm({ ... })  >  createChemicalXForms({ defaults })  >  library default
 *
 * `fieldValidation` shallow-merges so you can set `debounceMs`
 * globally and still override `on` per form:
 *
 * ```ts
 * createChemicalXForms({
 *   defaults: { fieldValidation: { debounceMs: 100 } },
 * })
 * // later
 * useForm({ schema, fieldValidation: { on: 'blur' } })
 * // → { on: 'blur', debounceMs: 100 }
 * ```
 *
 * `schema`, `key`, `defaultValues`, and `persist` are not configurable
 * here — they belong on the per-form call.
 */
export type ChemicalXFormsDefaults = {
  /** Default for `useForm({ validationMode })`. */
  validationMode?: ValidationMode
  /** Default for `useForm({ onInvalidSubmit })`. */
  onInvalidSubmit?: OnInvalidSubmitPolicy
  /** Default (shallow-merged) for `useForm({ fieldValidation })`. */
  fieldValidation?: FieldValidationConfig
  /** Default for `useForm({ history })`. */
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

/**
 * Callback invoked by `handleSubmit` after the form parses successfully.
 * Receives the strictly-typed parsed value — refinements have run, so
 * enum / literal / `.email()` constraints are honoured.
 */
export type OnSubmit<Form extends GenericForm> = (form: Form) => void | Promise<void>

/**
 * Callback invoked by `handleSubmit` when validation fails. Receives
 * the full list of errors. Bind this when you want to react to
 * submit failures explicitly (alongside or instead of the
 * automatic `onInvalidSubmit` UI nudge).
 */
export type OnError = (error: ValidationError[]) => void | Promise<void>

/**
 * Submit handler returned by `handleSubmit(onSubmit, onError)`. Bind
 * it to a `<form>`:
 *
 * ```vue
 * <form @submit.prevent="onSubmit">…</form>
 * ```
 *
 * It optionally accepts the originating `Event` so it can sit on
 * `@submit` directly (without `.prevent` if you want to call
 * `event.preventDefault()` yourself).
 */
export type SubmitHandler = (event?: Event) => Promise<void>

/**
 * Type of `form.handleSubmit`. Pass an `onSubmit` callback for the
 * happy path and (optionally) an `onError` callback that receives
 * the validation errors when parsing fails.
 *
 * ```ts
 * const onSubmit = form.handleSubmit(
 *   (data) => api.signup(data),
 *   (errors) => console.log(errors),
 * )
 * ```
 */
export type HandleSubmit<Form extends GenericForm> = (
  onSubmit: OnSubmit<Form>,
  onError?: OnError
) => SubmitHandler

/**
 * Per-leaf metadata tracked alongside a field's value. Returned by
 * `getValue({ withMeta: true })` and via `getFieldState(path).meta`.
 *
 * - `updatedAt` — ISO timestamp of the most recent write at this path,
 *   or `null` if the field has never been written.
 * - `rawValue` — the value as it arrived (before any transform);
 *   useful for distinguishing parse-coerced reads from raw user input.
 * - `isConnected` — whether at least one DOM element bound to this
 *   path is currently mounted. Flips to `false` when every binding
 *   unmounts.
 * - `formKey` — identifier of the form this metadata belongs to.
 * - `path` — dotted-string path to this leaf, or `null` when not applicable.
 */
export type MetaTrackerValue = {
  /** ISO timestamp of the most recent write at this path. `null` if never written. */
  updatedAt: string | null
  /** Value as it arrived, before any transforms. */
  rawValue: unknown
  /** `true` while at least one binding to this path is currently mounted. */
  isConnected: boolean
  /** Form this metadata belongs to. */
  formKey: FormKey
  /** Dotted-string path to this leaf. */
  path: string | null
}
export type MetaTracker = Record<string, MetaTrackerValue>
export type MetaTrackerStore = Map<FormKey, MetaTracker>

/**
 * Options for the `getValue(...)` overloads that opt into metadata.
 *
 * ```ts
 * const view = form.getValue({ withMeta: true })
 * view.currentValue.value // the form value
 * view.meta.value         // per-leaf metadata
 * ```
 */
export type CurrentValueContext<WithMeta extends boolean = false> = {
  /** Set to `true` to receive both the value ref and a per-leaf metadata ref. */
  withMeta?: WithMeta
}

type RemapLeafNodes<T, V, Q = NonNullable<T>> =
  Q extends Record<string, unknown>
    ? { [K in keyof Q]: RemapLeafNodes<Q[K], V> }
    : Q extends Array<infer U>
      ? Array<RemapLeafNodes<U, V>>
      : V

/**
 * Return value of `getValue({ withMeta: true })` and
 * `getValue(path, { withMeta: true })`.
 *
 * `currentValue` carries the live reactive value at the requested
 * scope; `meta` carries a parallel tree where each leaf is the
 * `MetaTrackerValue` for the corresponding field.
 */
export type CurrentValueWithContext<Value, FormSubtree = Value> = {
  /** Live reactive value at the requested scope. */
  currentValue: Readonly<Ref<Value>>
  /** Parallel metadata tree — leaves are `MetaTrackerValue` records. */
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

/**
 * Options for `register(path, options)`. Per-field rather than
 * per-form so each persisted path is opted in at its own call site —
 * adding a new field can't accidentally leak into the persistence
 * pipeline unless the field's `register` call says so explicitly.
 */
export type RegisterOptions = {
  /**
   * Opt this field into the form's persistence pipeline. The form
   * also needs `useForm({ persist })` configured for any storage
   * activity to happen.
   *
   * Persistence follows the field's lifecycle: writes flow on
   * mount, the field is dropped from the persisted draft on unmount.
   * If multiple inputs bind to the same path, the path keeps
   * persisting as long as any opted-in input is mounted.
   *
   * Throws `SensitivePersistFieldError` when the path looks
   * sensitive (password / cvv / ssn / token / etc.) unless
   * `acknowledgeSensitive: true` is also set.
   */
  persist?: boolean
  /**
   * Suppress the sensitive-name guard. Required to persist any path
   * whose name matches the heuristic (password, cvv, ssn, etc.).
   * Treat this as a code-review checkpoint: setting it should be a
   * deliberate decision that the path's data is safe to land in
   * client-side storage for this user's session.
   */
  acknowledgeSensitive?: boolean
}

/**
 * The object returned by `form.register(path)`. Pass it to a native
 * input via `v-register`:
 *
 * ```vue
 * <input v-register="form.register('email')" />
 * ```
 *
 * Or read `innerRef` directly when integrating with custom components.
 *
 * The remaining fields support advanced bindings (custom assigners,
 * SSR optimistic marking, persistence opt-ins). Most consumers only
 * touch `innerRef`.
 */
export type RegisterValue<Value = unknown> = {
  /**
   * Live, read-only reactive value at this path. Watch it to drive
   * UI that depends on the field's current value.
   */
  innerRef: Readonly<Ref<Value>>
  /**
   * Attach an HTML element to this binding. Called by `v-register`
   * automatically; expose it to custom integrations that need to
   * register an element manually.
   */
  registerElement: (el: HTMLElement) => void
  /**
   * Detach an HTML element from this binding. Pair with
   * `registerElement` for custom integrations.
   */
  deregisterElement: (el: HTMLElement) => void
  /**
   * Write the field's value programmatically. Returns `true` when the
   * write was accepted, `false` when it was rejected (e.g. wrong
   * primitive type for the path). The optional `meta` lets custom
   * directives signal whether the write should be persisted.
   */
  setValueWithInternalPath: (value: unknown, meta?: WriteMeta) => boolean
  /**
   * Mark this field as DOM-connected during SSR so a server-rendered
   * template that reads `getFieldState(path).isConnected` doesn't
   * flicker on hydration. The `v-register` directive calls this for
   * you; no-op on the client.
   * @internal
   */
  markConnectedOptimistically: () => void
  /**
   * Canonical path key. Used by directive integrations.
   * @internal
   */
  path: PathKey
  /**
   * Whether this binding opted into persistence via `register(path, { persist: true })`.
   * @internal
   */
  persist: boolean
  /**
   * Whether this binding acknowledged a sensitive-name override.
   * @internal
   */
  acknowledgeSensitive: boolean
  /**
   * Per-element persistence opt-in registry. Used by directive integrations.
   * @internal
   */
  persistOptIns: PersistOptInRegistry
  /**
   * Read-only, string-form view of the field's current value — what
   * the compile-time `:value` injection reads on every input /
   * textarea / select bound by `v-register`.
   *
   * Returns `''` when the path is in the form's `transientEmptyPaths`
   * set OR storage is `null` / `undefined`; otherwise stringifies
   * the storage value via `String(...)`. The transient-empty branch
   * lets the user clear a numeric field without the next Vue render
   * patching `el.value` back to `'0'` (the slim default).
   */
  displayValue: Readonly<Ref<string>>
  /**
   * Add this field's path to the form's `transientEmptyPaths` set,
   * writing the slim default to storage. Returns the `setValueAtPath`
   * boolean (`true` accepted, `false` rejected by the slim-primitive
   * gate). Inherits the binding's `persist` meta so the mark rides
   * the same persistence channel as user-typed writes.
   *
   * Called by the directive's input listener on numeric clear (commit
   * 5) and by the imperative `setValue(path, unset)` translation
   * (commit 7). Don't call from consumer code.
   * @internal
   */
  markTransientEmpty: () => boolean
}

/**
 * Custom assigner installed on an element via the directive's
 * `[assignKey]` slot. Called by the directive when a DOM event
 * (input / change / etc.) fires on the bound element.
 *
 * Return `true` when the write was accepted, `false` when it was
 * rejected (e.g. the value didn't match the path's expected type).
 * `undefined` is treated as "succeeded" so simple assigners can
 * just return `void`.
 */
export type CustomDirectiveRegisterAssignerFn = (value: unknown) => boolean | undefined
/**
 * Generic shape of a v-register directive variant. Used by the
 * library's text / checkbox / radio / select directive types and
 * available for custom integrations that need to drop in their own
 * variant.
 *
 * The value generic admits `undefined` because `useRegister()` may
 * return `undefined` (a wrapper component rendered without a parent
 * `registerValue`); binding that value to `v-register` is supported
 * and installs a no-op assigner at runtime.
 */
export type CustomRegisterDirective<T, Modifiers extends string = string> = ObjectDirective<
  T & {
    _assigning?: boolean
    [S: symbol]: CustomDirectiveRegisterAssignerFn
  },
  RegisterValue | undefined,
  Modifiers,
  string
>

/**
 * Modifier names supported by `v-register` on `<input type="text">`,
 * `<input type="number">`, and `<textarea>`. Mirrors Vue's
 * `v-model` modifier semantics on the same elements; combine freely
 * (`<input v-register.lazy.trim.number="..." />`).
 */
export type RegisterTextModifier =
  /**
   * Write on `change` (blur) instead of `input`. The reactive
   * model only updates after the user tabs/clicks out of the
   * field. IME composition handlers are skipped under `.lazy` —
   * composition events do not gate writes.
   */
  | 'lazy'
  /**
   * Strip leading and trailing whitespace on blur. The form holds
   * the user's raw input (whitespace included) while they're
   * typing; on `change` (blur / commit) the value is trimmed
   * once and written back to both the model and the visible DOM.
   * Combine with `.lazy` to skip the mid-typing writes entirely.
   */
  | 'trim'
  /**
   * Cast the value via `parseFloat` before writing. Values that
   * can't be parsed as a number (e.g. `'abc'`) pass through
   * unchanged — the slim-primitive gate then sees a string
   * heading to a numeric slot and rejects the write. Auto-applied
   * for `<input type="number">`; explicit `.number` is redundant
   * there.
   */
  | 'number'

/**
 * v-register directive variant for `<input type="text">`,
 * `<input type="number">`, and `<textarea>`. Supports the
 * `.lazy`, `.trim`, and `.number` modifiers — see
 * `RegisterTextModifier` for per-modifier semantics.
 */
export type RegisterTextCustomDirective = CustomRegisterDirective<
  HTMLInputElement | HTMLTextAreaElement,
  RegisterTextModifier
>

/** v-register directive variant for checkboxes. No modifiers. */
export type RegisterCheckboxCustomDirective = CustomRegisterDirective<HTMLInputElement>
/** v-register directive variant for radio inputs. No modifiers. */
export type RegisterRadioCustomDirective = CustomRegisterDirective<HTMLInputElement>

/**
 * Modifier name supported by `v-register` on `<select>`. Mirrors
 * Vue's `v-model` `.number` on the same element.
 */
export type RegisterSelectModifier =
  /**
   * Cast each selected option's `value` via `parseFloat` before
   * writing. The form state holds numbers, not numeric strings —
   * useful when option values are written as strings in the
   * markup but the schema expects numbers.
   */
  'number'

/**
 * v-register directive variant for `<select>`. Supports `.number`
 * — see `RegisterSelectModifier` for semantics.
 */
export type RegisterSelectCustomDirective = CustomRegisterDirective<
  HTMLSelectElement,
  RegisterSelectModifier
>

/** v-register directive variant for the dynamic input/select/textarea bridge. */
export type RegisterModelDynamicCustomDirective = ObjectDirective<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  RegisterValue | undefined,
  string
>
/**
 * The `v-register` directive. Binds a form field to a native
 * input, select, textarea, checkbox, or radio:
 *
 * ```vue
 * <input v-register="form.register('email')" />
 * <select v-register="form.register('country')">
 *   <option value="us">US</option>
 *   <option value="uk">UK</option>
 * </select>
 * ```
 *
 * Also works on custom components whose root is NOT a native
 * input — call `useRegister()` in the child's setup to read the
 * parent's binding, then re-bind `v-register` onto an inner native
 * element. (When the wrapper's root IS the input itself, attribute
 * fallthrough handles it; `useRegister` is unnecessary.)
 *
 * ```vue
 * <!-- Parent -->
 * <MyField label="Email" v-register="form.register('email')" />
 *
 * <!-- MyField.vue (root is <label>, not <input>) -->
 * <script setup>
 * import { useRegister } from '@chemical-x/forms'
 * defineProps<{ label: string }>()
 * const register = useRegister()
 * </script>
 * <template>
 *   <label>
 *     <span>{{ label }}</span>
 *     <input v-register="register" />
 *   </label>
 * </template>
 * ```
 *
 * Modifier support varies by element:
 *   - text / number / textarea: `.lazy`, `.trim`, `.number`
 *   - select: `.number`
 *   - checkbox / radio: none
 *
 * See `RegisterTextModifier` / `RegisterSelectModifier` for
 * per-modifier semantics.
 *
 * Registered globally by `createChemicalXForms()` (and by the
 * `@chemical-x/forms/nuxt` module). Most consumers don't import the
 * directive itself — it's exposed for integrations that install
 * directives manually.
 */
export type RegisterDirective =
  | RegisterTextCustomDirective
  | RegisterCheckboxCustomDirective
  | RegisterSelectCustomDirective
  | RegisterRadioCustomDirective
  | RegisterModelDynamicCustomDirective

/**
 * Callback form of `setValue`'s value argument. Receives the previous
 * value at the path and returns the next value:
 *
 * ```ts
 * form.setValue('count', (prev) => prev + 1)
 * form.setValue((prev) => ({ ...prev, name: 'Ada' }))
 * ```
 *
 * The library fills any missing structural slots (e.g. nested
 * objects) against the schema's defaults after the callback returns,
 * so partial returns are safe.
 */
export type SetValueCallback<Read> = (prev: Read) => Read

/**
 * The value argument of `form.setValue`. Either the next value
 * directly, or a callback that derives it from the previous value.
 *
 * Type parameters:
 * - `Write` — what the direct value form accepts (the storable shape
 *   at the path).
 * - `Read` — what the callback's `prev` argument exposes (defaults
 *   to `Write`). For whole-form callbacks the read shape tags
 *   array elements as possibly-undefined to reflect runtime reality.
 */
export type SetValuePayload<Write, Read = Write> = Write | SetValueCallback<Read>

type DeepFlatten<T> =
  // If it's not an object, just leave it as-is
  T extends object
    ? {
        // Re-map every property key of T
        [K in keyof T]: DeepFlatten<T[K]>
      }
    : T
/**
 * Focus / blur / touched flags for a registered field.
 *
 * - `focused` — `true` while the user is interacting with the field;
 *   `false` after blur. `null` until the field has ever been focused.
 * - `blurred` — `true` after the field has lost focus at least once.
 *   `null` before any blur event.
 * - `touched` — flips to `true` on the first blur after a focus and
 *   stays `true` thereafter. Useful for "show errors only after the
 *   user has interacted" UX.
 */
export type DOMFieldState = {
  /** `true` while focused; `false` after blur; `null` before first focus. */
  focused: boolean | null
  /** `true` once the field has lost focus at least once; `null` before. */
  blurred: boolean | null
  /** Flips to `true` on the first blur after a focus and stays there. */
  touched: boolean | null
}
/**
 * Reactive per-field state returned by `form.getFieldState(path)`.
 * Tracks the value at the path along with focus, dirty, and error
 * flags useful for inline validation UI.
 *
 * ```ts
 * const state = form.getFieldState('email')
 * // Then in template:
 * //   <p v-if="state.touched && state.errors.length">{{ state.errors[0].message }}</p>
 * ```
 */
export type FieldState<Value = unknown> = DeepFlatten<
  DOMFieldState & {
    /** Per-field metadata (timestamps, raw value, connection state). */
    meta: MetaTrackerValue
    /**
     * Validation errors for this path. Populated automatically by
     * `handleSubmit` and per-field validation; also writable via
     * `setFieldErrors` / `addFieldErrors`. Empty when valid — safe
     * to read without a null check.
     */
    errors: ValidationError[]
    /** The value the field was initialised with. */
    originalValue: Value
    /** The value before the most recent write. */
    previousValue: Value
    /** The current value at this path. */
    currentValue: Value
    /** `true` when `currentValue` matches `originalValue`. */
    pristine: boolean
    /** `true` when `currentValue` differs from `originalValue`. */
    dirty: boolean
  }
>
export type DOMFieldStateStore = Map<string, DOMFieldState | undefined>

/**
 * Untyped error map keyed by dotted-string path. The same data
 * exposed by `form.fieldErrors`, but as a plain record — useful when
 * routing API errors that may land on paths the form's TypeScript
 * type doesn't know about.
 */
export type FormErrorRecord = Record<string, ValidationError[]>
export type FormErrorStore = Map<FormKey, FormErrorRecord>

/**
 * Type of `form.fieldErrors`. Each known path in the form's schema
 * appears as an optional key whose value is the path's error list.
 *
 * Dot access works for top-level paths:
 *
 * ```ts
 * form.fieldErrors.email // ValidationError[] | undefined
 * ```
 *
 * Use bracket access for nested dotted keys (JS dot syntax splits on
 * literal dots):
 *
 * ```ts
 * form.fieldErrors['user.profile.email']
 * ```
 */
export type FormFieldErrors<Form extends GenericForm> = Partial<
  Record<FlatPath<Form>, ValidationError[]>
>

/**
 * Shape of a server-side error details record. Keys are dotted field
 * paths; values are either a single error message or a list. This is
 * the shape `parseApiErrors` consumes — most DRF / FastAPI / Rails-style
 * APIs return error payloads in this form.
 */
export type ApiErrorDetails = Record<string, string | string[]>

/**
 * Outer envelope `parseApiErrors` accepts. Both the wrapped form
 * (`{ error: { details } }`) and the unwrapped form (`{ details }`)
 * are recognised; raw detail records (`{ email: ['taken'] }`) are
 * also accepted directly.
 */
export type ApiErrorEnvelope = {
  /** Wrapped error envelope — `parseApiErrors` reads `details` from inside. */
  error?: {
    details?: ApiErrorDetails
    [k: string]: unknown
  }
  /** Unwrapped error envelope. */
  details?: ApiErrorDetails
}

/**
 * Reactive form-level flags and counters returned as `form.state`.
 *
 * Read fields directly with no `.value` — they auto-unwrap inside
 * the reactive object:
 *
 * ```vue
 * <button :disabled="form.state.isSubmitting">Save</button>
 * ```
 *
 * Watch a single field via the getter form:
 *
 * ```ts
 * watch(() => form.state.isSubmitting, (value) => …)
 * ```
 *
 * Per-field state (touched, dirty, errors) lives behind
 * `form.getFieldState(path)`; this is the aggregate view across the
 * whole form.
 *
 * Read-only at runtime — assignments throw. Destructuring snapshots
 * the current values; use `toRefs()` if you need reactive handles
 * to individual fields.
 */
export interface FormState {
  /**
   * `true` when any field's current value differs from its initial
   * value. `false` for a pristine form and for one where every change
   * has been undone. Restore the pristine baseline via `reset()`.
   *
   * Note: object/array leaves are compared by reference, so replacing
   * an array with an equal copy still reads as dirty.
   */
  readonly isDirty: boolean

  /**
   * `true` when the form currently has no validation errors. Flips
   * with every `validate()` / `handleSubmit` outcome.
   */
  readonly isValid: boolean

  /**
   * `true` while a `handleSubmit`-produced submit handler is running.
   * Covers both the validation phase and your async submit callback.
   * Useful for disabling the submit button.
   */
  readonly isSubmitting: boolean

  /**
   * `true` while any validation run is in flight (the reactive
   * `validate()` re-run, an imperative `validateAsync()`, or the
   * pre-submit validation inside `handleSubmit`).
   */
  readonly isValidating: boolean

  /**
   * How many times the submit handler has been invoked, regardless of
   * outcome (validation failure, callback success, callback throw).
   * Useful for "show errors after first submit attempt" UX.
   */
  readonly submitCount: number

  /**
   * The error thrown or rejected by the most recent submit callback
   * (or its `onError` handler). Cleared to `null` at the start of
   * each new submission attempt; stays `null` on success.
   *
   * The submit handler still throws normally — this is the reactive
   * mirror for templates. Imperative callers can use
   * `try { await onSubmit() }` instead.
   */
  readonly submitError: unknown

  /** `true` when there is at least one undo step available. Always present (false when history is disabled). */
  readonly canUndo: boolean

  /** `true` when `undo()` has been called and a `redo()` would replay. Always present (false when history is disabled). */
  readonly canRedo: boolean

  /**
   * Total snapshots across the undo and redo stacks. Useful for
   * debug overlays; UI driving undo/redo buttons should gate on
   * `canUndo` / `canRedo` instead.
   */
  readonly historySize: number
}

/**
 * The object returned by `useForm`. Holds every reactive ref, write
 * helper, and lifecycle method bound to one form.
 *
 * ```ts
 * const form = useForm({ schema })
 * form.register('email')      // bind to <input v-register>
 * form.getValue('email')      // Readonly<Ref<string>>
 * form.setValue('email', 'a@b.c')
 * form.handleSubmit(onSubmit) // returns a submit handler
 * form.state.isSubmitting     // reactive flag
 * ```
 */
export type UseAbstractFormReturnType<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
> = {
  /**
   * Reactive per-field state at `path`: `currentValue`, focus/blur
   * flags, dirty/pristine, errors, etc. See `FieldState` for the
   * full shape.
   *
   * ```ts
   * const state = form.getFieldState('email')
   * // <p v-if="state.touched && state.errors.length">…</p>
   * ```
   */
  getFieldState: <Path extends FlatPath<Form, keyof Form, true>>(
    path: Path
  ) => Ref<FieldState<NestedReadType<WriteShape<GetValueFormType>, Path>>>
  /**
   * Wraps your submit logic with validation and error routing.
   *
   * ```ts
   * <form @submit.prevent="form.handleSubmit(
   *   (data) => api.signup(data),
   *   (errors) => console.log(errors),
   * )">
   * ```
   *
   * `data` is the strictly-typed parsed value — refinements have
   * fired, so `data.email` is guaranteed to satisfy `.email()`.
   */
  handleSubmit: HandleSubmit<Form>
  /**
   * Read the form's current value as a reactive ref.
   *
   * - `getValue()` — whole form.
   * - `getValue(path)` — value at `path`.
   * - `getValue({ withMeta: true })` — whole form + a sibling
   *   `meta` ref carrying per-leaf metadata.
   * - `getValue(path, { withMeta: true })` — same, scoped to `path`.
   *
   * ```ts
   * const email = form.getValue('email')      // Readonly<Ref<string>>
   * const all = form.getValue()               // Readonly<Ref<Form>>
   * ```
   *
   * Reads reflect what's storable: enum-typed slots widen to their
   * primitive supertype (e.g. `string`) so refinement-invalid but
   * structurally-valid values are visible. Use `handleSubmit` /
   * `validate*()` when you need the post-validation strict type.
   */
  getValue: {
    /**
     * Read the whole form as a reactive ref.
     *
     * ```ts
     * const all = form.getValue() // Readonly<Ref<Form>>
     * ```
     *
     * Reads reflect what's storable: enum-typed slots widen to their
     * primitive supertype (e.g. `string`) so refinement-invalid but
     * structurally-valid values are visible. Use `handleSubmit` /
     * `validate*()` when you need the post-validation strict type.
     */
    (): Readonly<Ref<WithIndexedUndefined<WriteShape<GetValueFormType>>>>
    /**
     * Read the value at `path` as a reactive ref.
     *
     * ```ts
     * const email = form.getValue('email') // Readonly<Ref<string>>
     * ```
     *
     * Reads reflect what's storable: enum-typed slots widen to their
     * primitive supertype (e.g. `string`) so refinement-invalid but
     * structurally-valid values are visible. Use `handleSubmit` /
     * `validate*()` when you need the post-validation strict type.
     */
    <Path extends FlatPath<Form>>(
      path: Path
    ): Readonly<Ref<NestedReadType<WriteShape<GetValueFormType>, Path>>>
    /**
     * Read the whole form along with per-leaf metadata.
     *
     * ```ts
     * const view = form.getValue({ withMeta: true })
     * view.currentValue.value // the form value
     * view.meta.value         // per-leaf MetaTrackerValue tree
     * ```
     *
     * Pass `{ withMeta: false }` (or omit `withMeta`) for the same
     * shape as `getValue()`.
     */
    <WithMeta extends boolean>(
      context: CurrentValueContext<WithMeta>
    ): WithMeta extends true
      ? CurrentValueWithContext<WithIndexedUndefined<WriteShape<GetValueFormType>>>
      : Readonly<Ref<WithIndexedUndefined<WriteShape<GetValueFormType>>>>
    /**
     * Read the value at `path` along with per-leaf metadata.
     *
     * ```ts
     * const view = form.getValue('email', { withMeta: true })
     * view.currentValue.value // the email value
     * view.meta.value         // metadata for that leaf
     * ```
     *
     * Pass `{ withMeta: false }` (or omit `withMeta`) for the same
     * shape as `getValue(path)`.
     */
    <Path extends FlatPath<Form>, WithMeta extends boolean>(
      path: Path,
      context: CurrentValueContext<WithMeta>
    ): WithMeta extends true
      ? CurrentValueWithContext<NestedReadType<WriteShape<GetValueFormType>, Path>>
      : Readonly<Ref<NestedReadType<WriteShape<GetValueFormType>, Path>>>
  }
  /**
   * Write to the form programmatically. Two forms:
   *
   * - `setValue(value)` — replace the whole form.
   * - `setValue(path, value)` — write at a specific path.
   *
   * Either takes a callback in place of `value` to derive the next
   * value from the previous one:
   *
   * ```ts
   * form.setValue('count', (prev) => prev + 1)
   * form.setValue((prev) => ({ ...prev, name: 'Ada' }))
   * ```
   *
   * Returns `true` when the write is accepted. A `false` return
   * means the value didn't match the slot's expected type
   * (e.g. writing a number to a string field) — the form state
   * stays unchanged. Refinement-level mismatches (out-of-enum
   * values, failing `.email()`, etc.) DO succeed and surface as
   * field errors instead.
   */
  setValue: {
    /**
     * Replace the whole form. Pass a value or a callback receiving
     * the previous form.
     *
     * ```ts
     * form.setValue({ name: 'Ada', email: 'a@b.c' })
     * form.setValue((prev) => ({ ...prev, name: 'Ada' }))
     * ```
     *
     * Returns `true` when the write was accepted, `false` when the
     * value didn't match the expected shape (e.g. wrong primitive
     * type at a leaf). Refinement-level mismatches (out-of-enum
     * values, failing `.email()`, etc.) succeed and surface as
     * field errors instead.
     */
    <Value extends SetValuePayload<WriteShape<Form>, WithIndexedUndefined<WriteShape<Form>>>>(
      value: Value
    ): boolean
    /**
     * Write at a specific path. Pass a value or a callback receiving
     * the previous value at that path.
     *
     * ```ts
     * form.setValue('email', 'a@b.c')
     * form.setValue('count', (prev) => prev + 1)
     * ```
     *
     * Returns `true` when the write was accepted, `false` when the
     * value didn't match the slot's expected primitive type.
     * Refinement-level mismatches succeed and surface as field
     * errors.
     */
    <
      Path extends FlatPath<Form>,
      Value extends SetValuePayload<
        WriteShape<NestedType<Form, Path>>,
        NonNullable<WriteShape<NestedType<Form, Path>>>
      >,
    >(
      path: Path,
      value: Value
    ): boolean
  }

  /**
   * Reactive validation status. Re-runs whenever the form (or the
   * subtree at `path`) mutates. The returned ref carries a `pending`
   * flag — gate on `!status.value.pending` before reading
   * `success` / `errors`.
   *
   * ```ts
   * const status = form.validate()
   * watchEffect(() => {
   *   if (status.value.pending) return
   *   if (!status.value.success) console.log(status.value.errors)
   * })
   * ```
   *
   * Stale in-flight runs are dropped automatically — the ref only
   * settles to results from the most recent call.
   */
  validate: (path?: FlatPath<Form>) => Readonly<Ref<ReactiveValidationStatus<Form>>>

  /**
   * Run validation once and return the result. Unlike `validate()`,
   * this does not subscribe to form reactivity.
   *
   * ```ts
   * const result = await form.validateAsync()
   * if (!result.success) showErrors(result.errors)
   * ```
   *
   * Pass a path to validate a subtree. `state.isValidating` flips
   * `true` while the promise is in flight.
   */
  validateAsync: (path?: FlatPath<Form>) => Promise<ValidationResponseWithoutValue<Form>>
  /**
   * Bind a path to a native input via `v-register`. Returns a
   * `RegisterValue` carrying the live ref and event handlers the
   * directive needs.
   *
   * ```vue
   * <input v-register="form.register('email')" />
   * <input
   *   type="password"
   *   v-register="form.register('password', { persist: true, acknowledgeSensitive: true })"
   * />
   * ```
   *
   * Pass `options.persist` to opt into the form's persistence
   * pipeline. Persistence requires `useForm({ persist })` configured
   * for storage activity to actually happen.
   */
  register: <Path extends RegisterFlatPath<Form, keyof Form>>(
    path: Path,
    options?: RegisterOptions
  ) => RegisterValue<NestedReadType<WriteShape<Form>, Path>>
  /**
   * The form's identifier — either the explicit `key` passed to
   * `useForm` or an auto-generated unique id when `key` was omitted.
   * Use it when feeding API errors through `parseApiErrors`:
   *
   * ```ts
   * const result = parseApiErrors(serverPayload, { formKey: form.key })
   * if (result.ok) form.setFieldErrors(result.errors)
   * ```
   */
  key: FormKey

  // --- Reactive field-error API ---

  /**
   * Reactive map of field errors, keyed by dotted path. Populated
   * automatically by `handleSubmit` and per-field validation; cleared
   * on validation success.
   *
   * Read in templates with no `.value`:
   *
   * ```vue
   * <p v-if="form.fieldErrors.email">{{ form.fieldErrors.email[0].message }}</p>
   * ```
   *
   * Watch from script via the getter form:
   *
   * ```ts
   * watch(() => form.fieldErrors.email, (errors) => …)
   * ```
   *
   * Use bracket access for nested dotted keys
   * (`form.fieldErrors['user.profile.email']`) — JS dot notation
   * splits on literal dots.
   *
   * Read-only — populate via `setFieldErrors`, `addFieldErrors`, and
   * `clearFieldErrors`. Server-side errors flow through
   * `parseApiErrors` first.
   */
  fieldErrors: Readonly<FormFieldErrors<Form>>

  /**
   * Replace every field error for this form with the provided list.
   * Useful after `parseApiErrors` produces a fresh batch from a
   * server response.
   *
   * ```ts
   * const result = parseApiErrors(payload, { formKey: form.key })
   * if (result.ok) form.setFieldErrors(result.errors)
   * ```
   */
  setFieldErrors: (errors: ValidationError[]) => void

  /**
   * Append errors to the existing set without clearing prior entries.
   * Use when reporting an additional issue alongside existing errors
   * (e.g. a partial server response).
   */
  addFieldErrors: (errors: ValidationError[]) => void

  /**
   * Clear errors. Pass a path to clear errors for a single field;
   * call with no arguments to clear every error on the form.
   *
   * ```ts
   * form.clearFieldErrors('email')   // clear one field
   * form.clearFieldErrors()          // clear all
   * ```
   */
  clearFieldErrors: (path?: string | (string | number)[]) => void

  // --- Form-level state ---

  /**
   * Form-level reactive flags (`isDirty`, `isValid`, `isSubmitting`,
   * `submitCount`, `canUndo`, etc.). See `FormState` for the full
   * shape. Read leaves directly with no `.value`.
   *
   * For per-field state (touched, focused, blurred, errors at one
   * path), use `getFieldState(path)` instead.
   */
  state: FormState

  // --- Reset ---

  /**
   * Restore the form to its initial state. Without arguments,
   * re-applies the schema defaults (and any `defaultValues` passed
   * to `useForm`). Pass `nextDefaultValues` to seed the reset with
   * a fresh set of overrides.
   *
   * Resets:
   *   - the form value back to defaults;
   *   - the dirty baseline (so the next edit flips `isDirty` correctly);
   *   - field errors;
   *   - touched / focused / blurred per-field flags;
   *   - submission state (`isSubmitting` / `submitCount` / `submitError`);
   *   - the persisted draft, if persistence is configured.
   *
   * The next edit on a still-mounted opted-in input will start
   * persisting again automatically.
   */
  reset: (nextDefaultValues?: DeepPartial<WriteShape<Form>>) => void

  /**
   * Restore a single field (or a sub-tree like `'user'`) to its
   * initial value. Clears errors and touched flags for the field
   * and its descendants; leaves siblings and submission state alone.
   *
   * No-op when the path doesn't exist on the form (e.g. a typo'd
   * dynamic key).
   *
   * If persistence is configured, the matching subpath is removed
   * from the persisted draft too.
   */
  resetField: (path: FlatPath<Form>) => void

  // --- Persistence (imperative APIs) ---

  /**
   * Write the current value at `path` to storage immediately. Useful
   * for explicit "Save draft" buttons, `beforeunload` handlers, or
   * multi-step checkpoints where the user shouldn't wait for the
   * debounce window.
   *
   * Bypasses both the per-field opt-in and the debouncer. Existing
   * paths in the persisted draft are preserved (this is a merge,
   * not a replace).
   *
   * Throws `SensitivePersistFieldError` for sensitive-looking paths
   * unless you pass `{ acknowledgeSensitive: true }`. No-op when
   * `useForm({ persist })` wasn't configured.
   */
  persist: (path: FlatPath<Form>, options?: { acknowledgeSensitive?: boolean }) => Promise<void>

  /**
   * Remove data from the persisted draft. Without arguments, wipes
   * the entire entry. With a path, removes just that subpath.
   *
   * Does not change the in-memory form state — pair with `reset()`
   * / `resetField()` if you need both. Future edits to still-mounted
   * opted-in fields will re-populate the entry. No-op when
   * persistence isn't configured.
   */
  clearPersistedDraft: (path?: FlatPath<Form>) => Promise<void>

  // --- Undo / redo ---

  /**
   * Revert the form to the previous snapshot. Returns `true` when a
   * snapshot was restored, `false` when there's nothing to undo.
   * No-op (returns `false`) when `useForm({ history })` wasn't configured.
   */
  undo: () => boolean

  /**
   * Replay a previously-undone snapshot. Returns `true` on success,
   * `false` when the redo stack is empty. The redo stack clears as
   * soon as a new mutation lands.
   */
  redo: () => boolean

  // --- Focus / scroll to first error ---

  /**
   * Focus the first errored field's first visible element. Returns
   * `true` when an element was focused, `false` when no candidate
   * element exists (no errors, or every errored field is unmounted
   * or hidden).
   *
   * Pass `{ preventScroll: true }` if you're scrolling separately
   * (e.g. via `scrollToFirstError`) and don't want the browser to
   * fight the explicit scroll.
   */
  focusFirstError: (options?: { preventScroll?: boolean }) => boolean

  /**
   * Scroll the first errored field's first visible element into
   * view. Returns `true` when the call ran, `false` when no
   * candidate element exists.
   *
   * `options` is forwarded to `Element.scrollIntoView` unchanged.
   */
  scrollToFirstError: (options?: ScrollIntoViewOptions) => boolean

  // --- Field arrays ---

  /**
   * Append `value` to the array at `path`.
   *
   * ```ts
   * form.append('items', { name: 'New' })
   * ```
   */
  append: <Path extends ArrayPath<Form>>(path: Path, value: ArrayItem<Form, Path>) => void
  /** Prepend `value` to the array at `path`. */
  prepend: <Path extends ArrayPath<Form>>(path: Path, value: ArrayItem<Form, Path>) => void
  /**
   * Insert `value` into the array at `path` at the given `index`.
   * Behaves like `Array.prototype.splice`: `index` is clamped into
   * `[0, length]`, and negative indices count from the end.
   */
  insert: <Path extends ArrayPath<Form>>(
    path: Path,
    index: number,
    value: ArrayItem<Form, Path>
  ) => void
  /** Remove the element at `index` from the array at `path`. No-op when out of range. */
  remove: <Path extends ArrayPath<Form>>(path: Path, index: number) => void
  /** Swap the elements at indices `a` and `b`. No-op when either is out of range. */
  swap: <Path extends ArrayPath<Form>>(path: Path, a: number, b: number) => void
  /**
   * Move the element at `from` to `to`. Useful for drag-and-drop
   * reordering. No-op when either index is out of range.
   */
  move: <Path extends ArrayPath<Form>>(path: Path, from: number, to: number) => void
  /** Replace the element at `index` with `value`. No-op when out of range. */
  replace: <Path extends ArrayPath<Form>>(
    path: Path,
    index: number,
    value: ArrayItem<Form, Path>
  ) => void
}
