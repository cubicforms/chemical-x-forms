import type { App, InjectionKey } from 'vue'
import { getCurrentInstance, inject, shallowReactive } from 'vue'
import type { FormKey } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormState } from './create-form-state'
import { RegistryNotInstalledError } from './errors'
import { detectSSR, type SSRDetectOptions } from './ssr'

/**
 * Per-Vue-app container for all form state instances. Replaces the
 * singleton `useState(key, ...)` pattern that tied the pre-rewrite runtime
 * to Nuxt. Each `app.use(createChemicalXForms())` call gets its own
 * registry — making the library work under bare Vue 3 + SSR (via
 * `@vue/server-renderer`) as a first-class target, not just Nuxt.
 *
 * Each form's state lives in `forms: Map<FormKey, FormState<GenericForm>>`.
 * The type relaxation at storage time is necessary because different
 * forms in the same app have different `Form` generics; callers recover
 * the specific form type via `useForm`'s overloads.
 */

export type SerializedFormData = {
  readonly form: unknown
  readonly errors: ReadonlyArray<readonly [string, unknown]>
  readonly fields: ReadonlyArray<readonly [string, unknown]>
}

export type PendingHydration = Map<FormKey, SerializedFormData>

export type ChemicalXRegistry = {
  readonly forms: Map<FormKey, FormState<GenericForm>>
  readonly pendingHydration: PendingHydration
  readonly isSSR: boolean
}

/** Registry is placed on the Vue app via `app.provide(kChemicalXRegistry, …)`. */
export const kChemicalXRegistry: InjectionKey<ChemicalXRegistry> = Symbol(
  'chemical-x-forms:registry'
)

/** Also attached to `app._chemicalX` so serialization helpers can access it without setup context. */
declare module 'vue' {
  interface App {
    _chemicalX?: ChemicalXRegistry
  }
}

export function createRegistry(options: SSRDetectOptions = {}): ChemicalXRegistry {
  const isSSR = detectSSR(options)
  // The outer object is plain (it holds references we never rebind); inner
  // Maps are reactive via Vue's collection handlers so per-key reads track
  // per-key. `shallowReactive` avoids Vue's deep Ref-unwrapping, which would
  // mangle FormState.form's Ref<F> type into F on lookup.
  const forms = shallowReactive(new Map<FormKey, FormState<GenericForm>>())
  const pendingHydration = shallowReactive(new Map<FormKey, SerializedFormData>())
  return { forms, pendingHydration, isSSR }
}

/**
 * Inside a component's setup() (or any synchronous code called during
 * setup), returns the current Vue app's registry. Throws a clear error
 * when the plugin isn't installed.
 */
export function useRegistry(): ChemicalXRegistry {
  const instance = getCurrentInstance()
  if (instance === null) {
    throw new RegistryNotInstalledError()
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
