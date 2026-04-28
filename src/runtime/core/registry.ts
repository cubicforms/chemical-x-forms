import type { App, InjectionKey } from 'vue'
import { getCurrentInstance, inject, shallowReactive } from 'vue'
import type { ChemicalXFormsDefaults, FormKey } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { OutsideSetupError, RegistryNotInstalledError } from './errors'
import { detectSSR, type SSRDetectOptions } from './ssr'

/**
 * Per-Vue-app container for all form state instances. Each
 * `app.use(createChemicalXForms())` call gets its own registry,
 * so the library runs under bare Vue 3 + SSR (via
 * `@vue/server-renderer`) and Nuxt with the same code path.
 *
 * Each form's state lives in `forms: Map<FormKey, FormStore<GenericForm>>`.
 * The type relaxation at storage time is necessary because different
 * forms in the same app have different `Form` generics; callers recover
 * the specific form type via `useForm`'s overloads.
 */

export type SerializedFormData = {
  readonly form: unknown
  /**
   * Schema-driven errors at SSR snapshot time. Replays into the
   * client's `schemaErrors` Map at hydration. Cleared by reset and
   * by submit-success on the client side.
   */
  readonly schemaErrors: ReadonlyArray<readonly [string, unknown]>
  /**
   * User-injected errors at SSR snapshot time (typically populated
   * by `setFieldErrors` / `addFieldErrors` — fed from `parseApiErrors`
   * for server responses — during the server render). Replays into
   * `userErrors` at hydration; persists across client-side schema
   * revalidation and successful submits.
   */
  readonly userErrors: ReadonlyArray<readonly [string, unknown]>
  readonly fields: ReadonlyArray<readonly [string, unknown]>
}

export type PendingHydration = Map<FormKey, SerializedFormData>

export type ChemicalXRegistry = {
  readonly forms: Map<FormKey, FormStore<GenericForm>>
  readonly pendingHydration: PendingHydration
  readonly isSSR: boolean
  /**
   * App-level defaults applied to every `useForm` call. Frozen-empty
   * when the consumer doesn't pass `defaults` — `useAbstractForm`
   * always reads from this slot, so a sentinel beats `?.` everywhere.
   */
  readonly defaults: ChemicalXFormsDefaults
  /**
   * Ref-counts `useForm` consumers per key. Each `useForm` call pairs a
   * `trackConsumer(key)` on mount with the returned dispose on unmount.
   * When the last consumer for a key disposes, the FormStore is evicted
   * from `forms` — preventing long-lived SPAs from accumulating detached
   * form state across page navigations.
   */
  readonly trackConsumer: (key: FormKey) => () => void
  /**
   * Drain async work registered on every live FormStore, then resolve.
   * Used by SSR shutdown helpers and tests that need to deterministically
   * settle pending storage writes before tearing down the app. Eviction
   * via `trackConsumer` already drains per-form; this is the global
   * variant for "drain everything, the app is going away."
   */
  readonly shutdown: () => Promise<void>
}

/** Registry is placed on the Vue app via `app.provide(kChemicalXRegistry, …)`. */
export const kChemicalXRegistry: InjectionKey<ChemicalXRegistry> = Symbol(
  'chemical-x-forms:registry'
)

/**
 * Provides the current form's FormStore to descendants. Installed by
 * `useAbstractForm` after it resolves the state, so any nested component
 * can call `useFormContext()` without prop-threading the form API.
 *
 * Typed as `FormStore<GenericForm>` — the descendant that re-emerges the
 * shape must supply its own `Form` generic, because Vue's InjectionKey
 * erases the generic at the provide/inject boundary.
 */
export const kFormContext: InjectionKey<FormStore<GenericForm>> = Symbol(
  'chemical-x-forms:form-context'
)

/** Also attached to `app._chemicalX` so serialization helpers can access it without setup context. */
declare module 'vue' {
  interface App {
    _chemicalX?: ChemicalXRegistry
  }
}

export type CreateRegistryOptions = SSRDetectOptions & {
  /**
   * App-level defaults stored on the registry and merged into every
   * `useForm` call. Per-form options always win. Omit to use the
   * library-level fallbacks (an empty object is equivalent).
   */
  defaults?: ChemicalXFormsDefaults
}

export function createRegistry(options: CreateRegistryOptions = {}): ChemicalXRegistry {
  const isSSR = detectSSR(options)
  // Frozen so accidental writes downstream throw in dev. Public surface
  // (`createChemicalXForms({ defaults })`) treats this as data, not as
  // a mutation point — there's no public API to update defaults after
  // install, and adding one would invite race conditions with already-
  // mounted forms.
  const defaults: ChemicalXFormsDefaults = Object.freeze({ ...(options.defaults ?? {}) })
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
          void state
            .awaitPendingWrites()
            .catch(() => undefined)
            .finally(() => {
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
    const states = Array.from(forms.values())
    await Promise.allSettled(states.map((state) => state.awaitPendingWrites()))
  }

  return { forms, pendingHydration, isSSR, defaults, trackConsumer, shutdown }
}

/**
 * Inside a component's setup() (or any synchronous code called during
 * setup), returns the current Vue app's registry. Throws a typed error
 * for each of the two distinct failure modes:
 *
 * - `OutsideSetupError` — called from outside a Vue setup context (an
 *   event handler, watcher, or async callback after mount). The fix is
 *   to move the call into setup or mount a child component whose setup
 *   runs the composable.
 *
 * - `RegistryNotInstalledError` — called inside setup, but the plugin
 *   wasn't installed on the app. The fix is `app.use(createChemicalXForms())`.
 *
 * The split matters because pre-disambiguation a single error message
 * mixed both fixes ("install via app.use(...)") even when the plugin
 * was already installed and the real cause was lifecycle.
 */
export function useRegistry(): ChemicalXRegistry {
  const instance = getCurrentInstance()
  if (instance === null) {
    throw new OutsideSetupError()
  }
  const registry = inject(kChemicalXRegistry, null)
  if (registry === null) {
    throw new RegistryNotInstalledError()
  }
  return registry
}

/** Look up the registry from an App reference (used by serialization helpers). */
export function getRegistryFromApp(app: App): ChemicalXRegistry {
  const registry = app._chemicalX
  if (registry === undefined) {
    throw new RegistryNotInstalledError()
  }
  return registry
}

export function attachRegistryToApp(app: App, registry: ChemicalXRegistry): void {
  app.provide(kChemicalXRegistry, registry)
  app._chemicalX = registry
}
