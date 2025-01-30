import { addImportsDir, createResolver, defineNuxtModule } from "@nuxt/kit"

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
    const resolver = createResolver(import.meta.url)
    addImportsDir(resolver.resolve("./runtime/composables"))
    addImportsDir(resolver.resolve("./runtime/adapters/zod"))
  },
})
