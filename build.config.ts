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
    'vite',
    'vue',
    'zod',
    // `zod-v3` is intentionally NOT in externals so that the alias plugin
    // (wired below) sees it in a resolution context and rewrites it to
    // `zod`. If we listed it as external, rollup would short-circuit and
    // emit `from 'zod-v3'` in the bundle.
    'typescript',
    /lodash-es.*/,
  ],
  declaration: true,
  failOnWarn: false,
  hooks: {
    'rollup:options'(_ctx, options) {
      // Prepend the alias plugin so it fires before unbuild's own plugins
      // (notably the externalisation and resolution steps). At resolution
      // time, `zod-v3` rewrites to `zod`; at runtime, the external `zod`
      // resolves against the consumer's installed zod@3.
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
