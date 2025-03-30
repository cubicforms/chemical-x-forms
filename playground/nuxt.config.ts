import { defineNuxtConfig, type DefineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  modules: [['../src/module', { useZod: true }]],
  devtools: { enabled: true },
  alias: {
    '@chemical-x/forms/types': '../src/runtime/types/types-api.ts',
  },
  compatibilityDate: '2025-01-28',
}) as DefineNuxtConfig
