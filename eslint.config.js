import js from '@eslint/js'
import nuxt from 'eslint-plugin-nuxt'
import prettier from 'eslint-plugin-prettier'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

import fs from 'fs'
import path from 'path'

/**
 * Decide whether to skip cache based on --no-cache flag
 * i.e. `pnpm lint:fix --no-cache`
 */
const noCache = process.argv.includes('--no-cache')
let cachedNuxtGlobals = null // cached per run, if called multiple times

/**
 * Dynamically parse .nuxt/imports.d.ts to extract auto-imported globals.
 * Caches by default for faster subsequent runs.
 */
function getNuxtGlobals() {
  if (cachedNuxtGlobals && !noCache) {
    return cachedNuxtGlobals
  }

  const finalGlobals = {}
  let filePath = ''
  try {
    filePath = path.resolve(process.cwd(), '.nuxt', 'imports.d.ts')
    const fileContent = fs.readFileSync(filePath, 'utf8')

    // Match export statements like: export { a, b, c } from '...';
    const exportRegex = /export\s*{([^}]+)}/g
    let match
    while ((match = exportRegex.exec(fileContent)) !== null) {
      const identifiers = match[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      for (const id of identifiers) {
        // If there's aliasing (e.g. "foo as bar"), extract the original name
        const name = id.split(/\s+as\s+/)[0].trim()
        finalGlobals[name] = 'readonly'
      }
    }
  } catch (error) {
    const pathDetail = filePath ? ` at ${filePath}` : ''
    console.error(
      `Could not read imports.d.ts${pathDetail}. Have you generated Nuxt types?\nError:`,
      error
    )
    return {}
  }

  cachedNuxtGlobals = finalGlobals
  return finalGlobals
}

const nuxtGlobals = getNuxtGlobals()

/** Common parser options for TypeScript + Vue files */
const commonParserOptions = {
  ecmaVersion: 2022,
  sourceType: 'module',
  project: './tsconfig.json',
  extraFileExtensions: ['.vue'],
}

/** Merge built-in globals, Node/browser globals, and Nuxt auto-imports */
const commonGlobals = {
  ...globals.browser,
  ...globals.node,
  ...nuxtGlobals,
}

export default [
  // Base JS config
  js.configs.recommended,

  // TypeScript recommended config
  ...tseslint.configs.recommended,

  // Vue3 config
  {
    files: ['**/*.vue'],
    plugins: { vue },
    rules: {
      ...(vue.configs.recommended.rules ?? {}),
      'vue/multi-word-component-names': 'error',
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      'vue/component-definition-name-casing': ['error', 'PascalCase'],
      'vue/custom-event-name-casing': ['error', 'camelCase'],
      'vue/define-macros-order': ['error', { order: ['defineProps', 'defineEmits'] }],
      'vue/html-comment-content-spacing': ['error', 'always'],
      'vue/padding-line-between-blocks': ['error', 'always'],
      'vue/prefer-separate-static-class': 'error',
      'vue/block-order': [
        'error',
        {
          order: ['script', 'template', 'style'],
        },
      ],
    },
  },

  // Nuxt config
  {
    plugins: { nuxt },
    languageOptions: {
      // Typically not needed for .nuxt/ auto-generated files
      globals: 'readonly',
    },
  },

  // File structure rules
  {
    files: ['**/*.{js,ts,vue}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../pages/*', './pages/*'],
              message: 'Components should not import from pages',
            },
            {
              group: ['../components/*', './components/*'],
              message: 'Utils should not import from components',
            },
            {
              group: ['../composables/*', './composables/*'],
              message: 'Pages should not import from composables directly',
            },
          ],
        },
      ],
    },
  },

  // TypeScript-specific rules for ts/tsx/vue files
  {
    files: ['**/*.{ts,tsx,vue}'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ...commonParserOptions,
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Prettier integration
  {
    files: ['**/*.{js,ts,vue}'],
    plugins: { prettier },
    languageOptions: {
      globals: commonGlobals,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      camelcase: 'error',
      'spaced-comment': ['error', 'always'],
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
      'eol-last': ['error', 'always'],
      'no-restricted-imports': [
        'error',
        {
          patterns: ['lodash-es/*'],
        },
      ],
    },
  },

  // File/folder ignores (Flat Config doesn't respect .eslintignore by default)
  {
    ignores: [
      '**/node_modules/**',
      '**/.nuxt/**',
      '**/dist/**',
      '**/coverage/**',
      '.prettierrc.cjs',
    ],
  },
]
