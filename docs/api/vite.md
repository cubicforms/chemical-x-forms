---
title: 'attaform/vite — Vite plugin'
description: "Attaform's Vite plugin applies v-register transforms at compile time so Vue 3 forms stay tree-shakable and zero-cost in your production bundle."
---

# `attaform/vite`

A Vite plugin that injects the `v-register` node transforms into
`@vitejs/plugin-vue`. Required under bare Vue + Vite for SSR-
correct `v-register` bindings on `<input>`, `<textarea>`, and
`<select>`.

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
import { attaform } from 'attaform/vite'

export default defineConfig({
  plugins: [vue(), attaform()],
})
```
