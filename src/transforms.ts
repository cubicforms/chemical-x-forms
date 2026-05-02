/**
 * `decant/transforms` — raw node-transform functions for
 * advanced bundler integrations.
 *
 * The Vite plugin at `decant/vite` handles @vitejs/plugin-vue
 * automatically; the Nuxt module at `decant/nuxt` pushes these
 * into `nuxt.options.vue.compilerOptions.nodeTransforms` for you.
 *
 * Use this subpath only when rolling your own bundler config (esbuild,
 * Rspack, a custom Rollup pipeline, etc.) and needing to add the
 * transforms to Vue's template compiler manually:
 *
 *   import {
 *     selectNodeTransform,
 *     inputTextAreaNodeTransform,
 *     vRegisterPreambleTransform,
 *     vRegisterHintTransform,
 *   } from 'decant/transforms'
 *
 * Order matters: `vRegisterPreambleTransform` MUST run before
 * `vRegisterHintTransform`. The preamble's pre-order captures each
 * `v-register` expression in its un-wrapped form; the hint transform
 * then mutates the directive's expression to wrap it in the
 * optimistic-mark IIFE. Reverse order would leak the IIFE wrapper
 * into the preamble's collected text.
 */

export { inputTextAreaNodeTransform } from './runtime/lib/core/transforms/input-text-area-transform'
export { selectNodeTransform } from './runtime/lib/core/transforms/select-transform'
export { vRegisterHintTransform } from './runtime/lib/core/transforms/v-register-hint-transform'
export { vRegisterPreambleTransform } from './runtime/lib/core/transforms/v-register-preamble-transform'
