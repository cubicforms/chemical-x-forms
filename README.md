# Chemical X Forms

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Node.js Test Suite](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml/badge.svg)](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml)
[![Nuxt][nuxt-src]][nuxt-href]

A schema-driven form library for Vue 3 and Nuxt. Bring a Zod schema (or your own validator); `useForm` returns typed reads and writes, per-field errors, a submit handler, and a reactive state bundle. The public surface is `any`-free: every path, value, and error is inferred from the schema.

## Installation

```bash
npm install @chemical-x/forms zod
```

**Nuxt 3 / 4**

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@chemical-x/forms/nuxt'],
})
```

**Bare Vue 3**

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

## Quick start

```vue
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

`useForm({ schema })` returns:

- `register(path)` — typed two-way binding for any field path; pair with the `v-register` directive on `<input>` / `<textarea>` / `<select>`.
- `fieldErrors` — per-field errors keyed by dotted path. Updates live as `(value, schema)` changes; pass `fieldValidation: { on: 'none' }` to validate only on submit.
- `handleSubmit(callback, onError?)` — runs validation, dispatches to the success or error callback. The callback receives the strict zod-inferred type.
- `state` — reactive form-wide flags (`isSubmitting`, `isValid`, `isDirty`, `submitCount`, `submitError`, `canUndo`, `canRedo`, `historySize`).

See the [API reference](./docs/api.md) for the complete surface.

## Features

- **Schema-driven types** — every path, value, and error is inferred from the schema. `setValue` / `defaultValues` / `getValue` / `register` widen primitive-literal leaves to their primitive supertype (the slim-write contract); `handleSubmit` and `validate*()` payloads stay on the strict zod-inferred shape.
- **Live validation** — debounced `'change'` mode by default; `'blur'` and `'none'` available; async refinements run from `handleSubmit`, the reactive `validate()` ref, and `validateAsync(path?)`.
- **Field arrays** — `append` / `prepend` / `insert` / `remove` / `swap` / `move` / `replace`. Path and element type narrow at the call site.
- **Drafts + undo / redo** — persistence to `localStorage`, `sessionStorage`, IndexedDB, or a custom [`FormStorage`](./docs/recipes/persistence.md#custom-backend); bounded snapshot stack with imperative `undo()` / `redo()` and `state.canUndo` / `state.canRedo` flags.
- **Server errors** — `parseApiErrors(payload)` normalises the common envelope shapes into `ValidationError[]`; pass to `setFieldErrors` to apply. User-injected errors are stored separately from schema errors and survive schema revalidation and successful submits.
- **SSR** — supported under Nuxt and bare Vue + `@vue/server-renderer`. Nuxt handles the payload round-trip automatically; bare Vue uses `renderChemicalXState` / `hydrateChemicalXState` (see [SSR recipe](./docs/recipes/ssr-hydration.md)).

## Documentation

- [**API reference**](./docs/api.md) — every public export with signatures and return shapes
- [**Recipes**](./docs/recipes) — task-oriented walkthroughs for every feature above
- [**Troubleshooting**](./docs/troubleshooting.md) — common gotchas and fixes
- [**Migration guides**](./docs/migration) — per-release upgrade notes
- [**Performance**](./docs/perf.md) — how it scales; when to worry
- [**Changelog**](./CHANGELOG.md) — full release history

## Status

Pre-1.0. SemVer applies from `v1.0` onward; 0.x minor bumps may still include breaking changes, each documented under [`docs/migration/`](./docs/migration).

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
