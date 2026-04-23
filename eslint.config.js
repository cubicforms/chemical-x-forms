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

  // TypeScript-specific rules for ts/tsx/vue files (universal)
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
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
    },
  },

  // Strict rules scoped to new-code paths. Existing paths (src/runtime/lib/**,
  // src/runtime/plugins/**, src/runtime/composables/**, src/runtime/adapters/zod/**,
  // and the current test files) are scheduled for rewrite in Phases 1-4; they'll
  // inherit these rules when they move into the new-paths list.
  {
    files: [
      // New core primitives (Phase 0+)
      'src/runtime/core/**/*.{ts,vue}',
      // New package entry points (Phase 4)
      'src/index.ts',
      'src/nuxt.ts',
      'src/vite.ts',
      'src/transforms.ts',
      'src/zod.ts',
      'src/zod-v3.ts',
      // New adapter shape (Phase 4)
      'src/runtime/adapters/zod-v3/**/*.{ts,vue}',
      'src/runtime/adapters/zod-v4/**/*.{ts,vue}',
      // New test directories
      'test/core/**/*.{ts,vue}',
      'test/adapters/**/*.{ts,vue}',
      'test/transforms/**/*.{ts,vue}',
      'test/packaging/**/*.{ts,vue}',
      'test/ssr-bare-vue/**/*.{ts,vue}',
      'test/utils/fake-schema.ts',
      'bench/**/*.{ts,vue}',
    ],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ...commonParserOptions,
      },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'as',
          objectLiteralTypeAssertions: 'never',
        },
      ],
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
    },
  },

  // Zod v3 adapter is the pre-rewrite implementation moved verbatim from
  // src/runtime/adapters/zod/ in Phase 4a. It speaks v3-specific internals
  // (_def.typeName, .unwrap(), .innerType()) that won't satisfy the new
  // strict-boolean-expressions / no-unnecessary-condition rules without a
  // full rewrite. The adapter is scheduled for an 8-way split in Phase 4b;
  // at that point introspect.ts will isolate the _def access and the rest
  // of the adapter will satisfy strict rules. Until then: exempt.
  {
    files: ['src/runtime/adapters/zod-v3/**/*.ts'],
    rules: {
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/consistent-type-assertions': 'off',
    },
  },

  // directive.ts is a port of Vue's own v-model implementation, down to the
  // `!isRegisterValue(val) || !el` idioms and similar Vue-style truthiness
  // checks. The behavior is tested end-to-end via the SSR fixture; rewriting
  // every conditional to pass strict-boolean-expressions without any functional
  // benefit would multiply review burden without catching real bugs. The
  // Phase 3 hardening tightens the parts that matter (AST matching, type=file,
  // listener cleanup) — the remaining conditional style stays.
  {
    files: ['src/runtime/core/directive.ts'],
    rules: {
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
    },
  },

  // Core may not import from adapters. Enforces the schema-agnostic guarantee.
  {
    files: ['src/runtime/core/**/*.{ts,vue}', 'src/runtime/lib/core/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**', '../adapters/**', '../../adapters/**'],
              message: 'Core must not import from adapters; it must remain schema-agnostic.',
            },
          ],
        },
      ],
    },
  },

  // Adapters may not cross-import. The v3 and v4 zod adapters are fully isolated.
  {
    files: ['src/runtime/adapters/zod-v3/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/zod-v4/**', '../zod-v4/**'],
              message: 'Zod v3 and v4 adapters are fully isolated; cross-imports forbidden.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/runtime/adapters/zod-v4/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/zod-v3/**', '../zod-v3/**'],
              message: 'Zod v3 and v4 adapters are fully isolated; cross-imports forbidden.',
            },
          ],
        },
      ],
    },
  },

  // test/core/** must not import zod — it tests the abstract core against fake-schema.ts.
  {
    files: ['test/core/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['zod'],
              message: 'Core tests must not import zod. Use test/utils/fake-schema.ts instead.',
            },
          ],
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
