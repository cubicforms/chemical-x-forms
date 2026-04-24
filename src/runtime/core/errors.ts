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
    super(
      '[@chemical-x/forms] Registry not found on this Vue app. ' +
        'Install the plugin with `app.use(createChemicalXForms())` before calling any form composable.'
    )
  }
}
