import type { App, Plugin } from 'vue'
import { __DEV__ } from './dev'
import { attachRegistryToApp, createRegistry, type AttaformRegistry } from './registry'
import { vRegister } from './directive'
import type { SSRDetectOptions } from './ssr'
import type { AttaformDefaults } from '../types/types-api'

/**
 * Options for `createAttaform()`.
 */
export type AttaformPluginOptions = SSRDetectOptions & {
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
   * Per-form options always win. See `AttaformDefaults` for
   * the supported option set and the merge rules.
   *
   * ```ts
   * app.use(
   *   createAttaform({
   *     defaults: { debounceMs: 100 },
   *   })
   * )
   * ```
   */
  defaults?: AttaformDefaults
}

/**
 * Install the form library on a Vue app. Idempotent: a second call
 * for the same `app` is a no-op (with a dev warning when explicit, no
 * warning when triggered by the lazy-install path).
 *
 * Used internally by:
 *  - `createAttaform()` — the explicit plugin install path.
 *  - `ensureAttaformInstalled()` — the lazy-install path triggered by
 *    `useForm` / `injectForm` / `useRegister` when no explicit install
 *    has happened yet.
 *
 * Both paths converge here so the `_attaform` slot, the
 * `kAttaformRegistry` provide, the `v-register` directive, and the
 * devtools attach happen in the same order regardless of how the
 * registry was first attached.
 */
function installAttaformOnApp(
  app: App,
  options: AttaformPluginOptions,
  source: 'explicit' | 'lazy'
): AttaformRegistry {
  // Idempotent install: a second call (e.g. createAttaform() registered
  // twice via vite.config + nuxt module, or createAttaform() after a
  // lazy useForm call) would otherwise overwrite the existing registry —
  // orphaning every FormStore the previous instance had built. Detect
  // via the `_attaform` slot `attachRegistryToApp` writes; bail with a
  // dev warning ONLY for the explicit path, since the lazy path is
  // expected to no-op when the user has already installed explicitly.
  if (app._attaform !== undefined) {
    if (__DEV__ && source === 'explicit') {
      console.warn(
        '[attaform] createAttaform() install was called twice on the same app; ' +
          'the second call is a no-op. ' +
          'Likely cause: registering the plugin via both the Nuxt module AND a manual `app.use(...)`.'
      )
    }
    return app._attaform
  }
  const registry = createRegistry(options)
  attachRegistryToApp(app, registry)
  app.directive('register', vRegister)

  if (options.devtools !== false && !registry.ssr) {
    void (async () => {
      try {
        const { setupAttaformDevtools } = await import('./devtools')
        await setupAttaformDevtools(app, registry)
      } catch {
        // Missing peer dep / DevTools not attached — silently skip.
        // The form runtime works without DevTools; this is pure-
        // observability tooling.
      }
    })()
  }

  return registry
}

/**
 * Lazy-install the form library on a Vue app from inside a setup
 * context. Called by `useForm`, `injectForm`, and `useRegister` so
 * `pnpm install attaform` is the entire setup story for the common
 * CSR case — no `app.use(createAttaform())` required in `main.ts`.
 *
 * If the app already has an attaform registry attached (because the
 * consumer installed `createAttaform({ defaults, devtools })` or the
 * Nuxt module ran), this is a no-op and the existing registry is
 * returned. App-wide options are preserved.
 *
 * SSR helpers (`renderAttaformState`, `hydrateAttaformState`) do NOT
 * use this path — they run outside setup and require explicit
 * `createAttaform()` install.
 */
export function ensureAttaformInstalled(app: App): AttaformRegistry {
  return installAttaformOnApp(app, {}, 'lazy')
}

/**
 * Create the Vue plugin that installs the form library on a Vue
 * application. Required only when you want app-wide options
 * (`defaults`, `devtools: false`, `ssr: true`) — for the default
 * setup, `useForm` / `injectForm` / `useRegister` lazy-install the
 * registry on first use.
 *
 * ```ts
 * import { createApp } from 'vue'
 * import { createAttaform } from 'attaform'
 *
 * createApp(App)
 *   .use(createAttaform({ defaults: { debounceMs: 100 } }))
 *   .mount('#app')
 * ```
 *
 * Under SSR with bare Vue 3, install explicitly with `{ ssr: true }`
 * from your server entry — the SSR serialization helpers
 * (`renderAttaformState` / `hydrateAttaformState`) require an
 * already-attached registry and don't trigger lazy install. Under
 * Nuxt, install via `attaform/nuxt` instead — the Nuxt module wires
 * both server and client automatically.
 *
 * Installing more than once on the same app is a no-op (the second
 * call logs a dev-mode warning).
 */
export function createAttaform(options: AttaformPluginOptions = {}): Plugin {
  const plugin: Plugin = {
    install(app: App) {
      installAttaformOnApp(app, options, 'explicit')
    },
  }
  return plugin
}
