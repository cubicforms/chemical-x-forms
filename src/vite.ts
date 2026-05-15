/**
 * `attaform/vite` — Vite plugin that wires the compile-time node
 * transforms with @vitejs/plugin-vue AND rewrites `attaform/zod`
 * imports to either `attaform/zod-v3` or `attaform/zod-v4` at build
 * time, based on the consumer's installed Zod major. The result is
 * one Zod adapter shipped per bundle, with no manual subpath choice.
 *
 * Usage (bare Vue 3 consumers):
 *
 *   // vite.config.ts
 *   import vue from '@vitejs/plugin-vue'
 *   import { attaform } from 'attaform/vite'
 *
 *   export default defineConfig({
 *     plugins: [vue(), attaform()],
 *   })
 *
 * The transforms inject `:value`, `:checked`, and `:selected` bindings
 * into elements that use the `v-register` directive — load-bearing for
 * SSR initial-render correctness. Omitting this plugin under CSR is
 * tolerable (one-frame flash on mount); omitting it under SSR produces
 * visibly wrong initial HTML.
 *
 * The `resolveZodAlias` option (default `true`) controls the build-time
 * `attaform/zod` rewrite. Set to `false` if your project intentionally
 * mixes Zod versions or has a non-standard Zod resolution; the unified
 * `attaform/zod` entry's runtime dispatch covers that case at the cost
 * of bundling both adapters.
 *
 * Implementation note: this plugin mutates @vitejs/plugin-vue's options
 * via the documented but somewhat informal `api.options` surface used
 * by VueUse, Vite PWA, and other Vue ecosystem plugins. If you're
 * using a custom Vue plugin wrapper, fall back to `attaform/transforms`
 * and wire them yourself.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { inputTextAreaNodeTransform } from './runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from './runtime/lib/core/transforms/select-transform'
import { vRegisterHintTransform } from './runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from './runtime/lib/core/transforms/v-register-preamble-transform'

/** Options for `attaform()`. */
export interface AttaformVitePluginOptions {
  /**
   * Rewrite `attaform/zod` imports at build time to either
   * `attaform/zod-v3` or `attaform/zod-v4`, based on the consumer's
   * installed Zod major. Default `true` — produces a leaner bundle
   * for the common case of one Zod version per project.
   *
   * Set to `false` to fall through to the unified entry's runtime
   * dispatch. Useful when:
   *   - your project intentionally has both `zod` and `zod-v3`
   *     installed (e.g. via a pnpm alias) and the schema-shape
   *     dispatch is the right behavior;
   *   - your monorepo's Zod resolution is non-standard and the
   *     plugin's detection (`import.meta.resolve('zod/package.json')`)
   *     would land on the wrong copy.
   */
  resolveZodAlias?: boolean
}

interface VitePluginVueApi {
  options?: {
    template?: {
      compilerOptions?: {
        nodeTransforms?: unknown[]
      }
    }
  }
}

const ZOD_UNIFIED_SPECIFIER = 'attaform/zod'
const ZOD_V3_SPECIFIER = 'attaform/zod-v3'
const ZOD_V4_SPECIFIER = 'attaform/zod-v4'

/**
 * Read the consumer's installed Zod major by resolving
 * `zod/package.json` from their project root. ESM resolution
 * (`import.meta.resolve`) is sync and stable on Node 20.6+, follows
 * pnpm symlinks, and works with attaform's ESM-only `exports` map.
 *
 * Returns:
 *  - `{ major: 3 | 4 }` when zod is resolvable AND its `version`
 *    field parses to a known major;
 *  - `{ major: 'missing' }` when zod can't be resolved at all;
 *  - `{ major: 'unknown' }` for any other failure (corrupted
 *    package.json, unexpected version string, monorepo edge case).
 */
function detectZodMajor(
  consumerRootDir: string
): { major: 3 } | { major: 4 } | { major: 'missing' } | { major: 'unknown' } {
  const consumerURL = pathToFileURL(join(consumerRootDir, 'package.json')).href
  let resolved: string
  try {
    resolved = import.meta.resolve('zod/package.json', consumerURL)
  } catch {
    return { major: 'missing' }
  }
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(resolved), 'utf8')) as { version?: unknown }
    const version = pkg.version
    if (typeof version !== 'string') return { major: 'unknown' }
    const major = Number.parseInt(version.split('.')[0] ?? '', 10)
    if (major === 3) return { major: 3 }
    if (major === 4) return { major: 4 }
    return { major: 'unknown' }
  } catch {
    return { major: 'unknown' }
  }
}

