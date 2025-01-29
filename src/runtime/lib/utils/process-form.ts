import _ from "lodash"
import type { ComputedRef, Ref } from "vue"
import { toRaw, toRef } from "vue"

import { PATH_SEPARATOR } from "./constants"
import type { AbstractSchema, FormKey, HandleSubmit, ValidationError, ValidationResponseWithoutValue } from "./types-api"
import type { FlatPath, GenericForm } from "./types-core"

export function getValidateFactory<Form extends GenericForm>(
  form: ComputedRef<Form>,
  formKey: FormKey,
  schema: AbstractSchema<Form, Form>,
) {
  const NOT_FOUND = Symbol()

  function validateLogic(
    path: string | undefined,
  ): Readonly<Ref<ValidationResponseWithoutValue<Form>>> {
    // defensive code to help users that pass `validate` by reference to event handlers etc
    const safePath = typeof path === "string" ? path : undefined
    if (safePath === undefined) {
      return toRef(() => {
        const fullValidationResponse = schema.validateAtPath(
          form.value,
          safePath,
        )
        return {
          errors: fullValidationResponse.errors,
          success: fullValidationResponse.success,
          formKey,
        }
      })
    }

    return toRef(() => {
      const data = _.get(form.value, safePath, NOT_FOUND)
      if (data === NOT_FOUND) {
        const NOT_FOUND_ERROR: ValidationError = {
          message: `Path '${safePath}' was not found in form with key '${formKey}'.`,
          path: safePath.split(PATH_SEPARATOR),
          formKey,
        }
        return {
          errors: [NOT_FOUND_ERROR],
          success: false,
          formKey,
        }
      }

      const fullValidationResponse = schema.validateAtPath(data, safePath)
      return {
        errors: fullValidationResponse.errors,
        success: fullValidationResponse.success,
        formKey,
      }
    })
  }

  function validate(): Readonly<Ref<ValidationResponseWithoutValue<Form>>>
  function validate<Path extends FlatPath<Form>>(
    path: Path,
  ): Readonly<Ref<ValidationResponseWithoutValue<Form>>>
  function validate<Path extends FlatPath<Form>>(path?: Path) {
    try {
      console.log("is a function?", validateLogic)
      return validateLogic(path)
    }
    catch (error) {
      if (error instanceof Error) {
        console.error(`Unexpected Error: ${error.message}`)
        throw error
      }
    }
  }

  return validate
}

class AbstractSchemaValidationError extends Error {
  validationErrors: ValidationError[] // Define a property to hold the validation errors

  constructor(validationErrors: ValidationError[]) {
    super("Abstract Schema Validation failed") // Set a default error message
    this.validationErrors = validationErrors // Assign the argument to the class property

    // Ensure the prototype chain is correctly set for instanceof checks
    Object.setPrototypeOf(this, AbstractSchemaValidationError.prototype)
  }
}

export function getHandleSubmitFactory<Form extends GenericForm>(
  form: ComputedRef<Form>,
  validate: () => Readonly<Ref<ValidationResponseWithoutValue<Form>>>,
) {
  const handleSubmitLogic: HandleSubmit<Form> = async (onSubmit, onError) => {
    try {
      const { errors, success } = validate().value
      if (!success) {
        throw new AbstractSchemaValidationError(errors ?? [])
      }

      const rawForm = toRaw(form.value)
      await onSubmit(rawForm)
    }
    catch (error) {
      if (!onError) return

      if (error instanceof AbstractSchemaValidationError) {
        try {
          await onError(error.validationErrors)
        }
        catch (error) {
          if (error instanceof Error) {
            console.error(error.message)
            return
          }
        }

        return
      }

      // TODO: Eventually tap into these in a useful way
      if (error instanceof Error) {
        console.error(error.message)
      }
    }
  }

  const handleSubmit: HandleSubmit<Form> = async (onSubmit, onError) => {
    try {
      return handleSubmitLogic(onSubmit, onError)
    }
    catch (error) {
      if (error instanceof Error) {
        console.error(error.message)
      }
    }
  }

  return handleSubmit
}
