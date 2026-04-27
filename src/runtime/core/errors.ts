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

/**
 * Thrown when a binding (or `form.persist`) targets a path whose name
 * matches the sensitive-name heuristic (password / cvv / ssn / token /
 * etc.) without an explicit `acknowledgeSensitive: true` override.
 *
 * Persisting sensitive data to client-side storage (localStorage,
 * sessionStorage, IndexedDB) creates a compliance footgun across
 * HIPAA / PII / PCI-DSS / SOC2: the device-bound copy survives logouts,
 * is readable by any same-origin script, and is unencrypted at rest.
 * The heuristic is intentionally noisy — false positives surface a
 * code-review trigger; the override turns it back off when the
 * developer affirms the persistence is intentional.
 */
export class SensitivePersistFieldError extends Error {
  override readonly name = 'SensitivePersistFieldError'
  constructor(path: ReadonlyArray<string | number> | string) {
    const display = Array.isArray(path) ? path.join('.') : String(path)
    super(
      `[@chemical-x/forms] The path "${display}" matches a sensitive-name ` +
        `pattern (password / cvv / ssn / token / etc.). Persisting sensitive ` +
        `data to client-side storage (localStorage / sessionStorage / IndexedDB) ` +
        `is a compliance risk (HIPAA / PII / PCI-DSS / SOC2). If you genuinely ` +
        `intend to persist this path, pass \`acknowledgeSensitive: true\` to ` +
        `register() (or to form.persist()) to opt out of this check.`
    )
  }
}
