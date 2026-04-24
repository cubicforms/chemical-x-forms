import aliasPlugin from '@rollup/plugin-alias'
import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  // Multiple published entry points. `module` is the Nuxt module (used via
  // `@chemical-x/forms/nuxt`); `index` is the framework-agnostic core used
  // by bare Vue consumers; the rest are narrow-purpose subpaths.
  //
  // `src/runtime/plugins/chemical-x` is a Nuxt-only plugin file that
  // `src/nuxt.ts` registers via `addPlugin({ src: resolver.resolve(...) })`.
  // It needs to exist on disk at `dist/runtime/plugins/chemical-x.mjs` in
  // the published package (otherwise the resolver raises ENOENT and the
  // plugin never installs, leaving `useForm` to throw `Registry not
  // found`). Unbuild's shared-chunk splitter deduplicates `core/plugin` +
  // `core/serialize` across this entry and `src/zod` / `src/index`, so
  // there's only one `registry` module instance at runtime.
  entries: [
    'src/nuxt',
    'src/index',
    'src/vite',
    'src/transforms',
    'src/zod',
    'src/zod-v3',
    'src/runtime/plugins/chemical-x',
  ],
  externals: [
    '@vue/compiler-core',
    'nuxt',
    'nuxt/app',
    '@nuxt/kit',
    '@nuxt/schema', // re-exported by @nuxt/kit; silences "implicitly bundling"
    'vite',
    'vue',
    'zod',
    'typescript',
    /lodash-es.*/,
  ],
  declaration: true,
  failOnWarn: false,
  hooks: {
    'rollup:options'(_ctx, options) {
      // Problem: the source imports `from 'zod-v3'` (our pnpm-alias dev
      // install for zod@3) but published bundles need `from 'zod'` so
      // consumers can install zod@3 themselves. @rollup/plugin-alias does
      // the rewrite — but rollup calls `external(id)` BEFORE the
      // resolveId chain runs, and unbuild's default external warns
      // "Implicitly bundling zod-v3" before plugin-alias has a chance.
      //
      // Fix: wrap the external function so `zod-v3` is explicitly
      // *not*-external (lets resolveId run → plugin-alias rewrites →
      // post-resolve external sees 'zod' and marks it external). The
      // wrapper also silences the implicit-bundling warning for the
      // specific zod-v3 case.
      const originalExternal = options.external
      // Rollup's `external` accepts string / RegExp / array of either /
      // function. Collapse every shape to a boolean match so a future
      // unbuild change that swaps the runtime shape doesn't silently
      // turn every external into a bundled dependency.
      const matchesOriginal = (
        id: string,
        parentId: string | undefined,
        isResolved: boolean
      ): boolean => {
        if (originalExternal === undefined || originalExternal === null) return false
        if (typeof originalExternal === 'function') {
          return Boolean(originalExternal(id, parentId, isResolved))
        }
        const entries = Array.isArray(originalExternal) ? originalExternal : [originalExternal]
        return entries.some((entry) => {
          if (typeof entry === 'string') return entry === id
          if (entry instanceof RegExp) return entry.test(id)
          return false
        })
      }
      options.external = (id, parentId, isResolved) => {
        if (id === 'zod-v3') return false
        return matchesOriginal(id, parentId, isResolved)
      }
      options.plugins = [
        aliasPlugin({ entries: [{ find: 'zod-v3', replacement: 'zod' }] }),
        ...(Array.isArray(options.plugins) ? options.plugins : []),
      ]
    },
  },
  rollup: {
    emitCJS: true,
    dts: {
      // respectExternal:false avoids re-rolling type-only deps whose TS shape
      // (e.g. typescript's own nested namespaces) can't be bundled by
      // rollup-plugin-dts.
      respectExternal: false,
    },
    esbuild: {
      format: 'esm',
      target: 'es2020',
      // Libraries should NOT minify for npm consumers:
      //   - Consumer bundlers (Vite, Webpack, Rollup+Terser) minify in
      //     production mode. Upstream minification saves no bytes.
      //   - Minified output produces useless stack traces
      //     (single-letter identifiers) and hostile `cd node_modules`
      //     debugging for anyone investigating a bug in our code.
      //   - Tarball gzip compression closes most of the on-disk delta
      //     between minified and readable output.
      // Tree-shaking stays on — it drops unreachable code without
      // mangling what remains.
      minify: false,
      sourcemap: true,
      treeShaking: true,
      legalComments: 'inline',
    },
  },
  sourcemap: true,
  parallel: false,
  name: '@chemical-x/forms',
})
