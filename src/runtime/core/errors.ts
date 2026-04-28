/**
 * Typed error classes thrown by the form library. Each one signals a
 * distinct misuse so calling code can branch on `instanceof` instead
 * of pattern-matching error messages.
 */

/**
 * Thrown when a path string is malformed — typically a dotted path
 * with empty segments (e.g. `'a..b'`, leading or trailing dots).
 * Use array form (`['a', 'b']`) for keys that contain literal dots.
 */
export class InvalidPathError extends Error {
  override readonly name = 'InvalidPathError'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

/**
 * Thrown when a `handleSubmit`-supplied `onError` callback itself
 * throws or rejects. Wraps the inner failure so both the original
 * cause (via `error.cause`) and the propagation site are visible.
 */
export class SubmitErrorHandlerError extends Error {
  override readonly name = 'SubmitErrorHandlerError'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

/**
 * Thrown by `useForm` / `useFormContext` when the form library's
 * plugin hasn't been installed on the current Vue app.
 *
 * Fix: add `app.use(createChemicalXForms())` to your app entry
 * (or `@chemical-x/forms/nuxt` for Nuxt projects).
 */
export class RegistryNotInstalledError extends Error {
  override readonly name = 'RegistryNotInstalledError'
  constructor() {
    super(
      '[@chemical-x/forms] Registry not found. Install the plugin via `app.use(createChemicalXForms())`.'
    )
  }
}

/**
 * Thrown when `useForm` / `useFormContext` is called outside of a
 * Vue `setup()` function — typically from an event handler, watcher,
 * or async callback that runs after mount.
 *
 * Fix: move the call into `setup()`, or trigger it from a child
 * component whose `setup()` runs the composable.
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

/**
 * Thrown when a `useForm({ key })` call uses a key starting with
 * `__cx:`. That prefix is reserved for keys the library generates
 * internally (e.g. for anonymous `useForm()` calls without an
 * explicit key). Pick a different prefix for your form.
 */
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
 * Thrown when `register(path, { persist: true })` or `form.persist(path)`
 * targets a path whose name matches a sensitive-data heuristic
 * (password, cvv, ssn, token, etc.) without an explicit
 * `acknowledgeSensitive: true` override.
 *
 * Sensitive data in client-side storage (localStorage, sessionStorage,
 * IndexedDB) is a compliance risk — it survives logouts, is readable
 * by any same-origin script, and is unencrypted at rest.
 *
 * Fix: pass `acknowledgeSensitive: true` to confirm the persistence
 * is intentional, or persist the data server-side instead.
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
