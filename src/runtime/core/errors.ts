/**
 * Typed error classes thrown by the form library. Each one signals a
 * distinct misuse so calling code can branch on `instanceof` instead
 * of pattern-matching error messages.
 *
 * Every class extends `AttaformError`, so consumers can write a single
 * polymorphic catch (`catch (e) { if (e instanceof AttaformError) ... }`)
 * instead of OR-chaining checks for each subclass. `AttaformError` itself
 * extends the standard `Error`, so existing `instanceof Error` usage
 * keeps working.
 */

/**
 * Base for every error class thrown by `attaform`. Sets
 * `this.name` from the constructor's `new.target.name`, so subclasses
 * don't have to redeclare their own name override.
 */
export class AttaformError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

/**
 * Thrown when a path string is malformed — typically a dotted path
 * with empty segments (e.g. `'a..b'`, leading or trailing dots).
 * Use array form (`['a', 'b']`) for keys that contain literal dots.
 */
export class InvalidPathError extends AttaformError {}

/**
 * Thrown when `useForm` receives an invalid configuration — most often
 * a schema passed directly as the first argument, or no argument at
 * all. The configuration is an options bag; the schema is one of
 * several fields, even when it's the only one in use.
 *
 * ```ts
 * // ✗ Crashes deep inside the validator with an opaque message:
 * const form = useForm(z.object({ ... }))
 * // ✗ Same:
 * const form = useForm()
 * // ✓ Pass the schema as the `schema` field:
 * const form = useForm({ schema: z.object({ ... }) })
 * ```
 *
 * The same shape applies to every entry point: `attaform/zod`,
 * `attaform/zod-v3`, `attaform/zod-v4`, and the schema-agnostic
 * `attaform` root.
 */
export class InvalidUseFormConfigError extends AttaformError {
  constructor() {
    super(
      '[attaform] useForm received an invalid configuration (a schema directly, no argument, ' +
        'or no `schema` field). Pass it as `useForm({ schema })` — the schema is one of several ' +
        'configuration options. See https://attaform.com/docs/api/use-form-return for the full ' +
        'configuration shape.'
    )
  }
}

/**
 * Thrown when a `handleSubmit`-supplied `onError` callback itself
 * throws or rejects. Wraps the inner failure so both the original
 * cause (via `error.cause`) and the propagation site are visible.
 */
export class SubmitErrorHandlerError extends AttaformError {}

/**
 * Thrown when an `attaform` API needs the registry attached to a Vue
 * app but it isn't there yet. Component-level entry points (`useForm`,
 * `injectForm`, `useRegister`) lazy-install the registry on first use,
 * so this error is mostly reached by SSR helpers — `renderAttaformState`
 * and `hydrateAttaformState` — which run outside a setup context and
 * have no current instance to install against.
 *
 * Fix: add `app.use(createAttaform())` (or `app.use(createAttaform({
 * ssr: true }))` on the server) to your SSR entry, before
 * `renderToString` / hydration. Under Nuxt, `attaform/nuxt` already
 * does this; the error usually points at a non-Nuxt SSR setup that
 * hasn't installed explicitly.
 */
export class RegistryNotInstalledError extends AttaformError {
  constructor() {
    super(
      '[attaform] No registry attached to this Vue app. Component-level useForm / injectForm / ' +
        'useRegister auto-install the registry, but SSR helpers (renderAttaformState, ' +
        'hydrateAttaformState) run outside setup and require an explicit ' +
        '`app.use(createAttaform())` at server-render time. Add it to your SSR entry, before ' +
        '`renderToString`.'
    )
  }
}

/**
 * Thrown when `useForm` / `injectForm` is called outside of a
 * Vue `setup()` function — typically from an event handler, watcher,
 * or async callback that runs after mount.
 *
 * Fix: move the call into `setup()`, or trigger it from a child
 * component whose `setup()` runs the composable.
 */
