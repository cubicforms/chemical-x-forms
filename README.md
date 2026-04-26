# Chemical X Forms

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Node.js Test Suite](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml/badge.svg)](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml)
[![Nuxt][nuxt-src]][nuxt-href]

**A fully type-safe, schema-driven form library that gives you superpowers.** A minimal composition API for Vue 3 and Nuxt — bring a Zod schema (or your own validator), get typed values, per-field errors, a submit handler, and a reactive state bundle out of the box. Built for developer experience and form correctness.

## Installation

**Nuxt 3 / 4**

```bash
npm install @chemical-x/forms zod
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@chemical-x/forms/nuxt'],
})
```

<details>
<summary><strong>Bare Vue 3</strong></summary>

```ts
// main.ts
import { createApp } from 'vue'
import { createChemicalXForms } from '@chemical-x/forms'

createApp(App).use(createChemicalXForms()).mount('#app')
```

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
import { chemicalXForms } from '@chemical-x/forms/vite'

export default defineConfig({
  plugins: [vue(), chemicalXForms()],
})
```

</details>

## Quick start

```vue
<!-- Signup.vue -->
<script setup lang="ts">
  import { z } from 'zod'
  import { useForm } from '@chemical-x/forms/zod' // zod v4; use /zod-v3 for v3

  const schema = z.object({
    email: z.email(),
    password: z.string().min(8),
  })

  const { register, handleSubmit, fieldErrors, state } = useForm({ schema })

  const onSubmit = handleSubmit(async (values) => {
    await $fetch('/api/signup', { method: 'POST', body: JSON.stringify(values) })
  })
</script>

<template>
  <form @submit.prevent="onSubmit">
    <input v-register="register('email')" placeholder="Email" />
    <small v-if="fieldErrors.email?.[0]">{{ fieldErrors.email[0].message }}</small>

    <input v-register="register('password')" type="password" placeholder="Password" />
    <small v-if="fieldErrors.password?.[0]">{{ fieldErrors.password[0].message }}</small>

    <button :disabled="state.isSubmitting">Sign up</button>
  </form>
</template>
```

**What you get from `useForm({ schema })`:**

- `register` — typed two-way binding for any field path, paired with the `v-register` directive
- `fieldErrors` — live per-field errors, schema-driven
- `handleSubmit` — async-aware submit wrapper that validates first
- `state` — reactive form-wide flags (`isSubmitting`, `isValid`, `isDirty`, `submitCount`, …)

Errors track the live `(value, schema)` by default. Pass `fieldValidation: { on: 'none' }` to validate only on submit.

## Features

- **End-to-end type safety** — every path, value, and error is inferred from your schema; no `any` in the public surface.
- **Live validation** — debounced `'change'` mode by default; `'blur'` and `'none'` available; async refines work everywhere (`handleSubmit`, the reactive `validate()` ref, and `validateAsync(path?)`).
- **Field arrays** — `append` / `prepend` / `insert` / `remove` / `swap` / `move` / `replace` with full type narrowing on path and element type.
- **Drafts + undo / redo** — persist and hydrate from `localStorage`, `sessionStorage`, IndexedDB, or your own [`FormStorage`](./docs/recipes/persistence.md#custom-backend); bounded snapshot stack wires to `⌘Z` / `⌘⇧Z` in one line.
- **Server errors** — `setFieldErrorsFromApi` accepts the common envelope shapes; user-injected errors persist across schema revalidation.
- **SSR** — first-class for Nuxt and bare Vue + `@vue/server-renderer`; payload round-trip is automatic in Nuxt.

## Documentation

- [**API reference**](./docs/api.md) — every public export with signatures and return shapes
- [**Recipes**](./docs/recipes) — task-oriented walkthroughs for every feature above
- [**Troubleshooting**](./docs/troubleshooting.md) — common gotchas and fixes
- [**Migration guides**](./docs/migration) — per-release upgrade notes
- [**Performance**](./docs/perf.md) — how it scales; when to worry
- [**Changelog**](./CHANGELOG.md) — full release history

## Status

Pre-1.0. The API is stable and follows SemVer from `v1.0` onward — 0.x minor bumps may still include small breaking changes, each documented under [`docs/migration/`](./docs/migration).

## License

MIT — see [LICENSE](./LICENSE).

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@chemical-x/forms/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/@chemical-x/forms
[npm-downloads-src]: https://img.shields.io/npm/dm/@chemical-x/forms.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/@chemical-x/forms
[license-src]: https://img.shields.io/npm/l/@chemical-x/forms.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/@chemical-x/forms
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
