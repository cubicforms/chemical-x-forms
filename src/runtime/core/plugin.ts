import type { App, Plugin } from 'vue'
import { attachRegistryToApp, createRegistry } from './registry'
import { vRegister } from './directive'
import type { SSRDetectOptions } from './ssr'

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
}

export function createChemicalXForms(options: ChemicalXFormsPluginOptions = {}): Plugin {
  const plugin: Plugin = {
    install(app: App) {
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
