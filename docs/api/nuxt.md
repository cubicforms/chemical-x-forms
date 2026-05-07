---
title: 'attaform/nuxt — Nuxt 4 module'
description: 'Drop-in Nuxt module for Attaform: zero-config auto-imports, SSR-safe form state through nuxtApp.payload, devtools panel, and schema HMR.'
---

# `attaform/nuxt`

A Nuxt module that installs the plugin, registers the node
transforms, and auto-imports `useForm`. Add to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['attaform/nuxt'],
})
```

Under Nuxt, `useForm` is globally available — no explicit import
needed.
