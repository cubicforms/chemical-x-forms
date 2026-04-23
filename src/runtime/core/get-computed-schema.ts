import type { AbstractSchema, FormKey } from '../types/types-api'
import type { GenericForm } from '../types/types-core'

/**
 * Accept schema as either a direct value or a factory function `(key) => schema`.
 * The factory form is documented but rarely used — it exists for schemas that
 * want to embed the formKey into their identity.
 */
export function getComputedSchema<F extends GenericForm, GetValueFormType>(
  formKey: FormKey,
  schemaOrCallback:
    | AbstractSchema<F, GetValueFormType>
    | ((formKey: FormKey) => AbstractSchema<F, GetValueFormType>)
): AbstractSchema<F, GetValueFormType> {
  if (typeof schemaOrCallback === 'function') return schemaOrCallback(formKey)
  return schemaOrCallback
}
