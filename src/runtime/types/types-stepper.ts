/**
 * Public types for `useStepper` — the multistep-form orchestrator.
 *
 * The stepper composes existing `useForm` instances. Each step is a
 * form with its own schema, key, validation, and persistence; the
 * stepper layers navigation, status aggregation, and activation
 * lifecycle on top.
 *
 * Discriminated `current` is the load-bearing type. Threading the
 * literal `K` through `useForm` (see `UseFormReturnType<..., K>`)
 * means `stepper.current.value` resolves to the union of participating
 * keys, and `goTo(key)` autocompletes that union.
 */

import type { Ref } from 'vue'
import type { FormKey } from './types-api'

/**
 * Minimum structural shape the stepper requires from a participating
 * form. Constraining to the full `UseFormReturnType` would force
 * contravariant unification of the storage / read shapes across all
 * steps; the stepper does not care about those — it routes by `key`
 * at runtime and exposes the original form objects untouched.
 *
 * `UseFormReturnType<...>` satisfies this shape because its `key`
 * field is `readonly key: K extends FormKey`.
 */
export type AnyForm = { readonly key: FormKey }

/**
 * Extracts the literal key from a single keyed form's return type.
 * Lets the stepper discriminate `stepper.current.value` on the form
 * that owns the active step.
 */
export type FormKeyOf<F extends AnyForm> = F['key']

/**
 * Union of keys across an array of forms. With three forms keyed
 * `'a' | 'b' | 'c'`, `KeysOf<typeof forms>` is `'a' | 'b' | 'c'`.
 */
export type KeysOf<Forms extends readonly AnyForm[]> = Forms[number]['key']

/**
 * Per-call navigation options. `replace` reserved for PR 4 (browser
 * history); included now so the call shape is stable across stepper
 * versions.
 */
export type StepperNavOptions = {
  readonly replace?: boolean
}

/**
 * Per-form summary surface — what `stepper.statuses[key]` exposes
 * (and what `defaultStatuses` seeds). Distinct from `form.meta`:
 * `FormStatus` is the cross-step rollup optimized for template
 * ergonomics (`{{ stepper.statuses.cargo.isValid }}`), while
 * `form.meta` carries the full per-form lifecycle surface.
 *
 * Field semantics:
 *  - `isValid` — `form.meta.valid`. `false` while errors exist or
 *    while the first-validation-done gate has not flipped.
 *  - `isDirty` — `form.meta.dirty`. `true` once any value differs
 *    from the original defaults.
 *  - `isSubmitted` — `form.meta.isSubmitted`. `true` once
 *    `submitCount` reaches one or more.
 *  - `errorCount` — `form.meta.errorCount`. Count of active
 *    validation errors (zero when valid).
 */
export type FormStatus = {
  readonly isValid: boolean
  readonly isDirty: boolean
  readonly isSubmitted: boolean
  readonly errorCount: number
}

/**
 * `defaultStatuses` and `stepper.statuses` both use this shape — a
 * record keyed by each form's key, with a `FormStatus` payload per
 * key. The mapped type preserves the literal union from
 * `KeysOf<Forms>`, so template autocomplete works without manual
 * type annotations.
 */
export type Statuses<Forms extends readonly AnyForm[]> = {
  readonly [K in KeysOf<Forms>]: FormStatus
}

/**
 * Flat error shape returned by `stepper.allErrors`. Cross-step
 * aggregations need a stable identity per error — `formKey` + `path`
 * — so consumers can render a wizard-wide error summary that links
 * back to the offending field.
 *
 * Sort order: stepper's `forms` order, then each form's internal
 * error order.
 */
export type AggregateError = {
  readonly formKey: FormKey
  readonly path: ReadonlyArray<string | number>
  readonly message: string
  readonly code?: string
}

/**
 * Mirror of `form.values`' call-or-read pattern, one level deep.
 * Drillable as `stepper.statuses.cargo.isValid` (readable), as
 * `stepper.statuses('cargo')` (callable single-key), or as
 * `stepper.statuses()` (callable no-arg returns the whole record).
 *
 * `Readonly<S>` provides the readable surface; the call signatures
 * shadow it for `stepper.statuses(key)` and `stepper.statuses()`.
 */
