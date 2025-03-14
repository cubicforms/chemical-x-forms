import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  externals: [
    "@vue/compiler-core",
    "@vue/shared",
    "nuxt",
    "vue",
    "zod",
    "immer",
    /lodash-es.*/,
  ],
  declaration: true,
  failOnWarn: true,
  rollup: {
    dts: {
      respectExternal: true,
      compilerOptions: {
        declaration: true,
        alwaysStrict: true,
        allowImportingTsExtensions: true,
        allowUnusedLabels: false,
        esModuleInterop: true,
        noImplicitAny: true,
        allowArbitraryExtensions: false,
        noEmit: true,
        allowJs: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
      },
    },
    esbuild: {
      format: "esm",
      minify: true,
      sourcemap: false,
      treeShaking: true,
      legalComments: "none",
    },
  },
  sourcemap: false,
  parallel: false,
  name: "@chemical-x/forms",
})
