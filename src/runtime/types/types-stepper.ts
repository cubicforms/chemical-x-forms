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
 * `useStepper(forms, options)` — options is positional-required per
 * the "required internal params" doctrine. Empty in PR 2; fields
 * land in PR 3 (`defaultStatuses`, `onStatusChange`, `progress`) and
 * PR 4 (`history`, `getServerActiveStep`).
 */
export type StepperOptions = Record<string, never>

/**
 * Return shape of `useStepper`. Reactive `current` is a readonly ref;
 * `forms` is the original tuple (so consumers can index by key or
 * iterate); `count` is the static step count.
 */
export type UseStepperReturnType<Forms extends readonly AnyForm[]> = {
  readonly current: Readonly<Ref<KeysOf<Forms>>>
  readonly forms: Forms
  readonly count: number
  readonly next: (options?: StepperNavOptions) => void
  readonly back: (options?: StepperNavOptions) => void
  readonly goTo: (key: KeysOf<Forms>, options?: StepperNavOptions) => void
}
