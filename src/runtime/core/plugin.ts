import type { App, Plugin } from 'vue'
import { __DEV__ } from './dev'
import { attachRegistryToApp, createRegistry } from './registry'
import { vRegister } from './directive'
import type { SSRDetectOptions } from './ssr'
import type { DecantDefaults } from '../types/types-api'

/**
 * Options for `createDecant()`.
 */
export type DecantPluginOptions = SSRDetectOptions & {
  /**
   * Whether to install the Vue DevTools integration. Default `true`.
   * The DevTools peer dependency is loaded lazily — in production
   * builds where it's absent, the import fails silently and no
   * extra bundle is shipped. Pass `false` to skip even attempting
   * the import.
   */
  devtools?: boolean
  /**
   * App-level defaults applied to every `useForm` call in this app.
   * Per-form options always win. See `DecantDefaults` for
   * the supported option set and the merge rules.
   *
   * ```ts
   * app.use(
   *   createDecant({
   *     defaults: { debounceMs: 100 },
   *   })
   * )
   * ```
   */
  defaults?: DecantDefaults
}

/**
 * Create the Vue plugin that installs the form library on a Vue
 * application. Call once per app, then `app.use(...)` the result.
 *
 * ```ts
 * import { createApp } from 'vue'
 * import { createDecant } from 'decant'
 *
 * createApp(App)
 *   .use(createDecant())
 *   .mount('#app')
 * ```
 *
 * Under SSR with bare Vue 3, pass `{ ssr: true }` from your server
 * entry. Under Nuxt, install via `decant/nuxt` instead —
 * the Nuxt module wires both server and client automatically.
 *
 * Installing more than once on the same app is a no-op (the second
 * call logs a dev-mode warning).
 */
export function createDecant(options: DecantPluginOptions = {}): Plugin {
  const plugin: Plugin = {
    install(app: App) {
      // Idempotent install: a second `app.use(createDecant())`
      // (e.g. accidentally registered twice in vite.config + nuxt
      // module, or by a higher-order plugin that installs us alongside
      // a consumer's own install) would otherwise overwrite the
      // existing registry — orphaning every FormStore the previous
      // instance had built. Detect via the `_decant` slot
      // `attachRegistryToApp` writes; bail with a dev warning so the
      // duplicate is visible during development.
      if (app._decant !== undefined) {
        if (__DEV__) {
          console.warn(
            '[decant] createDecant() install was called twice on the same app; ' +
              'the second call is a no-op. ' +
              'Likely cause: registering the plugin via both the Nuxt module AND a manual `app.use(...)`.'
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
            const { setupDecantDevtools } = await import('./devtools')
            await setupDecantDevtools(app, registry)
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
