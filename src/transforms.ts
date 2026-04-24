/**
 * `@chemical-x/forms/transforms` — raw node-transform functions for
 * advanced bundler integrations.
 *
 * The Vite plugin at `@chemical-x/forms/vite` handles @vitejs/plugin-vue
 * automatically; the Nuxt module at `@chemical-x/forms/nuxt` pushes these
 * into `nuxt.options.vue.compilerOptions.nodeTransforms` for you.
 *
 * Use this subpath only when rolling your own bundler config (esbuild,
 * Rspack, a custom Rollup pipeline, etc.) and needing to add the
 * transforms to Vue's template compiler manually:
 *
 *   import { selectNodeTransform, inputTextAreaNodeTransform } from '@chemical-x/forms/transforms'
 */

export { inputTextAreaNodeTransform } from './runtime/lib/core/transforms/input-text-area-transform'
export { selectNodeTransform } from './runtime/lib/core/transforms/select-transform'
