import { computed, type ComputedRef } from 'vue'
import type { ValidationError } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { canonicalizePath, type Path } from './paths'

/**
 * Reactive field-state view. Combines per-field records, DOM focus/blur
 * state, and validation errors into a single object suitable for templates:
 *
 *   const emailState = getFieldState('email')
 *   emailState.value.dirty, .errors, .focused, ...
 *
 * All reads go through Vue computeds so consumers get fine-grained
 * reactivity — a change to one field's focus does not invalidate computeds
 * watching another field.
 */

export type FieldStateView = {
  /** The current value at this path. */
  readonly value: unknown
  /** The value the field was initialised with. */
  readonly original: unknown
  /** `true` when `value` matches `original`. */
  readonly pristine: boolean
  /** `true` when `value` differs from `original`. */
  readonly dirty: boolean
  /** `true` while the input has DOM focus; `null` until the first focus event. */
  readonly focused: boolean | null
  /** Flips to `true` on the first blur and stays there; `null` until then. */
  readonly blurred: boolean | null
  /** Flips to `true` on the first blur AFTER a focus and stays there; `null` until then. */
  readonly touched: boolean | null
  /** `true` while at least one DOM input is registered to this path. */
  readonly isConnected: boolean
  /** ISO timestamp of the most recent write; `null` until the first write. */
  readonly updatedAt: string | null
  /** Validation errors at this path (schema + user errors merged). Empty when valid. */
  readonly errors: ValidationError[]
  /** Canonical path segments — same shape as the input to `getFieldState`. */
  readonly path: Path
  /**
   * `true` when the user hasn't supplied a value yet — the input
   * renders as empty even though storage holds a slim default
   * (e.g. `0` for `z.number()`, `''` for `z.string()`). Answers
   * the question: "Is this field empty because the user left it
   * blank, or because the slim default happens to be `0` / `''`?"
   *
   * Becomes `false` on the first keystroke / programmatic write;
   * toggles back via `setValue(path, unset)` / `markBlank()`
   * / clearing a `<input type="number">`. Submit-time validation
   * surfaces "No value supplied" for required fields that are still
   * `blank`.
   */
  readonly blank: boolean
}

export function buildFieldStateAccessor<F extends GenericForm>(state: FormStore<F>) {
  return function getFieldState(pathInput: string | Path): ComputedRef<FieldStateView> {
    const { segments, key } = canonicalizePath(pathInput)
    return computed<FieldStateView>(() => {
      const record = state.fields.get(key)
      const value = state.getValueAtPath(segments)
      const original = state.originals.get(key)?.value
      const pristine = state.isPristineAtPath(segments)
      // Read both schema + user errors at this key directly so this
      // computed depends only on the two specific Map keys (Vue's
      // collection handlers track per-key reads). Going through
      // `state.getErrorsForPath` would work too, but inline reads keep
      // the dependency graph trivially obvious.
      const schemaForKey = state.schemaErrors.get(key)
      const userForKey = state.userErrors.get(key)
      const errors =
        schemaForKey === undefined
          ? userForKey === undefined
            ? []
            : [...userForKey]
          : userForKey === undefined
            ? [...schemaForKey]
            : [...schemaForKey, ...userForKey]
      return {
        value,
        original,
        pristine,
        dirty: !pristine,
        focused: record?.focused ?? null,
        blurred: record?.blurred ?? null,
        touched: record?.touched ?? null,
        isConnected: record?.isConnected ?? false,
        updatedAt: record?.updatedAt ?? null,
        errors,
        path: segments,
        blank: state.blankPaths.has(key),
      }
    })
  }
}
