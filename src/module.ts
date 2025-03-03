import { addImportsDir, addPlugin, createResolver, defineNuxtModule } from "@nuxt/kit"
import { selectNodeTransform } from "./lib/core/transforms/select-transform"

// Module options TypeScript interface definition
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModuleOptions {}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "chemical-x-forms",
    configKey: "chemicalXForms",
  },
  defaults: {
  },
  setup(_options, _nuxt) {
    _nuxt.options.vue = _nuxt.options.vue || {}
    _nuxt.options.vue.compilerOptions = _nuxt.options.vue.compilerOptions || {}

    _nuxt.options.vue.compilerOptions.nodeTransforms = [
      ...(_nuxt.options.vue.compilerOptions.nodeTransforms || []),
      selectNodeTransform
    ]

    _nuxt.hook("vite:extendConfig", (config) => {
      config.build = config.build || {}
      config.build.rollupOptions = config.build.rollupOptions || {}
      config.build.rollupOptions.external = config.build.rollupOptions.external || []

      if (Array.isArray(config.build.rollupOptions.external)) {
        config.build.rollupOptions.external.push("@vue/compiler-core", "@vue/shared", "@vue/runtime-core", "nuxt", "zod")
      }
    })

    const resolver = createResolver(import.meta.url)
    addImportsDir(resolver.resolve("./runtime/composables"))
    addImportsDir(resolver.resolve("./runtime/adapters/zod"))

    addPlugin(resolver.resolve("./lib/core/plugins/xmodel"))
  },
})
