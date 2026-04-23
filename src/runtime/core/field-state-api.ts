import { computed, type ComputedRef } from 'vue'
import type { ValidationError } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormState } from './create-form-state'
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
  readonly value: unknown
  readonly original: unknown
  readonly pristine: boolean
  readonly dirty: boolean
  readonly focused: boolean | null
  readonly blurred: boolean | null
  readonly touched: boolean | null
  readonly isConnected: boolean
  readonly updatedAt: string | null
  readonly errors: ValidationError[]
  readonly path: Path
}

export function buildFieldStateAccessor<F extends GenericForm>(state: FormState<F>) {
  return function getFieldState(pathInput: string | Path): ComputedRef<FieldStateView> {
    const { segments, key } = canonicalizePath(pathInput)
    return computed<FieldStateView>(() => {
      const record = state.fields.get(key)
      const value = state.getValueAtPath(segments)
      const original = state.originals.get(key)
      const pristine = state.isPristineAtPath(segments)
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
        errors: state.errors.get(key) ?? [],
        path: segments,
      }
    })
  }
}
