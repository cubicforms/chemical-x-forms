# Chemical X Forms

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Node.js Test Suite](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml/badge.svg)](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml)
[![Nuxt][nuxt-src]][nuxt-href]

**A fully type-safe, schema-driven form library that gives you superpowers**.<br>Comes with a minimal composition API that prioritizes developer experience and form correctness.<br><br>

## 🚀 60-second start

```bash
npm install @chemical-x/forms zod
```

**Nuxt 3 / 4** — add the module:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@chemical-x/forms/nuxt'],
})
```

**Bare Vue 3** — install the plugin:

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

That's it. [Jump to your first form →](#-your-first-form)
<br><br>

## 🪄 Your first form

```vue
<script setup lang="ts">
  import { useForm } from '@chemical-x/forms/zod' // zod v4; use /zod-v3 for v3
  import { z } from 'zod'

  const { register, handleSubmit, fieldErrors, state } = useForm({
    schema: z.object({
      email: z.email(),
      password: z.string().min(8),
    }),
  })

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

You get: schema-typed values, per-field errors, a submit handler that
validates first, and a reactive `state` bundle (`isSubmitting`,
`isDirty`, `isValid`, and six more — see below). Every leaf of
`fieldErrors` and every branded path is inferred from your Zod schema.
<br><br>

## 🎯 The core you always have

Everything below is on by default — no opt-in needed:

- **`register(path)` + `v-register`** — bind an input to a field in one directive. SSR-safe, no per-input `v-model` + `@input` boilerplate.
- **`handleSubmit(onSubmit, onError?)`** — validates, then dispatches. Bind straight to `@submit.prevent`.
- **`fieldErrors`** — reactive `Record<path, ValidationError[]>`. Auto-populated by `handleSubmit` on failure, cleared on success. Also writable from your own code.
- **`state`** — reactive bundle of form-level flags and counters: `state.isDirty` / `state.isValid` (gate a "Save" button on `state.isDirty && state.isValid` without wiring per-field watchers), `state.isSubmitting` / `state.submitCount` / `state.submitError` (full submission lifecycle — spinner, per-click counter, reactive error banner with zero extra refs), `state.isValidating` (async-validation flag), and `state.canUndo` / `state.canRedo` / `state.historySize` (undo/redo, always present; inert when `history` is off). Auto-unwraps in templates — no `.value`.
- **`getValue(path)` / `setValue(path, value)`** — read / write any field programmatically.
- **`getFieldState(path)`** — everything for one path: value, errors, touched, focused, blurred, isConnected, updatedAt.
- **`reset(next?)` / `resetField(path)`** — restore the whole form, or a single subtree, back to schema defaults (or a partial override).
- **Field-array helpers** — `append` / `prepend` / `insert` / `remove` / `swap` / `move` / `replace`. Path is narrowed to arrays, value to the element type — `append('title', …)` on a string field is a compile error. [Recipe →](./docs/recipes/dynamic-field-arrays.md)
- **Structured paths** — field names with literal dots? `register(['user.name'])` keeps them as a single segment. `register('user.name')` splits.
  <br><br>

## ⚡ Superpowers (opt-in)

Flip a config flag, get a whole feature. Each of these is off by default.

### Async validation

Use `z.refine(async …)` to check uniqueness, allow-lists, server availability. `handleSubmit` awaits it for you.

```ts
const schema = z.object({
  email: z.email().refine(async (v) => !(await isEmailTaken(v)), 'Email already registered'),
})
```

`validate()` / `validateAsync(path?)` / `state.isValidating` give you reactive + imperative surfaces for live validation UI. [Recipe →](./docs/recipes/async-validation.md)

### Live field validation

Validate as the user types or tabs away — no submit needed:

```ts
useForm({ schema, fieldValidation: { on: 'change', debounceMs: 200 } })
```

Three modes — `'change'` (debounced), `'blur'` (immediate), `'none'` (default). Rapid typing is debounced + auto-cancelled. [Recipe →](./docs/recipes/field-level-validation.md)

### Focus / scroll to first error

```ts
useForm({ schema, onInvalidSubmit: 'focus-first-error' })
```

Or call `focusFirstError()` / `scrollToFirstError({ block: 'start' })` imperatively after a failed submit or a `setFieldErrorsFromApi` hydration. [Recipe →](./docs/recipes/focus-on-error.md)

### Persist drafts across reloads

```ts
useForm({ schema, key, persist: { storage: 'local' } })
```

Backends: `'local'` / `'session'` / `'indexeddb'` (or your own). Writes debounced, clears on successful submit, survives hard refresh. [Recipe →](./docs/recipes/persistence.md)

