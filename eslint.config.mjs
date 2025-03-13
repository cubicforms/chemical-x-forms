import { createConfigForNuxt } from "@nuxt/eslint-config/flat"

export default createConfigForNuxt({
  features: {
    tooling: true,
    stylistic: {
      arrowParens: false,
      blockSpacing: true,
      braceStyle: "stroustrup",
      commaDangle: "only-multiline",
      flat: true,
      indent: 2,
      jsx: true,
      pluginName: "@stylistic",
      quoteProps: "consistent-as-needed",
      quotes: "double",
      semi: false,
    },
  },
  dirs: {
    src: [
      "./playground",
    ],
  },
})
  .append(
    {
      rules: {
        "semi": "off",
        "import/order": "off",
      },
    },
  )
