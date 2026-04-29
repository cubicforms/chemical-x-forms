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
      `[@chemical-x/forms] Form key "${key}" uses the reserved "__cx:" namespace. ` +
        `Use a different prefix — "__cx:" is for library-internal synthetic keys ` +
        `(anonymous useForm() calls without an explicit key).`
    )
  }
}

/**
 * Thrown (in dev) when `useForm({ persist: ... })` is configured on
 * an anonymous form (no `key:` provided). The synthetic `__cx:anon:`
 * identity isn't stable across remounts (Vue's `useId()` allocator
 * drifts under HMR, and any sibling `useId()` call shifts subsequent
 * IDs), so the persistence layer can't reliably find the previous
 * mount's draft. Result: stale entries pile up in storage and the
 * user's most recent edit doesn't always come back.
 *
 * Fix: pass an explicit `key` to `useForm()`.
 *
 * In production builds the runtime downgrades this to a one-shot
 * `console.warn` so a deployed third-party app shipping the
 * anti-pattern doesn't hard-crash.
 */
export class AnonPersistError extends Error {
  override readonly name = 'AnonPersistError'
  constructor() {
    super(
      '[@chemical-x/forms] persist: requires an explicit key on useForm().\n' +
        '  Why: anonymous keys drift on remount AND can collide between forms — your data could leak across unrelated forms.\n' +
        "  Fix: useForm({ schema, key: 'login', persist: '...' })\n" +
        '  In prod: no throw — persistence is silently disabled and a one-time warn is logged.'
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
      `[@chemical-x/forms] Refusing to persist "${display}" — this path matches a ` +
        `sensitive-name pattern (password / cvv / ssn / token / etc.). Storing sensitive ` +
        `data in client-side storage is a compliance risk (HIPAA / PII / PCI-DSS / SOC2). ` +
        `Fix: persist this server-side, OR pass \`acknowledgeSensitive: true\` to register() ` +
        `(or form.persist()) if the client-side persistence is intentional.`
    )
  }
}

/**
 * Thrown when persistence is misconfigured in a way that would either
 * (a) silently drop writes, or (b) namespace storage under a
 * non-deterministic synthetic key — both of which become security bugs
 * the moment encrypted persistence backends are added (the same key
 * may be derived for two unrelated forms).
 *
 * Two `cause` values, one error shape:
 *
 *   - `'no-key'` — `useForm({ persist: ... })` called without `key:`.
 *     Anonymous keys (`__cx:anon:*`) drift across mounts; persisting
 *     to a non-deterministic location is refused outright.
 *
 *   - `'register-without-config'` — `register(_, { persist: true })`
 *     declared on a form whose `useForm()` options omit `persist:`.
 *     The opt-in is recorded but nothing would ever land in storage.
 *
 * Fix: align the two layers — set `persist:` + `key:` on `useForm()`,
 * or remove `{ persist: true }` from the offending `register()` call.
 */
export class AnonPersistError extends Error {
  override readonly name = 'AnonPersistError'
  readonly schemaFields: readonly string[] | undefined
  readonly callSite: string | undefined
  override readonly cause: 'no-key' | 'register-without-config'
  constructor(opts: {
    schemaFields?: readonly string[]
    callSite?: string
    cause: 'no-key' | 'register-without-config'
  }) {
    super(formatAnonPersistMessage(opts))
    this.schemaFields = opts.schemaFields
    this.callSite = opts.callSite
    this.cause = opts.cause
  }
}

function formatAnonPersistMessage(opts: {
  schemaFields?: readonly string[]
  callSite?: string
  cause: 'no-key' | 'register-without-config'
}): string {
  const head =
    opts.cause === 'no-key'
      ? `useForm({ persist: ... }) requires an explicit \`key:\`. Anonymous synthetic keys (\`__cx:anon:*\`) drift across mounts and can collide between unrelated forms — refusing to persist to a non-deterministic location.`
      : `register(_, { persist: true }) declared on a form whose useForm() options have no \`persist:\` configured. The opt-in is recorded but nothing would ever land in storage.`
  const fields =
    opts.schemaFields !== undefined && opts.schemaFields.length > 0
      ? ` Form fields: { ${opts.schemaFields.join(', ')} }.`
      : ''
  const fix =
    opts.cause === 'no-key'
      ? ` Fix: add \`key: '<stable-id>'\` to useForm().`
      : ` Fix: add \`persist: 'session'\` (or 'local') and \`key:\` to useForm(), or remove \`{ persist: true }\` from this register() call.`
  const where = opts.callSite !== undefined ? ` ${opts.callSite}` : ''
  return `[@chemical-x/forms] ${head}${fields}${fix}${where}`
}
