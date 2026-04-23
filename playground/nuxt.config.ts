import { defineNuxtConfig, type DefineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  modules: ['../src/nuxt'],
  devtools: { enabled: true },
  alias: {
    '@chemical-x/forms/types': '../src/runtime/types/types-api.ts',
    // Playground imports the zod-typed useForm directly so the form
    // composable picks up the zod-v4 schema types rather than the Nuxt
    // auto-imported abstract useForm.
    '@chemical-x/forms/zod': '../src/zod.ts',
  },
  compatibilityDate: '2025-01-28',
}) as DefineNuxtConfig
