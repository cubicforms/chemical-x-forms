import type { App, Plugin } from 'vue'
import { __DEV__ } from './dev'
import { attachRegistryToApp, createRegistry } from './registry'
import { vRegister } from './directive'
import type { SSRDetectOptions } from './ssr'
import type { ChemicalXFormsDefaults } from '../types/types-api'

/**
 * Create the `@chemical-x/forms` Vue plugin. Install once per app:
 *
 *   const app = createApp(App)
 *   app.use(createChemicalXForms())
 *
 * Under bare Vue 3, pass `{ ssr: true }` inside `entry-server.ts` so the
 * registry knows the context. Under Nuxt, the Nuxt module (Phase 4) wires
 * this for you via `nuxtApp.vueApp.use(createChemicalXForms({ ssr: import.meta.server }))`.
 *
 * The Vue DevTools integration is lazy-imported and gated on
 * `options.devtools` (default `true`). When the peer dep
 * `@vue/devtools-api` isn't installed (production builds, minimal
 * SSR), the import fails silently — no warnings, no extra bundle.
 */

export type ChemicalXFormsPluginOptions = SSRDetectOptions & {
  /**
   * Enable the Vue DevTools plugin. Default `true` — in production
   * the peer dep `@vue/devtools-api` is typically absent and the
   * lazy import fails silently. Explicitly pass `false` to skip
   * even attempting the import (smaller request-graph overhead if
   * you're shipping a minified build with DevTools disabled).
   */
  devtools?: boolean
  /**
   * App-level defaults applied to every `useForm` call in this app.
   * Per-form options always win. See `ChemicalXFormsDefaults` for the
   * supported option set and the merge semantics.
   */
  defaults?: ChemicalXFormsDefaults
}

export function createChemicalXForms(options: ChemicalXFormsPluginOptions = {}): Plugin {
  const plugin: Plugin = {
    install(app: App) {
      // Idempotent install: a second `app.use(createChemicalXForms())`
      // (e.g. accidentally registered twice in vite.config + nuxt
      // module, or by a higher-order plugin that installs us alongside
      // a consumer's own install) would otherwise overwrite the
      // existing registry — orphaning every FormStore the previous
      // instance had built. Detect via the `_chemicalX` slot
      // `attachRegistryToApp` writes; bail with a dev warning so the
      // duplicate is visible during development.
      if (app._chemicalX !== undefined) {
        if (__DEV__) {
          console.warn(
            '[@chemical-x/forms] createChemicalXForms() install was called more than once on the same app. ' +
              'The second install is a no-op; the existing registry is preserved. ' +
              'Likely cause: registering the plugin twice (vite + nuxt module + manual `app.use`).'
          )
        }
        return
      }
      const registry = createRegistry(options)
      attachRegistryToApp(app, registry)
      app.directive('register', vRegister)

      if (options.devtools !== false && !registry.isSSR) {
        void (async () => {
          try {
            const { setupChemicalXDevtools } = await import('./devtools')
            await setupChemicalXDevtools(app, registry)
          } catch {
            // Missing peer dep / DevTools not attached — silently
            // skip. The form runtime works without DevTools; this is
            // pure-observability tooling.
          }
        })()
      }
    },
  }
  return plugin
}
