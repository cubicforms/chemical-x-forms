# 🧪 Chemical X Forms

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Node.js Test Suite](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml/badge.svg)](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml)
[![Nuxt][nuxt-src]][nuxt-href]

A type-safe, schema-driven form library for Vue 3 and Nuxt with first-class Zod support.

## Installation

```bash
npm install @chemical-x/forms zod
```

**Nuxt 3 / 4** — install the module:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@chemical-x/forms/nuxt'],
})
```

**Bare Vue 3** — install the plugin and the Vite plugin:

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

### Recommended tsconfig

We pair well with `noUncheckedIndexedAccess: true`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

It catches stale `form.values.contacts[N]` reads at compile time. Nuxt 3 / 4 sets this for you.

## Quick start

```vue
<script setup lang="ts">
  import { z } from 'zod'
  import { useForm } from '@chemical-x/forms/zod' // zod v4; use /zod-v3 for v3

  const schema = z.object({
    email: z.email(),
    password: z.string().min(8),
  })

  const form = useForm({ schema, key: 'signup' })

  const onSubmit = form.handleSubmit(async (values) => {
    await $fetch('/api/signup', { method: 'POST', body: JSON.stringify(values) })
  })
</script>

<template>
  <form @submit.prevent="onSubmit">
    <input v-register="form.register('email')" placeholder="Email" />
    <small v-if="form.errors.email?.[0]">{{ form.errors.email[0].message }}</small>

    <input v-register="form.register('password')" type="password" placeholder="Password" />
    <small v-if="form.errors.password?.[0]">{{ form.errors.password[0].message }}</small>

    <button :disabled="form.meta.isSubmitting">Sign up</button>
  </form>
</template>
```

`useForm({ schema, key })` returns a Pinia-style reactive object — read leaves directly, no `.value`:

- **`form.values`** — current values. `form.values.email`, `form.values.address.city`.
- **`form.errors`** — per-field errors, keyed by dotted path. `form.errors.email?.[0]?.message`.
- **`form.fields`** — per-field flags (`dirty`, `touched`, `errors`, `blank`, …). `form.fields.email.dirty`.
- **`form.meta`** — form-level flags + counters (`isSubmitting`, `isValid`, `canUndo`, `submitCount`, the flat `meta.errors` aggregate, the per-mount `instanceId`, …).
- **`form.register(path)`** — typed two-way binding; pair with `v-register` on `<input>` / `<textarea>` / `<select>`.
- **`form.handleSubmit(onValid, onInvalid?)`** — runs validation, dispatches. The valid callback receives the strict zod-inferred type.
- **`form.setValue(path, value)`**, **`form.reset()`**, field-array helpers, undo / redo, persistence — see the [API reference](./docs/api.md).

## Features

- **Schema-driven types** — every path, value, and error is inferred from the schema; no `any`.
- **Live validation** — `validateOn: 'change'` by default with synchronous `debounceMs: 0`; `'blur'` and `'submit'` (opt-out) modes available; async refinements await before submit dispatches.
- **Schema-driven coercion** — string DOM input → schema's typed slot (`string→number`, `string→boolean`) at the directive layer. Default-on; pass `useForm({ coerce: false })` to disable or a custom `CoercionRegistry` to extend.
- **Register transforms** — `register('email', { transforms: [trim, lowercase] })` runs sync user-input normalization before storage commit. See [recipe](./docs/recipes/transforms.md).
- **Discriminated-union variant memory** — switching a discriminator (`notify.channel: 'email' → 'sms' → 'email'`) restores the previous variant's typed subtree by default. Set `useForm({ rememberVariants: false })` to drop on switch.
- **Field arrays** — `append` / `prepend` / `insert` / `remove` / `swap` / `move` / `replace`, fully typed at the call site.
- **Drafts + undo / redo** — per-field opt-in persistence (`localStorage` / `sessionStorage` / IndexedDB / [custom backend](./docs/recipes/persistence.md#picking-a-backend)) and a bounded undo stack.
- **Server errors** — `parseApiErrors(payload)` normalises a `{ message, code }[]` wire format; pair with `form.setFieldErrors(...)`. User errors survive schema revalidation.
- **Stable error codes** — every `ValidationError` carries `code: string`. Library codes (`cx:`) live on the exported `CxErrorCode` enum; adapter codes use a `zod:` prefix; consumers pick their own (`api:`, `auth:`, …).
- **Clearable required fields** — the `unset` sentinel marks a field displayed-empty while storage holds the schema's slim default. Submit fails with `'No value supplied'` for required schemas; `.optional()` / `.nullable()` / `.default(N)` opt out.
- **SSR** — Nuxt handles the payload round-trip automatically; bare Vue uses `renderChemicalXState` / `hydrateChemicalXState` ([recipe](./docs/recipes/ssr-hydration.md)).

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
