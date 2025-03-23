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
    },
    esbuild: {
      format: "esm",
      target: "es2020",
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