/**
 * Vite plugin that wires the form library's compile-time template
 * transforms into `@vitejs/plugin-vue` and rewrites the unified
 * `attaform/zod` import to the matching adapter subpath. Required
 * for SSR and for hydration accuracy under bare Vue 3.
 *
 * ```ts
 * // vite.config.ts
 * import vue from '@vitejs/plugin-vue'
 * import { attaform } from 'attaform/vite'
 *
 * export default defineConfig({
 *   plugins: [vue(), attaform()],
 * })
 * ```
 *
 * Place the call after `vue()` in the plugins array. Nuxt projects
 * don't need this — `attaform/nuxt` handles it.
 */
export function attaform(options: AttaformVitePluginOptions = {}): Plugin {
  const resolveZodAlias = options.resolveZodAlias !== false
  // Resolution is computed once per plugin instance from the resolved
  // Vite root in `configResolved`, then cached for every `resolveId`
  // call (the hook fires many times during dev/build).
  let aliasTarget: string | null = null
  let warnedAboutDetection = false

  return {
    name: 'attaform',
    enforce: 'pre',
    configResolved(resolved) {
      const vuePlugin = resolved.plugins.find((p) => p.name === 'vite:vue')
      // Two distinct failure modes — separate error messages so the
      // consumer's fix is unambiguous:
      //   1. plugin not in the plugins array → install + register vue()
      //   2. plugin found but version-incompatible (no `api.options`) →
      //      version mismatch with @vitejs/plugin-vue
      if (vuePlugin === undefined) {
        throw new Error(
          '[attaform/vite] @vitejs/plugin-vue is not installed (or not registered before attaform()). ' +
            'Install @vitejs/plugin-vue and place `attaform()` after `vue()` in your plugins array.'
        )
      }
      const api = (vuePlugin as unknown as { api?: VitePluginVueApi }).api
      if (api?.options === undefined) {
        throw new Error(
          '[attaform/vite] Found @vitejs/plugin-vue but it does not expose `api.options`. ' +
            'This usually means a version-incompatible @vitejs/plugin-vue (or a wrapper plugin re-exporting it). ' +
            'Pin @vitejs/plugin-vue to a version compatible with the documented `api.options.template.compilerOptions.nodeTransforms` surface.'
        )
      }
      api.options.template ??= {}
      api.options.template.compilerOptions ??= {}
      const existing = api.options.template.compilerOptions.nodeTransforms ?? []
      // Idempotent install: if a previous attaform() invocation
      // (vite + nuxt module + manual `plugins: [attaform()]`) has
      // already pushed our transforms, skip — re-pushing would double
      // every binding the AST emits, breaking the IIFE-wrapping
      // invariants downstream transforms depend on. We detect the
      // sentinel via reference equality; user-supplied transforms with
      // the same name don't collide.
      if (!existing.includes(vRegisterPreambleTransform as unknown)) {
        // vRegisterPreambleTransform MUST come before vRegisterHintTransform
        // — the preamble's pre-order captures each `v-register` expression
        // in its raw (un-wrapped) form, and the hint then mutates the same
        // directive's `exp` to wrap it. Reversing the order would have the
        // preamble pick up an already-wrapped IIFE, double-wrapping it
        // when injected at the root.
        api.options.template.compilerOptions.nodeTransforms = [
          ...existing,
          selectNodeTransform,
          inputTextAreaNodeTransform,
          vRegisterPreambleTransform,
          vRegisterHintTransform,
        ]
      }

      // Build-time alias resolution. Skip cleanly when the user opted
      // out so consumers with non-standard Zod setups don't see a
      // "zod is not installed" error from this plugin.
      if (!resolveZodAlias) return
      const detection = detectZodMajor(resolved.root)
      if (detection.major === 'missing') {
        throw new Error(
          '[attaform/vite] zod is not installed. attaform requires zod as a peer dependency. ' +
            'Install `zod@^3` or `zod@^4`, OR pass `attaform({ resolveZodAlias: false })` ' +
            'to keep the runtime-dispatch unified entry (and silence this check).'
        )
      }
      if (detection.major === 'unknown') {
        // Detection landed on a zod resolution but couldn't classify
        // the version — log once and fall through to runtime dispatch.
        // The build still works; the consumer just ships both adapters.
        if (!warnedAboutDetection) {
          warnedAboutDetection = true
          console.warn(
            '[attaform/vite] Could not classify the installed Zod major (corrupted package.json, ' +
              'monorepo edge case, or an unexpected version string). Falling through to runtime ' +
              'dispatch — both Zod adapters will ship in the bundle. ' +
              'Pass `attaform({ resolveZodAlias: false })` to silence this warning.'
          )
        }
        return
      }
      aliasTarget = detection.major === 4 ? ZOD_V4_SPECIFIER : ZOD_V3_SPECIFIER
    },
    configureServer(server) {
      // Dev-only middleware that serves the Nuxt DevTools overlay panel's
      // iframe HTML at `/_attaform_devtools`. The middleware lives at the
      // Vite layer so the route is intercepted BEFORE vue-router sees it —
      // crucial for consumers using `app.vue`-only (no `pages/` directory).
      // Earlier prototypes injected a Nuxt page via `extendPages`, which
      // implicitly activates Nuxt's pages mode and broke app.vue-only
      // setups by stranding `/` without a NuxtPage host.
      //
      // The HTML pulls Vue + the panel component via bare specifiers;
      // `transformIndexHtml` rewrites them through Vite's resolver so the
      // browser-side `<script type="module">` runs cleanly. Production
      // builds skip the middleware entirely — `configureServer` only
      // fires for the dev server.
      server.middlewares.use(
        '/_attaform_devtools',
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        async (req, res, next) => {
          if (req.method !== 'GET') {
            next()
            return
          }
          try {
            const rawHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Attaform DevTools</title>
    <style>
      html, body { height: 100%; margin: 0; background: #0f172a; }
      @media (prefers-color-scheme: light) {
        html, body { background: #ffffff; }
      }
      #atf-loading {
        padding: 1rem;
        color: #94a3b8;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <div id="atf-app"><div id="atf-loading">Loading Attaform DevTools…</div></div>
    <script type="module">
      import { createApp, h } from 'vue'
      import AttaformDevtoolsPanel from 'attaform/devtools-panel'

      // The panel runs inside Nuxt DevTools' iframe; the bridge lives on
      // the parent frame (the consumer's main page). When the page is
      // opened directly in a browser tab (debugging), parent === self
      // and we fall back to the same-window bridge.
      const start = Date.now()
      function bootstrap() {
        const owner = window.parent && window.parent !== window
          ? window.parent
          : window
        const bridge = owner.__attaform_devtools__
        if (bridge !== undefined) {
          const root = document.getElementById('atf-app')
          root.innerHTML = ''
          createApp({ render: () => h(AttaformDevtoolsPanel, { bridge }) }).mount(root)
          return
        }
        if (Date.now() - start < 2000) {
          setTimeout(bootstrap, 50)
          return
        }
        document.getElementById('atf-loading').textContent =
          'Attaform devtools bridge not found. The host app may not have the Nuxt module installed.'
      }
      bootstrap()
    </script>
  </body>
</html>`
            const html = await server.transformIndexHtml('/_attaform_devtools', rawHtml)
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(html)
          } catch (err) {
            next(err)
          }
        }
      )
    },
    async resolveId(source, importer) {
      // Intercept ONLY the exact unified specifier. Explicit subpaths
      // (`attaform/zod-v3`, `attaform/zod-v4`) and the root entry
      // (`attaform`) pass through unchanged — that's the documented
      // escape hatch for power users.
      if (!resolveZodAlias) return null
      if (aliasTarget === null) return null
      if (source !== ZOD_UNIFIED_SPECIFIER) return null
      // Returning the bare specifier directly would freeze it as the
      // resolved id — Vite then ships `/@id/attaform/zod-v4` to the
      // browser and 404s because no plugin loads that virtual URL.
      // Re-run the new specifier through the resolver chain so the
      // matching subpath export lands as a real file path.
      // `skipSelf: true` is defensive — our filter rejects the rewritten
      // target anyway, but keeps the hook reentrant under future edits.
      return this.resolve(aliasTarget, importer, { skipSelf: true })
    },
  }
}
