import type { App, InjectionKey } from 'vue'
import { getCurrentInstance, inject, shallowReactive } from 'vue'
import type { AttaformDefaults, FormKey } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { OutsideSetupError, RegistryNotInstalledError } from './errors'
import { detectSSR, type SSRDetectOptions } from './ssr'

/**
 * Per-Vue-app container for all form state instances. Each
 * `app.use(createAttaform())` call gets its own registry,
 * so the library runs under bare Vue 3 + SSR (via
 * `@vue/server-renderer`) and Nuxt with the same code path.
 *
 * Each form's state lives in `forms: Map<FormKey, FormStore<GenericForm>>`.
 * The type relaxation at storage time is necessary because different
 * forms in the same app have different `Form` generics; callers recover
 * the specific form type via `useForm`'s overloads.
 */

/**
 * Serialised snapshot of one form's state, captured by
 * `renderAttaformState` for SSR and replayed by
 * `hydrateAttaformState` on the client. Round-trips through
 * JSON-safe tuples; field references are intentionally omitted
 * (DOM nodes don't survive serialisation).
 */
export type SerializedFormData = {
  /** The form's value at snapshot time. */
  readonly form: unknown
  /**
   * Errors produced by the schema at snapshot time. Replayed into
   * the client form's error state at hydration; cleared on
   * successful re-validation client-side.
   */
  readonly schemaErrors: ReadonlyArray<readonly [string, unknown]>
  /**
   * Errors set explicitly via `setFieldErrors` / `addFieldErrors`
   * (typically from a server response parsed via `parseApiErrors`)
   * at snapshot time. Replayed at hydration; persists across
   * client-side re-validation.
   */
  readonly userErrors: ReadonlyArray<readonly [string, unknown]>
  /** Per-field metadata (timestamps, raw values, connection flags) captured at snapshot time. */
  readonly fields: ReadonlyArray<readonly [string, unknown]>
  /**
   * Path keys that were in the form's `blankPaths` set at
   * snapshot time. Round-trips the "displayed empty" UI state across
   * the SSR boundary — without it, the client briefly renders
   * `String(slim-default)` (e.g. `'0'`) for fields the server
   * rendered as blank. Optional in the wire format so older payload
   * shapes deserialise cleanly.
   */
  readonly blankPaths?: ReadonlyArray<string>
}

export type PendingHydration = Map<FormKey, SerializedFormData>

/**
 * The library's per-Vue-app container. One `AttaformRegistry` is
 * created per `app.use(createAttaform())` call.
 *
 * Most consumers never touch this directly — `useForm` and
 * `injectForm` reach the registry on your behalf. Access it
 * explicitly only when wiring SSR or a custom plugin integration.
 */
export type AttaformRegistry = {
  /**
   * Live forms keyed by `FormKey`.
   * @internal
   */
  readonly forms: Map<FormKey, FormStore<GenericForm>>
  /**
   * Snapshots staged by `hydrateAttaformState` waiting to be consumed by the next `useForm` call.
   * @internal
   */
  readonly pendingHydration: PendingHydration
  /** `true` while running on the server during SSR; `false` on the client. */
  readonly isSSR: boolean
  /** App-level defaults applied to every `useForm` call. */
  readonly defaults: AttaformDefaults
  /**
   * Track a consumer of `key`. Returns a dispose function — call it
   * when the consumer unmounts. The form is evicted automatically
   * when the last consumer disposes, so long-running SPAs don't
   * leak detached state across navigations.
   * @internal
   */
  readonly trackConsumer: (key: FormKey) => () => void
  /**
   * Wait for all pending persistence writes across every live form
   * to settle. Useful for SSR shutdown and integration tests that
   * need a deterministic teardown.
   * @internal
   */
  readonly shutdown: () => Promise<void>
}

/**
 * The Vue `InjectionKey` under which the registry is provided on the
 * app. Most consumers never need this — `useForm` and
 * `injectForm` resolve the registry automatically.
 */
// `Symbol.for(...)` so the key survives module duplication. If Vite's
// dep optimizer ends up serving attaform as two separate copies (one
// live-ESM, one pre-bundled — the standard hazard for linked-source
// installs that opt into `optimizeDeps.include`), each copy still
// resolves the same global symbol from the well-known string. Plugin
// install's `app.provide(kAttaformRegistry, ...)` and the page's
// `inject(kAttaformRegistry, null)` agree on the key, so `useForm`
// finds its registry regardless of which copy did the provide. The
// `attaform:` prefix namespaces the key safely. Same reasoning
// for `kFormContext` and `kFormInstanceId` below.
export const kAttaformRegistry: InjectionKey<AttaformRegistry> = Symbol.for('attaform:registry')

/**
 * Provides the current form's FormStore to descendants. Installed by
 * `useAbstractForm` after it resolves the state, so any nested component
 * can call `injectForm()` without prop-threading the form API.
 *
 * Typed as `FormStore<GenericForm>` — the descendant that re-emerges the
 * shape must supply its own `Form` generic, because Vue's InjectionKey
 * erases the generic at the provide/inject boundary.
 */
export const kFormContext: InjectionKey<FormStore<GenericForm>> =
  Symbol.for('attaform:form-context')

/**
 * Provide / inject key for the per-`useForm()`-call instance ID. Provided
 * alongside `kFormContext` so descendants reaching via `injectForm()`
 * inherit the ancestor's `formInstanceId` and their locally-registered
 * elements tag against the SAME instance — keeps parent-submit-focus
 * working for inputs registered by deep children.
 *
 * Sibling `useForm({ key })` calls (e.g. sidebar + main rendering the
 * same form) sit at distinct tree positions, so each provides its own
 * ID; descendants of each branch inherit the branch's ID. Two ID spaces
 * stay isolated even when the underlying FormStore is shared.
 */
