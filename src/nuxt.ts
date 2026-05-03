import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { addImports, addPlugin, addTypeTemplate, createResolver, defineNuxtModule } from '@nuxt/kit'
import { inputTextAreaNodeTransform } from './runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from './runtime/lib/core/transforms/select-transform'
import { vRegisterHintTransform } from './runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from './runtime/lib/core/transforms/v-register-preamble-transform'
import type { AttaformDefaults } from './runtime/types/types-api'

/**
 * Options accepted by `attaform/nuxt` under the `attaform`
 * config key.
 *
 * ```ts
 * // nuxt.config.ts
 * export default defineNuxtConfig({
 *   modules: ['attaform/nuxt'],
 *   attaform: {
 *     defaults: { debounceMs: 100 },
 *   },
 * })
 * ```
 */
export interface CXModuleOptions {
  /**
   * App-level defaults applied to every `useForm` call. Per-form
   * options always win. See `AttaformDefaults` for the
   * supported option set and merge rules.
   */
  defaults?: AttaformDefaults
}

/**
 * Shape of the Nuxt public runtime-config slot the module populates.
 * Reach it via `useRuntimeConfig().public.attaform` if you need to
 * read the configured defaults outside the form library itself.
 */
export type CXRuntimeConfig = {
  defaults: AttaformDefaults
}

/**
 * Whether `specifier` is resolvable using ESM resolution from either the
 * consumer's project root or attaform's own module location. Returning
 * true matches what Vite's resolver would do for `optimizeDeps.include`,
 * so a true here means Vite will pre-bundle the dep without warning.
 *
 * Why two probe locations:
 *   - Consumer-rootDir probe finds direct deps + their declared peers
 *     (the standard pnpm strict-isolation visibility).
 *   - attaform-module probe finds peers attaform itself declares —
 *     specifically the optional `@vue/devtools-api`, which lands in
 *     attaform's own node_modules tree (or pnpm virtual store) when
 *     installed, even if the consumer never references it directly.
 *
 * Why ESM resolution (`import.meta.resolve`) rather than CJS
 * (`createRequire(...).resolve`):
 *   - attaform's exports map declares only `import` conditions for
 *     non-`/nuxt` entries. CJS resolve hits ERR_PACKAGE_PATH_NOT_EXPORTED
 *     for `attaform` and its sub-entries.
 *   - pnpm strict isolation hides hoisted transitives behind the
 *     virtual store. CJS resolve walks the bare node_modules chain and
 *     misses them; ESM resolve follows pnpm's symlinks correctly.
 *   - `import.meta.resolve(spec, parentURL)` is sync and stable in
 *     Node 20.6+, which attaform already requires (engines.node).
 */
function isResolvableForVite(specifier: string, consumerRootDir: string): boolean {
  const consumerURL = pathToFileURL(join(consumerRootDir, 'package.json')).href
  return canResolve(specifier, consumerURL) || canResolve(specifier, import.meta.url)
}

function canResolve(specifier: string, fromURL: string): boolean {
  try {
    import.meta.resolve(specifier, fromURL)
    return true
  } catch {
    return false
  }
}

export default defineNuxtModule<CXModuleOptions>({
  meta: {
    name: 'attaform',
    configKey: 'attaform',
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
    runtimePublic['attaform'] = {
      defaults: _options.defaults ?? {},
    } satisfies CXRuntimeConfig

    // Force-include attaform's own peers that Vite's startup crawl
    // tends to miss for Nuxt projects. Vite scans `index.html` + the
    // statically-known entry points but doesn't deeply follow into
    // pages that get loaded via Nuxt's dynamic router; deps imported
    // exclusively from page chunks are discovered when the page first
    // requests, the optimizer rebundles, and Vite silently broadcasts
    // `{"type":"full-reload","path":"*"}` over the HMR WebSocket — what
    // consumers see as "the page loads, then reloads itself a second
    // later." Vite's own "discovered new dependencies at runtime"
    // warning recommends exactly this remediation.
    //
    // We declare here only deps attaform itself owns the relationship
    // with — `@vue/devtools-api` (attaform's DevTools integration
    // peer) and `zod` (the `/zod` and `/zod-v3` adapter peer). Consumer-
    // side deps (vue-query, immer, etc.) are the consumer's
    // responsibility — they declare them in their own
    // `vite.optimizeDeps.include`. Each push is gated on the spec
    // being resolvable from the consumer's project (or attaform's
    // own module context for attaform's optional peers like
    // devtools-api), so consumers without the optional peer don't see
    // a "failed to resolve" warning at boot.
    nuxt.options.vite.optimizeDeps ??= {}
    nuxt.options.vite.optimizeDeps.include ??= []
    const include = nuxt.options.vite.optimizeDeps.include
    for (const spec of ['@vue/devtools-api', 'zod']) {
      if (!isResolvableForVite(spec, nuxt.options.rootDir)) continue
      if (!include.includes(spec)) include.push(spec)
    }

    const resolver = createResolver(import.meta.url)

    // Auto-import `useForm` — the framework-agnostic core composable (same
    // binding as `attaform`'s top-level `useForm` export, which
    // is the abstract form composable). Consumers who want the zod-typed
    // wrapper must import from `attaform/zod` or `/zod-v3`
    // explicitly.
    //
    // We point at the public package entry rather than a relative
    // `./runtime/…` path on purpose: in the published package the
    // `src/runtime/composables/use-abstract-form` path has no matching
    // `dist/runtime/…` file (build.config's entries don't include it),
    // so a `resolver.resolve(...)` would raise ENOENT at Nuxt's auto-
    // import step. Importing from `attaform` resolves through
    // the shared chunk, identical to what `attaform/zod`
    // consumers bundle — single registry instance across both import
    // surfaces.
    addImports([{ name: 'useForm', from: 'attaform' }])

    // Plugin that installs `createAttaform()` on the Vue app and
    // wires the payload serialize/hydrate bridge. Uses a physical
    // `src/runtime/plugins/attaform.ts` file (shipped to
    // `dist/runtime/plugins/attaform.mjs` via an explicit entry in
    // build.config.ts) rather than an inline plugin template, because a
    // template's `import { createAttaform } from 'attaform'`
    // resolves through the `attaform` package entry — which in
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
      src: resolver.resolve('./runtime/plugins/attaform'),
    })

    // v-register directive type. The directive itself is globally
    // registered by `createAttaform().install(app)` in the plugin
    // above; this template only publishes the type so that
    // `<input v-register="…">` type-checks in consumer SFCs.
    addTypeTemplate({
      filename: 'types/v-register.d.ts',
      getContents: () => `// Generated by attaform
import type { ObjectDirective } from "vue"
import type { RegisterDirective } from "attaform/types"

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
     * Also works on custom components whose root is NOT a native
     * input — call \`useRegister()\` in the child's setup to read
     * the parent's binding, then re-bind \`v-register\` onto an
     * inner native element. (When the wrapper's root IS the input
     * itself, attribute fallthrough handles it; \`useRegister\` is
     * unnecessary.) See \`RegisterDirective\` for the full
     * non-input-root example.
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
