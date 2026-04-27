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
      '[@chemical-x/forms] Registry not found. Install the plugin via `app.use(createChemicalXForms())`.'
    )
  }
}

/**
 * Thrown when a cx composable (`useForm`, `useFormContext`, `useRegistry`)
 * is invoked from outside a Vue `setup()` context — typically from an
 * event handler, watcher, or async callback that runs after mount.
 *
 * This is a Vue-lifecycle constraint, not a plugin-installation one:
 * the plugin can be perfectly installed but `inject` / `provide` only
 * resolve while a component instance is on the active call stack.
 *
 * Pre-disambiguation, the same `RegistryNotInstalledError` covered both
 * causes — pointing the developer at "install the plugin" when the
 * actual fix was "move the call into setup or a child component". The
 * split lets each failure mode lead the reader to the right fix.
 */
export class OutsideSetupError extends Error {
  override readonly name = 'OutsideSetupError'
  constructor() {
    super(
      '[@chemical-x/forms] useForm / useFormContext called outside Vue setup(). ' +
        'Move into setup or mount a child component to trigger from an event.'
    )
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
