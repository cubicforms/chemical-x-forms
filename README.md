# @chemical-x/forms

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Tests](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml/badge.svg)](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml)
[![Vue 3][vue-src]][vue-href]
[![Nuxt 3 / 4][nuxt-src]][nuxt-href]
[![TypeScript][ts-src]][ts-href]

Type-safe, schema-driven forms for Vue 3 and Nuxt 3 / 4. Composition API, branded paths, Zod v3 / v4 adapters included; custom adapters via `AbstractSchema`.

## Install

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
    import { useForm } from '@chemical-x/forms/zod' // zod v4; use /zod-v3 for v3
    import { z } from 'zod'

  <<<<<<< HEAD
  const { register, handleSubmit, fieldErrors, state } = useForm({
    schema: z.object({
      email: z.email(),
      password: z.string().min(8),
    }),
  })
  =======
    const { register, handleSubmit, fieldErrors, isSubmitting } = useForm({
      schema: z.object({
        email: z.email(),
        password: z.string().min(8),
      }),
    })
  >>>>>>> origin/main

    const onSubmit = handleSubmit(async (values) => {
      await fetch('/api/signup', { method: 'POST', body: JSON.stringify(values) })
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

<<<<<<< HEAD
You get: schema-typed values, per-field errors, a submit handler that
validates first, and a reactive `state` bundle (`isSubmitting`,
`isDirty`, `isValid`, and six more — see below). Every leaf of
`fieldErrors` and every branded path is inferred from your Zod schema.
<br><br>
=======
Schema-typed values, per-field errors, a submit handler that validates first, and a reactive `isSubmitting` flag. `fieldErrors` keys and every branded path are inferred from the schema.

> > > > > > > origin/main

## Core API

On by default — no opt-in.

<<<<<<< HEAD

- **`register(path)` + `v-register`** — bind an input to a field in one directive. SSR-safe, no per-input `v-model` + `@input` boilerplate.
- **`handleSubmit(onSubmit, onError?)`** — validates, then dispatches. Bind straight to `@submit.prevent`.
- **`fieldErrors`** — reactive `Record<path, ValidationError[]>`. Auto-populated by `handleSubmit` on failure, cleared on success. Also writable from your own code.
- # **`state`** — reactive bundle of form-level flags and counters: `state.isDirty` / `state.isValid` (gate a "Save" button on `state.isDirty && state.isValid` without wiring per-field watchers), `state.isSubmitting` / `state.submitCount` / `state.submitError` (full submission lifecycle — spinner, per-click counter, reactive error banner with zero extra refs), `state.isValidating` (async-validation flag), and `state.canUndo` / `state.canRedo` / `state.historySize` (undo/redo, always present; inert when `history` is off). Auto-unwraps in templates — no `.value`.
- **`register(path)` + `v-register`** — bind an input to a field in one directive. SSR-safe.
- **`handleSubmit(onSubmit, onError?)`** — validates, then dispatches. Bind to `@submit.prevent`.
- **`fieldErrors`** — reactive `Record<path, ValidationError[]>`. Auto-populated on submit failure, cleared on success, writable from your code.
- **`isDirty` / `isValid`** — computed refs. Gate a Save button on `isDirty && isValid` without per-field watchers.
- **`isSubmitting` / `submitCount` / `submitError`** — full submission lifecycle.
  > > > > > > > origin/main
- **`getValue(path)` / `setValue(path, value)`** — read / write any field programmatically.
- **`getFieldState(path)`** — value, errors, touched, focused, blurred, isConnected, updatedAt.
- **`reset(next?)` / `resetField(path)`** — restore the form (or a subtree) to schema defaults, or override.
- **Field-array helpers** — `append` / `prepend` / `insert` / `remove` / `swap` / `move` / `replace`. Path is narrowed to arrays, value to the element type — `append('title', …)` on a string field is a compile error. [Recipe →](./docs/recipes/dynamic-field-arrays.md)
- **Structured paths** — literal dots in field names? `register(['user.name'])` keeps them as one segment; `register('user.name')` splits.

## Optional features

Each is off by default; flip a flag to enable.

### Async validation

```ts
const schema = z.object({
  email: z.email().refine(async (v) => !(await isEmailTaken(v)), 'Email already registered'),
})
```

<<<<<<< HEAD
`validate()` / `validateAsync(path?)` / `state.isValidating` give you reactive + imperative surfaces for live validation UI. [Recipe →](./docs/recipes/async-validation.md)
=======
`handleSubmit` awaits async refinements; `validate()` / `validateAsync(path?)` / `isValidating` give imperative + reactive surfaces. [Recipe →](./docs/recipes/async-validation.md)

> > > > > > > origin/main

### Live field validation

```ts
useForm({ schema, fieldValidation: { on: 'change', debounceMs: 200 } })
```

Modes: `'change'` (debounced), `'blur'`, `'none'`. Rapid typing is debounced and auto-cancelled. [Recipe →](./docs/recipes/field-level-validation.md)

### Focus / scroll to first error

```ts
useForm({ schema, onInvalidSubmit: 'focus-first-error' })
```

Or call `focusFirstError()` / `scrollToFirstError({ block: 'start' })` after a failed submit or `setFieldErrorsFromApi` hydration. [Recipe →](./docs/recipes/focus-on-error.md)

### Persist drafts

```ts
useForm({ schema, key, persist: { storage: 'local' } })
```

Backends: `'local'` / `'session'` / `'indexeddb'` or your own. Writes are debounced; cleared on successful submit. [Recipe →](./docs/recipes/persistence.md)

### Undo / redo

```ts
useForm({ schema, key, history: true })
```

<<<<<<< HEAD
Adds `undo()` / `redo()` methods plus `state.canUndo` / `state.canRedo` / `state.historySize` on a bounded snapshot stack (default 50). Wire it to <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> in one line. [Recipe →](./docs/recipes/undo-redo.md)
=======
Adds `undo()` / `redo()` / `canUndo` / `canRedo` with a bounded snapshot stack (default 50). [Recipe →](./docs/recipes/undo-redo.md)

> > > > > > > origin/main

### Nested form components

`useFormContext()` reaches the ancestor form without prop-threading. Pass an explicit `key` to disambiguate when a parent owns multiple forms. [Recipe →](./docs/recipes/form-context.md)

### Server errors

```ts
setFieldErrorsFromApi(err.data) // { error: { details: { path: [msg] } } } or { path: [msg] }
```

Drops into a `catch` block. Built-in caps on entry count and path depth keep untrusted payloads safe. [Recipe →](./docs/recipes/server-errors.md)

### Vue DevTools

```bash
npm install -D @vue/devtools-api
```

Forms appear in the DevTools sidebar with an editable tree, an error view, and a submit / reset / mutation timeline. Auto-wired; pass `createChemicalXForms({ devtools: false })` to disable. [Recipe →](./docs/recipes/devtools.md)

### SSR

Nuxt: zero config — the module handles payload round-trip via `nuxtApp.payload`. Bare Vue + `@vue/server-renderer`: `renderChemicalXState(app)` on the server, `hydrateChemicalXState(app, payload)` on the client. [Recipe →](./docs/recipes/ssr-hydration.md)

### Custom schema adapter

Zod v4 is the default; Zod v3 ships at `/zod-v3`. To use Valibot, ArkType, or a hand-rolled validator, implement four methods on `AbstractSchema`. [Recipe →](./docs/recipes/custom-adapter.md)

## Subpath exports

| Subpath                        | Purpose                                                |
| ------------------------------ | ------------------------------------------------------ |
| `@chemical-x/forms`            | Framework-agnostic core (plugin, `useForm`, directive) |
| `@chemical-x/forms/nuxt`       | Nuxt 3 / 4 module                                      |
| `@chemical-x/forms/vite`       | Vite plugin (registers node transforms)                |
| `@chemical-x/forms/transforms` | Raw node transforms for custom bundlers                |
| `@chemical-x/forms/zod`        | Zod v4 adapter (recommended; requires `zod@^4`)        |
| `@chemical-x/forms/zod-v3`     | Zod v3 adapter (legacy; requires `zod@^3`)             |

## Documentation

- [`docs/api.md`](./docs/api.md) — every public export with signatures
- [`docs/recipes/`](./docs/recipes) — task-oriented walkthroughs
- [`docs/troubleshooting.md`](./docs/troubleshooting.md) — common gotchas
- [`docs/migration/`](./docs/migration) — per-release upgrade notes
- [`docs/perf.md`](./docs/perf.md) — benchmarks and scaling notes
- [`CHANGELOG.md`](./CHANGELOG.md) — full release history

## Status

Pre-1.0. The public API is stable; 0.x minor bumps may still include small breaking changes, each documented under [`docs/migration/`](./docs/migration). 1.0 will lock SemVer. [Recent changes →](./CHANGELOG.md)

## License

MIT — see [LICENSE](https://github.com/cubicforms/chemical-x-forms/blob/main/LICENSE).

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@chemical-x/forms/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/@chemical-x/forms
[npm-downloads-src]: https://img.shields.io/npm/dm/@chemical-x/forms.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/@chemical-x/forms
[license-src]: https://img.shields.io/npm/l/@chemical-x/forms.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/@chemical-x/forms
[vue-src]: https://img.shields.io/badge/Vue-3-020420?logo=vue.js&logoColor=4FC08D
[vue-href]: https://vuejs.org
[nuxt-src]: https://img.shields.io/badge/Nuxt-3%20%2F%204-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
[ts-src]: https://img.shields.io/badge/TypeScript-strict-020420?logo=typescript&logoColor=3178C6
[ts-href]: https://www.typescriptlang.org
