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
 */

export type ChemicalXFormsPluginOptions = SSRDetectOptions

export function createChemicalXForms(options: ChemicalXFormsPluginOptions = {}): Plugin {
  const plugin: Plugin = {
    install(app: App) {
      const registry = createRegistry(options)
      attachRegistryToApp(app, registry)
      app.directive('register', vRegister)
    },
  }
  return plugin
}
