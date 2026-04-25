/**
 * `@chemical-x/forms/vite` — Vite plugin that registers the compile-time
 * node transforms with @vitejs/plugin-vue.
 *
 * Usage (bare Vue 3 consumers):
 *
 *   // vite.config.ts
 *   import vue from '@vitejs/plugin-vue'
 *   import { chemicalXForms } from '@chemical-x/forms/vite'
 *
 *   export default defineConfig({
 *     plugins: [vue(), chemicalXForms()],
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
 * custom Vue plugin wrapper, fall back to `@chemical-x/forms/transforms`
 * and wire them yourself.
 */
import type { Plugin } from 'vite'
import { inputTextAreaNodeTransform } from './runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from './runtime/lib/core/transforms/select-transform'
import { vRegisterHintTransform } from './runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from './runtime/lib/core/transforms/v-register-preamble-transform'

/** Reserved for future options. Empty at the moment. */
export type ChemicalXVitePluginOptions = Record<string, never>

interface VitePluginVueApi {
  options?: {
    template?: {
      compilerOptions?: {
        nodeTransforms?: unknown[]
      }
    }
  }
}

export function chemicalXForms(_options: ChemicalXVitePluginOptions = {}): Plugin {
  // Unused-var suppression until options exist.
  void _options
  return {
    name: 'chemical-x-forms',
    enforce: 'pre',
    configResolved(resolved) {
      const vuePlugin = resolved.plugins.find((p) => p.name === 'vite:vue')
      const api = (vuePlugin as unknown as { api?: VitePluginVueApi } | undefined)?.api
      if (api?.options === undefined) {
        throw new Error(
          '[@chemical-x/forms/vite] Could not find @vitejs/plugin-vue. ' +
            'Install @vitejs/plugin-vue and place `chemicalXForms()` after `vue()` in your plugins array.'
        )
      }
      api.options.template ??= {}
      api.options.template.compilerOptions ??= {}
      const existing = api.options.template.compilerOptions.nodeTransforms ?? []
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