### Undo / redo

```ts
useForm({ schema, key, history: true })
```

Adds `undo()` / `redo()` methods plus `state.canUndo` / `state.canRedo` / `state.historySize` on a bounded snapshot stack (default 50). Wire it to <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> in one line. [Recipe →](./docs/recipes/undo-redo.md)

### Nested form components

Call `useFormContext()` in any descendant to reach the ancestor's form without prop-threading. Pass a form's `key` to reach a form that isn't an ancestor — or when a single parent owns more than one form and descendants need to disambiguate. [Recipe →](./docs/recipes/form-context.md)

### Server errors

```ts
setFieldErrorsFromApi(err.data) // accepts { error: { details: { path: [msg] } } } or { path: [msg] }
```

Drops straight into your `catch` block. Built-in caps on entry count + path depth keep untrusted payloads safe. [Recipe →](./docs/recipes/server-errors.md)

### Vue DevTools

```bash
npm install -D @vue/devtools-api
```

Every registered form shows up in the DevTools sidebar with an editable tree, an error view, and a timeline for submit / reset / mutation events. Auto-wired; pass `createChemicalXForms({ devtools: false })` to disable. [Recipe →](./docs/recipes/devtools.md)

### SSR

Nuxt: zero config — the module handles payload round-trip via `nuxtApp.payload`.<br>
Bare Vue + `@vue/server-renderer`: `renderChemicalXState(app)` on the server, `hydrateChemicalXState(app, payload)` on the client. [Recipe →](./docs/recipes/ssr-hydration.md)

### Bring your own schema library

Zod v4 is the default. Valibot, ArkType, hand-rolled — implement four methods on `AbstractSchema` and `useForm` works against it. [Recipe →](./docs/recipes/custom-adapter.md)
<br><br>

## 📚 Documentation

- [**`docs/api.md`**](./docs/api.md) — every public export with signatures and return shapes
- [**`docs/recipes/`**](./docs/recipes) — task-oriented walkthroughs for everything above
- [**`docs/troubleshooting.md`**](./docs/troubleshooting.md) — common gotchas and fixes
- [**`docs/migration/`**](./docs/migration) — per-release upgrade notes
- [**`docs/perf.md`**](./docs/perf.md) — how it scales; when to worry
- [**`CHANGELOG.md`**](./CHANGELOG.md) — full release history
  <br><br>

## 🏔️ What's in the box

- **Framework-agnostic core** — Nuxt 3 / 4, bare Vue 3 (CSR), bare Vue 3 + `@vue/server-renderer` (SSR). One Vue plugin; the Nuxt module wraps it.
- **Schema-agnostic, Zod-friendly** — Zod v4 at `/zod`, Zod v3 at `/zod-v3`. Bring your own validator if you don't use Zod.
- **TypeScript-first** — every strictness flag on, branded `PathKey` / `FormKey`, no `any` in the public surface.
- **Performance** — keystroke path is 6–12× faster than the pre-rewrite baseline; a CI job fails the run if the ratio drops.
- **Zero framework-specific validator ceremony** — no `v-model` + `@input` wiring, no manual error mapping from your schema library to your UI.
  <br><br>

## 📦 Status

**Pre-1.0.** The API is stable and under SemVer from `v1.0` onward —
0.x minor bumps may still include small breaking changes; each one
lands with a migration note under [`docs/migration/`](./docs/migration). [Recent changes →](./CHANGELOG.md)
<br><br>

### Subpath exports

| Subpath                        | Purpose                                                |
| ------------------------------ | ------------------------------------------------------ |
| `@chemical-x/forms`            | Framework-agnostic core (plugin, `useForm`, directive) |
| `@chemical-x/forms/nuxt`       | Nuxt 3 / 4 module                                      |
| `@chemical-x/forms/vite`       | Vite plugin (registers node transforms)                |
| `@chemical-x/forms/transforms` | Raw node transforms for custom bundlers                |
| `@chemical-x/forms/zod`        | Zod v4 adapter (recommended; requires `zod@^4`)        |
| `@chemical-x/forms/zod-v3`     | Zod v3 adapter (legacy; requires `zod@^3`)             |

<br>

## 🪪 License

`@chemical-x/forms` is released under the MIT License. See the [LICENSE](https://github.com/cubicforms/chemical-x-forms/blob/main/LICENSE) file for details.

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@chemical-x/forms/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/@chemical-x/forms
[npm-downloads-src]: https://img.shields.io/npm/dm/@chemical-x/forms.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/@chemical-x/forms
[license-src]: https://img.shields.io/npm/l/@chemical-x/forms.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/@chemical-x/forms
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
