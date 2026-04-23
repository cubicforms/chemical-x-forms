import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  // Multiple published entry points. `module` is the Nuxt module (used via
  // `@chemical-x/forms/nuxt`); `index` is the framework-agnostic core used
  // by bare Vue consumers; the rest are narrow-purpose subpaths.
  entries: ['src/nuxt', 'src/index', 'src/vite', 'src/transforms', 'src/zod-v3'],
  externals: [
    '@vue/compiler-core',
    'nuxt',
    'nuxt/app',
    '@nuxt/kit',
    'vite',
    'vue',
    'zod',
    'typescript',
    /lodash-es.*/,
  ],
  declaration: true,
  failOnWarn: false,
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
