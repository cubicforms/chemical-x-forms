import { addImportsDir, createResolver, defineNuxtModule } from "@nuxt/kit"
import { vmodelAutoAttrTransform } from "./lib/core/plugins/vmodelAutoAttrTransform"

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
    // Hook into Nuxt's Vite config extension
    _nuxt.hook("vite:extendConfig", (config) => {
      // Make sure nested objects exist
      if (!config.vue) config.vue = {}
      if (!config.vue.template) config.vue.template = {}
      if (!config.vue.template.compilerOptions) {
        config.vue.template.compilerOptions = {}
      }
      if (!config.vue.template.compilerOptions.nodeTransforms) {
        config.vue.template.compilerOptions.nodeTransforms = []
      }

      // Push our transform so it runs on every .vue template
      config.vue.template.compilerOptions.nodeTransforms.push(vmodelAutoAttrTransform)
    })

    const resolver = createResolver(import.meta.url)
    addImportsDir(resolver.resolve("./runtime/composables"))
    addImportsDir(resolver.resolve("./runtime/adapters/zod"))
  },
})
