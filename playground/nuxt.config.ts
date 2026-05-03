import { defineNuxtConfig, type DefineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  modules: ['../src/nuxt'],
  devtools: { enabled: true },
  alias: {
    'attaform/types': '../src/runtime/types/types-api.ts',
    // Playground imports the zod-typed useForm directly so the form
    // composable picks up the zod-v4 schema types rather than the Nuxt
    // auto-imported abstract useForm.
    'attaform/zod': '../src/zod.ts',
    // Bare-path import for the schema-agnostic surface (parseApiErrors,
    // useFormContext, etc). Without this, vite-node fails to resolve
    // `attaform` and the SSR worker crashes with
    // "IPC connection closed".
    attaform: '../src/index.ts',
  },
  compatibilityDate: '2025-01-28',
}) as DefineNuxtConfig
