/**
 * `attaform/vite` — Vite plugin that registers the compile-time
 * node transforms with @vitejs/plugin-vue.
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
 * The transforms inject `:value`, `:checked`, and `:selected` bindings into
 * elements that use the `v-register` directive — load-bearing for SSR
 * initial-render correctness. Omitting this plugin under CSR is tolerable
 * (one-frame flash on mount); omitting it under SSR produces visibly wrong
 * initial HTML.
 *
 * Implementation note: this plugin mutates @vitejs/plugin-vue's options via
 * the documented but somewhat informal `api.options` surface used by
 * VueUse, Vite PWA, and other Vue ecosystem plugins. If you're using a
 * custom Vue plugin wrapper, fall back to `attaform/transforms`
 * and wire them yourself.
 */
import type { Plugin } from 'vite'
import { inputTextAreaNodeTransform } from './runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from './runtime/lib/core/transforms/select-transform'
import { vRegisterHintTransform } from './runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from './runtime/lib/core/transforms/v-register-preamble-transform'

/** Options for `attaform()`. Reserved for future use; pass `{}` or omit. */
export type AttaformVitePluginOptions = Record<string, never>

interface VitePluginVueApi {
  options?: {
    template?: {
      compilerOptions?: {
        nodeTransforms?: unknown[]
      }
    }
  }
}

/**
 * Vite plugin that wires the form library's compile-time template
 * transforms into `@vitejs/plugin-vue`. Required for SSR and for
 * hydration accuracy under bare Vue 3.
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
export function attaform(_options: AttaformVitePluginOptions = {}): Plugin {
  // Unused-var suppression until options exist.
  void _options
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
      if (existing.includes(vRegisterPreambleTransform as unknown)) return
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
    },
  }
}
