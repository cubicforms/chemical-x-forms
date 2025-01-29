// @ts-check
import { createConfigForNuxt } from "@nuxt/eslint-config/flat"

// Run `npx @eslint/config-inspector` to inspect the resolved config interactively
export default createConfigForNuxt({
  features: {
    // Rules for module authors
    tooling: true,
    stylistic: {
      arrowParens: false,
      blockSpacing: true,
      braceStyle: "stroustrup",
      commaDangle: "always-multiline",
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
        // "import/order": [
        //   "error",
        //   {
        //     "groups": [
        //       "builtin",
        //       "external",
        //       "internal",
        //       ["sibling", "parent"],
        //       "index",
        //     ],
        //     "newlines-between": "always",
        //     "alphabetize": {
        //       order: "asc",
        //       caseInsensitive: true,
        //     },
        //   },
        // ],
        "semi": "off",
        "import/order": "off",
      },
    },
  )
