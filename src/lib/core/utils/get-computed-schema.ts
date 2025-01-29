import _ from "lodash"

import type { AbstractSchema, FormKey } from "./types-api"
import type { GenericForm } from "./types-core"

export const getComputedSchema = <Form extends GenericForm, GetValueFormType>(
  formKey: FormKey,
  schemaOrCallback:
    | AbstractSchema<Form, GetValueFormType>
    | ((formKey: FormKey) => AbstractSchema<Form, GetValueFormType>),
) => {
  try {
    if (_.isFunction(schemaOrCallback)) {
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