export type StepperStatusesProxy<S extends Record<string, FormStatus>> = ((
  key?: keyof S
) => FormStatus | S) &
  Readonly<S>

/**
 * `useStepper(forms, options)` — options is positional-required per
 * the "required internal params" doctrine. PR 3 adds
 * `defaultStatuses`; PR 4 adds `history` + `getServerActiveStep`.
 */
export type StepperOptions<Forms extends readonly AnyForm[] = readonly AnyForm[]> = {
  /**
   * Seed status payload used while a form is pre-resolved (async
   * `defaultValues` in flight, or stepper-deferred non-current).
   * Mirrors `defaultValues`' trichotomy: plain object, sync factory,
   * or async factory.
   *
   * Status resolution priority per form:
   *   1. `store.defaultsResolved === true` → derive from `form.meta`
   *   2. else seed value for this key → frozen seed
   *   3. else → pending sentinel
   *
   * Unknown keys in the seed object throw at construction (typo
   * safety).
   */
  readonly defaultStatuses?:
    | Statuses<Forms>
    | (() => Statuses<Forms>)
    | (() => Promise<Statuses<Forms>>)
  /**
   * Fires whenever a participating form's status (`isValid`,
   * `isDirty`, `isSubmitted`, or `errorCount`) materially changes —
   * one of those four scalars actually moved. The handler receives
   * the new status and the form whose status changed.
   *
   * Fire-and-forget: a returned promise is NOT awaited. Use a
   * separate \`onBeforeLeave\` (future) for nav-blocking guards.
   *
   * No debounce. The handler fires immediately on Vue's next watch
   * flush after the underlying meta changes — chatter is naturally
   * dampened by the material-change check (identical writes don't
   * re-fire).
   */
  readonly onStatusChange?: (status: FormStatus, form: Forms[number]) => void | Promise<void>
  /**
   * Optional progress override. When omitted, the stepper exposes
   * \`progress.value\` as \`valid_form_count / count\` (normalised to
   * \`[0, 1]\`). When provided, the returned number is used as-is —
   * the consumer is responsible for any normalisation (\`[0, 1]\`
   * vs raw count vs percentage).
   *
   * The override is invoked inside a Vue \`computed\` so it must be
   * synchronous and may only read reactive sources (form values,
   * form.meta, stepper.statuses, etc.).
   */
  readonly progress?: (forms: Forms) => number
}

/**
 * Cross-form value aggregate. Each form's `values` proxy is exposed
 * under its key — drillable as `stepper.allValues.cargo.weight`.
 * Useful for review screens and final-submit aggregation.
 */
export type AllValues<Forms extends readonly AnyForm[]> = {
  readonly [K in KeysOf<Forms>]: unknown
}

/**
 * Return shape of `useStepper`. Reactive `current` is a readonly ref;
 * `forms` is the original tuple (so consumers can index by key or
 * iterate); `count` is the static step count.
 *
 * `statuses` is a callable readonly proxy over `Statuses<Forms>` —
 * readable as `stepper.statuses.cargo.isValid`, callable as
 * `stepper.statuses('cargo')` or `stepper.statuses()`. Each entry
 * derives from the matching form's `meta`.
 *
 * `allValues` exposes each form's `values` proxy under its key for
 * cross-step review screens. `allErrors` is the flat error list across
 * all forms, ordered by `forms` then per-form order.
 */
export type UseStepperReturnType<Forms extends readonly AnyForm[]> = {
  readonly current: Readonly<Ref<KeysOf<Forms>>>
  readonly forms: Forms
  readonly count: number
  readonly statuses: StepperStatusesProxy<Statuses<Forms>>
  readonly allValues: AllValues<Forms>
  readonly allErrors: Readonly<Ref<readonly AggregateError[]>>
  readonly progress: Readonly<Ref<number>>
  readonly next: (options?: StepperNavOptions) => void
  readonly back: (options?: StepperNavOptions) => void
  readonly goTo: (key: KeysOf<Forms>, options?: StepperNavOptions) => void
}