export const kFormInstanceId: InjectionKey<string> = Symbol.for('attaform:form-instance-id')

declare module 'vue' {
  interface App {
    /** @internal */
    _attaform?: AttaformRegistry
  }
}

/** Options for `createRegistry`. */
export type CreateRegistryOptions = SSRDetectOptions & {
  /**
   * App-level defaults applied to every `useForm` call. Per-form
   * options always win. Omitted is equivalent to `{}`.
   */
  defaults?: AttaformDefaults
}

/**
 * Create a fresh `AttaformRegistry`. `createAttaform()` calls
 * this internally — most consumers never need to call it directly.
 * Use it when building a custom plugin that doesn't want the
 * `createAttaform` plugin's auto-install behaviour (e.g. test
 * harnesses, embedded apps).
 */
export function createRegistry(options: CreateRegistryOptions = {}): AttaformRegistry {
  const isSSR = detectSSR(options)
  // Frozen so accidental writes downstream throw in dev. Public surface
  // (`createAttaform({ defaults })`) treats this as data, not as
  // a mutation point — there's no public API to update defaults after
  // install, and adding one would invite race conditions with already-
  // mounted forms.
  const defaults: AttaformDefaults = Object.freeze({ ...(options.defaults ?? {}) })
  // The outer object is plain (it holds references we never rebind); inner
  // Maps are reactive via Vue's collection handlers so per-key reads track
  // per-key. `shallowReactive` avoids Vue's deep Ref-unwrapping, which would
  // mangle FormStore.form's Ref<F> type into F on lookup.
  const forms = shallowReactive(new Map<FormKey, FormStore<GenericForm>>())
  const pendingHydration = shallowReactive(new Map<FormKey, SerializedFormData>())
  // Consumer counts are bookkeeping — not reactive. No template should ever
  // depend on "how many useForm calls are live", and using a plain Map
  // avoids triggering watchers when we increment on every mount.
  const consumers = new Map<FormKey, number>()

  // Stores that have been evicted from `forms` but still have a
  // pending drain. `shutdown()` awaits these too so a process-exit
  // hook doesn't tear down before debounced writes from already-
  // unmounted forms have a chance to flush.
  const evicting = new Set<FormStore<GenericForm>>()

  function trackConsumer(key: FormKey): () => void {
    consumers.set(key, (consumers.get(key) ?? 0) + 1)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const remaining = (consumers.get(key) ?? 1) - 1
      if (remaining <= 0) {
        // Tear down non-reactive resources the FormStore owns (field-
        // validation timers, abort controllers) BEFORE dropping the
        // registry reference — once the Map entry is gone we can't
        // reach the state anymore.
        const state = forms.get(key)
        consumers.delete(key)
        // Eviction from `forms` stays synchronous: any consumer that
        // reads `registry.forms` after unmount (tests, devtools) sees
        // the form gone immediately. Drain-then-dispose runs async in
        // the background so the persistence layer's debounced final
        // write can complete — the FormStore is reachable through the
        // closure here even after `forms.delete`.
        forms.delete(key)
        if (state !== undefined) {
          evicting.add(state)
          void state
            .awaitPendingWrites()
            .catch(() => undefined)
            .finally(() => {
              evicting.delete(state)
              state.dispose()
            })
        }
      } else {
        consumers.set(key, remaining)
      }
    }
  }

  async function shutdown(): Promise<void> {
    // Snapshot the keys — `awaitPendingWrites` may resolve mid-iteration
    // and trigger eviction that mutates `forms` while we're walking.
    // Include the evicting set so in-flight drains from already-
    // unmounted forms also flush before shutdown returns.
    const states = [...forms.values(), ...evicting]
    await Promise.allSettled(states.map((state) => state.awaitPendingWrites()))
  }

  return { forms, pendingHydration, isSSR, defaults, trackConsumer, shutdown }
}

/**
 * Look up the current app's registry from inside a component's
 * `setup()` (or any synchronous code on the setup call stack).
 *
 * Most consumers don't need this — `useForm` and `injectForm`
 * call it on your behalf. Reach for it directly when building
 * custom integrations that need the raw registry.
 *
 * Throws:
 * - `OutsideSetupError` when called outside a Vue setup context
 *   (e.g. from an event handler or async callback). Move the call
 *   into setup, or trigger it from a child component.
 * - `RegistryNotInstalledError` when called inside setup but the
 *   plugin wasn't installed. Add
 *   `app.use(createAttaform())` to your app entry.
 */
export function useRegistry(): AttaformRegistry {
  const instance = getCurrentInstance()
  if (instance === null) {
    throw new OutsideSetupError()
  }
  const registry = inject(kAttaformRegistry, null)
  if (registry === null) {
    throw new RegistryNotInstalledError()
  }
  return registry
}

/**
 * Look up a Vue app's registry by `App` reference. Used by
 * SSR helpers (`renderAttaformState`, `hydrateAttaformState`) that
 * run outside a component setup context.
 *
 * Throws `RegistryNotInstalledError` when the app hasn't been wired
 * with `createAttaform()`.
 */
export function getRegistryFromApp(app: App): AttaformRegistry {
  const registry = app._attaform
  if (registry === undefined) {
    throw new RegistryNotInstalledError()
  }
  return registry
}

export function attachRegistryToApp(app: App, registry: AttaformRegistry): void {
  app.provide(kAttaformRegistry, registry)
  app._attaform = registry
}
