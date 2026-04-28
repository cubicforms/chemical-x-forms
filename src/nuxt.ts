import { addImports, addPlugin, addTypeTemplate, createResolver, defineNuxtModule } from '@nuxt/kit'
import { inputTextAreaNodeTransform } from './runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from './runtime/lib/core/transforms/select-transform'
import { vRegisterHintTransform } from './runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from './runtime/lib/core/transforms/v-register-preamble-transform'
import type { ChemicalXFormsDefaults } from './runtime/types/types-api'

/**
 * Options accepted by `@chemical-x/forms/nuxt` under the `chemicalX`
 * config key.
 *
 * ```ts
 * // nuxt.config.ts
 * export default defineNuxtConfig({
 *   modules: ['@chemical-x/forms/nuxt'],
 *   chemicalX: {
 *     defaults: { fieldValidation: { debounceMs: 100 } },
 *   },
 * })
 * ```
 */
export interface CXModuleOptions {
  /**
   * App-level defaults applied to every `useForm` call. Per-form
   * options always win. See `ChemicalXFormsDefaults` for the
   * supported option set and merge rules.
   */
  defaults?: ChemicalXFormsDefaults
}

/**
 * Shape of the Nuxt public runtime-config slot the module populates.
 * Reach it via `useRuntimeConfig().public.chemicalX` if you need to
 * read the configured defaults outside the form library itself.
 */
export type CXRuntimeConfig = {
  defaults: ChemicalXFormsDefaults
}

export default defineNuxtModule<CXModuleOptions>({
  meta: {
    name: 'chemical-x-forms',
    configKey: 'chemicalX',
    compatibility: {
      nuxt: '>=3.0.0',
    },
  },
  defaults: {},
  setup(_options, nuxt) {
    // vRegisterPreambleTransform MUST come before vRegisterHintTransform
    // — see src/vite.ts for the ordering rationale.
    nuxt.options.vue.compilerOptions.nodeTransforms ??= []
    nuxt.options.vue.compilerOptions.nodeTransforms.push(
      selectNodeTransform,
      inputTextAreaNodeTransform,
      vRegisterPreambleTransform,
      vRegisterHintTransform
    )

    // Publish module options to public runtime config so the plugin can
    // read them at install time on both server and client. Frozen-empty
    // by default — the plugin's merge code reads this slot directly
    // without a `?? {}` guard at every call site.
    const runtimePublic = nuxt.options.runtimeConfig.public as Record<string, unknown>
    runtimePublic['chemicalX'] = {
      defaults: _options.defaults ?? {},
    } satisfies CXRuntimeConfig

    const resolver = createResolver(import.meta.url)

    // Auto-import `useForm` — the framework-agnostic core composable (same
    // binding as `@chemical-x/forms`'s top-level `useForm` export, which
    // is the abstract form composable). Consumers who want the zod-typed
    // wrapper must import from `@chemical-x/forms/zod` or `/zod-v3`
    // explicitly.
    //
    // We point at the public package entry rather than a relative
    // `./runtime/…` path on purpose: in the published package the
    // `src/runtime/composables/use-abstract-form` path has no matching
    // `dist/runtime/…` file (build.config's entries don't include it),
    // so a `resolver.resolve(...)` would raise ENOENT at Nuxt's auto-
    // import step. Importing from `@chemical-x/forms` resolves through
    // the shared chunk, identical to what `@chemical-x/forms/zod`
    // consumers bundle — single registry instance across both import
    // surfaces.
    addImports([{ name: 'useForm', from: '@chemical-x/forms' }])

    // Plugin that installs `createChemicalXForms()` on the Vue app and
    // wires the payload serialize/hydrate bridge. Uses a physical
    // `src/runtime/plugins/chemical-x.ts` file (shipped to
    // `dist/runtime/plugins/chemical-x.mjs` via an explicit entry in
    // build.config.ts) rather than an inline plugin template, because a
    // template's `import { createChemicalXForms } from '@chemical-x/forms'`
    // resolves through the `@chemical-x/forms` package entry — which in
    // local dev (`unbuild --stub`) is a jiti runtime transpiler whose
    // `node:module`/`createRequire` imports Nitro's Rollup build cannot
    // bundle. A physical file lets Nitro follow its imports directly
    // (TS source in dev, ESM in the published package), avoiding the
    // jiti indirection entirely. Unbuild's shared-chunk splitter keeps
    // `core/plugin` + `core/serialize` deduplicated with `src/zod` /
    // `src/index`, so there's still only one `registry` module at runtime.
    //
    // `addPlugin` defaults to PREPEND so the plugin runs before any
    // user plugin / page; `enforce: 'pre'` inside the plugin body makes
    // that ordering explicit at the Nuxt-plugin layer too. Together
    // they guarantee the registry is installed (and SSR payload staged
    // into `pendingHydration`) before any `useForm` call runs.
    addPlugin({
      src: resolver.resolve('./runtime/plugins/chemical-x'),
    })

    // v-register directive type. The directive itself is globally
    // registered by `createChemicalXForms().install(app)` in the plugin
    // above; this template only publishes the type so that
    // `<input v-register="…">` type-checks in consumer SFCs.
    addTypeTemplate({
      filename: 'types/v-register.d.ts',
      getContents: () => `// Generated by @chemical-x/forms
import type { ObjectDirective } from "vue"
import type { RegisterDirective } from "@chemical-x/forms/types"

declare module "vue" {
  interface GlobalDirectives {
    /**
     * The \`v-register\` directive. Binds a form field to a native
     * input, select, textarea, checkbox, or radio:
     *
     * \`\`\`vue
     * <input v-register="form.register('email')" />
     * \`\`\`
     *
     * Modifier support varies by element:
     *   - text / number / textarea: \`.lazy\`, \`.trim\`, \`.number\`
     *   - select: \`.number\`
     *   - checkbox / radio: none
     *
     * See \`RegisterDirective\` for full usage and per-modifier
     * semantics.
     */
    vRegister: RegisterDirective
  }
}

export { }`,
    })
  },
})
