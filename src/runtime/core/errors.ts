/**
 * Typed error classes used across the core runtime. Each replaces a silent
 * failure mode in the pre-rewrite code (console.error + return [] / return
 * undefined patterns) with a named, instance-checkable error.
 */

export class InvalidPathError extends Error {
  override readonly name = 'InvalidPathError'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export class SubmitErrorHandlerError extends Error {
  override readonly name = 'SubmitErrorHandlerError'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export class RegistryNotInstalledError extends Error {
  override readonly name = 'RegistryNotInstalledError'
  constructor() {
    super('[@chemical-x/forms] Registry not found; install via `app.use(createChemicalXForms())`.')
  }
}

export class ReservedFormKeyError extends Error {
  override readonly name = 'ReservedFormKeyError'
  constructor(key: string) {
    super(
      `[@chemical-x/forms] The form key "${key}" uses the reserved "__cx:" namespace. ` +
        `This prefix is reserved for the library's internal synthetic keys (anonymous useForm calls). ` +
        `Pick a different prefix for your form.`
    )
  }
}
