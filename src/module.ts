import { addImportsDir, addPlugin, createResolver, defineNuxtModule } from "@nuxt/kit"

// Module options TypeScript interface definition
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModuleOptions {}

export default defineNuxtModule<ModuleOptions>({
	meta: {
		name: "chemical-x-forms",
		configKey: "myModule",
	},
	// Default configuration options of the Nuxt module
	defaults: {
	},
	setup(_options, _nuxt) {
		const resolver = createResolver(import.meta.url)

		// Do not add the extension since the `.ts` will be transpiled to `.mjs` after `npm run prepack`
		addPlugin(resolver.resolve("./runtime/plugin"))

		addImportsDir(resolver.resolve("./runtime/composables"))
	},
})