export class OutsideSetupError extends AttaformError {
  constructor() {
    super(
      '[attaform] useForm / injectForm called outside Vue setup(). ' +
        'Move into setup or mount a child component to trigger from an event.'
    )
  }
}

/**
 * Thrown when `useStepper` is called too late — after a participating
 * form's async `defaultValues` factory has already settled. The
 * defer-claim contract relies on `useStepper` winning the race
 * against a microtask-deferred factory; once the factory has fired,
 * the claim can no longer hold the privacy guarantee for that step.
 *
 * Fix: call `useStepper(...)` in the same synchronous `setup()` as
 * its participating `useForm(...)` calls. Don't defer the stepper
 * construction into `onMounted`, a watcher, or an async setup
 * function that awaits before the call.
 */
export class StepperLateRegistrationError extends AttaformError {
  constructor(key: string) {
    super(
      `[attaform] useStepper called after form "${key}" already settled its async defaultValues. ` +
        `The defer-claim contract needs useStepper to run in the same synchronous setup() as ` +
        `its useForm() calls. Move the useStepper(...) call up to setup-top, before any await.`
    )
  }
}

/**
 * Thrown when a `useForm({ key })` call uses a key starting with
 * `__atta:`. That prefix is reserved for keys the library generates
 * internally (e.g. for anonymous `useForm()` calls without an
 * explicit key). Pick a different prefix for your form.
 */
export class ReservedFormKeyError extends AttaformError {
  constructor(key: string) {
    super(
      `[attaform] Form key "${key}" uses the reserved "__atta:" namespace. ` +
        `Use a different prefix — "__atta:" is for library-internal synthetic keys ` +
        `(anonymous useForm() calls without an explicit key).`
    )
  }
}

/**
 * Thrown (in dev) when `useForm({ persist: ... })` is configured on
 * an anonymous form (no `key:` provided). The synthetic `__atta:anon:`
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
// (AnonPersistError class declaration is below; this docblock is the
// historical preamble — kept here so blame/PR review can trace the
// original intent. The richer class supersedes the earlier basic version.)

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
export class SensitivePersistFieldError extends AttaformError {
  constructor(path: ReadonlyArray<string | number> | string) {
    const display = Array.isArray(path) ? path.join('.') : String(path)
    super(
      `[attaform] Refusing to persist "${display}" — this path matches a ` +
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
 *     Anonymous keys (`__atta:anon:*`) drift across mounts; persisting
 *     to a non-deterministic location is refused outright.
 *
 *   - `'register-without-config'` — `register(_, { persist: true })`
 *     declared on a form whose `useForm()` options omit `persist:`.
 *     The opt-in is recorded but nothing would ever land in storage.
 *
 * Fix: align the two layers — set `persist:` + `key:` on `useForm()`,
 * or remove `{ persist: true }` from the offending `register()` call.
 */
export class AnonPersistError extends AttaformError {
  readonly schemaFields: readonly string[] | undefined
  readonly callSite: string | undefined
  override readonly cause: 'no-key' | 'register-without-config'
  constructor(opts: {
    schemaFields?: readonly string[] | undefined
    callSite?: string | undefined
    cause: 'no-key' | 'register-without-config'
  }) {
    super(formatAnonPersistMessage(opts))
    this.schemaFields = opts.schemaFields
    this.callSite = opts.callSite
    this.cause = opts.cause
  }
}

function formatAnonPersistMessage(opts: {
  schemaFields?: readonly string[] | undefined
  callSite?: string | undefined
  cause: 'no-key' | 'register-without-config'
}): string {
  const head =
    opts.cause === 'no-key'
      ? `useForm({ persist: ... }) requires an explicit \`key:\`. Anonymous synthetic keys (\`__atta:anon:*\`) drift across mounts and can collide between unrelated forms — refusing to persist to a non-deterministic location.`
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
  return `[attaform] ${head}${fields}${fix}${where}`
}
