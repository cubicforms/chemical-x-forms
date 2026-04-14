import { useState } from 'nuxt/app'
import { computed } from 'vue'
import type {
  FormErrorRecord,
  FormErrorStore,
  FormKey,
  ValidationError,
} from '../../../types/types-api'

/**
 * Reactive per-form error store, mirroring `useMetaTrackerStore`:
 * - `useState` for SSR-safe serialisation / hydration
 * - one `Map<FormKey, FormErrorRecord>` shared across every form instance
 * - a `computed` with defensive initialisation so 2+ forms on the same page
 *   don't observe an undefined record
 *
 * Paths are stored as dotted strings (`address.line1.street`) — matching the
 * shape `getFieldState(path)` already uses for lookups.
 */
export function useFormErrorStore(formKey: FormKey) {
  const formErrorStore = useState<FormErrorStore>(
    'chemical-x/form-error-store',
    () => new Map([[formKey, {}]])
  )

  const fieldErrors = computed<FormErrorRecord>(() => {
    // Defensive init: `useState` runs its initialiser once per SSR root; a
    // second `useForm({ key: 'other' })` on the same page would otherwise
    // find no record for its key.
    if (!formErrorStore.value.has(formKey)) {
      formErrorStore.value.set(formKey, {})
    }
    return formErrorStore.value.get(formKey)!
  })

  function pathToKey(path: string | (string | number)[]): string {
    return Array.isArray(path) ? path.join('.') : path
  }

  function groupByPath(errors: ValidationError[]): FormErrorRecord {
    const record: FormErrorRecord = {}
    for (const err of errors) {
      const key = pathToKey(err.path)
      if (!record[key]) record[key] = []
      record[key].push(err)
    }
    return record
  }

  /** Replace the current error record for this form with a fresh one. */
  function setErrors(errors: ValidationError[]) {
    formErrorStore.value.set(formKey, groupByPath(errors))
  }

  /** Merge the provided errors onto the existing record (appending per path). */
  function addErrors(errors: ValidationError[]) {
    const existing = formErrorStore.value.get(formKey) ?? {}
    const next: FormErrorRecord = { ...existing }
    for (const err of errors) {
      const key = pathToKey(err.path)
      next[key] = next[key] ? [...next[key], err] : [err]
    }
    formErrorStore.value.set(formKey, next)
  }

  /** Clear a specific path, or every path when called without arguments. */
  function clearErrors(path?: string | (string | number)[]) {
    if (path === undefined) {
      formErrorStore.value.set(formKey, {})
      return
    }
    const key = pathToKey(path)
    const existing = formErrorStore.value.get(formKey) ?? {}
    if (!(key in existing)) return
    const { [key]: _removed, ...rest } = existing
    formErrorStore.value.set(formKey, rest)
  }

  /** Readonly lookup helper — always returns an array (possibly empty). */
  function getErrorsForPath(path: string | (string | number)[]): ValidationError[] {
    return fieldErrors.value[pathToKey(path)] ?? []
  }

  return {
    fieldErrors,
    setErrors,
    addErrors,
    clearErrors,
    getErrorsForPath,
  }
}
