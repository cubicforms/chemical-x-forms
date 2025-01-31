import isFunction from "lodash-es/isFunction"
import type { AbstractSchema, FormKey } from "../../../types/types-api"
import type { GenericForm } from "../../../types/types-core"

export const getComputedSchema = <Form extends GenericForm, GetValueFormType>(
  formKey: FormKey,
  schemaOrCallback:
    | AbstractSchema<Form, GetValueFormType>
    | ((formKey: FormKey) => AbstractSchema<Form, GetValueFormType>),
) => {
  try {
    if (isFunction(schemaOrCallback)) {
      return schemaOrCallback(formKey)
    }

    return schemaOrCallback
  }
  catch (error) {
    console.error(
      `Programming Error: Failed to compute schema with formKey '${formKey}'.`,
    )
    throw error
  }
}
