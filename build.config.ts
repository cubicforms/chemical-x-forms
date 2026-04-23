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
    'vite',
    'vue',
    'zod',
    'zod-v3', // aliased dev install; rewritten to 'zod' via rollup.replace below
    'typescript',
    /lodash-es.*/,
  ],
  declaration: true,
  failOnWarn: false,
  rollup: {
    emitCJS: true,
    // `zod-v3` (our dev-install pnpm alias for zod@3) stays external; the
    // post-pack script `scripts/rewrite-zod-aliases.mjs` rewrites the
    // specifier to `zod` in published bundles so consumers install zod@3
    // themselves and the import resolves against their install.
    dts: {
      // respectExternal:false avoids re-rolling type-only deps whose TS shape
      // (e.g. typescript's own nested namespaces) can't be bundled by
      // rollup-plugin-dts.
      respectExternal: false,
    },
    esbuild: {
      format: 'esm',
      target: 'es2020',
      minify: true,
      sourcemap: false,
      treeShaking: true,
      legalComments: 'none',
    },
  },
  sourcemap: false,
  parallel: false,
  name: '@chemical-x/forms',
})
