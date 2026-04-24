import aliasPlugin from '@rollup/plugin-alias'
import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  // Multiple published entry points. `module` is the Nuxt module (used via
  // `@chemical-x/forms/nuxt`); `index` is the framework-agnostic core used
  // by bare Vue consumers; the rest are narrow-purpose subpaths.
  entries: ['src/nuxt', 'src/index', 'src/vite', 'src/transforms', 'src/zod', 'src/zod-v3'],
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
      options.external = (id, parentId, isResolved) => {
        if (id === 'zod-v3') return false
        if (typeof originalExternal === 'function') {
          return originalExternal(id, parentId, isResolved)
        }
        return false
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
