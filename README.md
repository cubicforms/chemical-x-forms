# Chemical X Forms

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Node.js Test Suite](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml/badge.svg)](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml)
[![Nuxt][nuxt-src]][nuxt-href]

**A fully type-safe, schema-driven form library that gives you superpowers**.<br>Comes with a minimal composition API that prioritizes developer experience and form correctness.<br><br>

## 📦 Status

**Public beta** (`0.8.0-beta`). The API is stable and under SemVer from
`v1.0` onward — 0.x minor bumps may still include small breaking
changes; each one lands with a migration note under
[`docs/migration/`](./docs/migration). [What's new in 0.8.0-beta →](./CHANGELOG.md#v080-beta)
<br><br>

## 🏔️ Features

- **Framework-agnostic core** – Works under Nuxt 3/4, bare Vue 3 (CSR), and bare Vue 3 + `@vue/server-renderer` (SSR). `createChemicalXForms()` is a one-liner Vue plugin; the Nuxt module wraps it for Nuxt users.
- **Compact API** – Minimal yet expressive: `useForm`, `register`, `handleSubmit`, `getFieldState`. Cross-form state isolation is built in (no shared path-keyed state between forms).
- **Schema-agnostic, Zod-friendly** – The core only depends on an `AbstractSchema` contract. Zod v4 adapter at `/zod`, Zod v3 at `/zod-v3` — both physically isolated with `introspect.ts` quarantining internal access. Consumers pick the zod major they use.
- **v-register Directive** – One SSR-safe directive; no per-input `v-model` + `@input` boilerplate.
- **Form-level aggregates** – `isDirty` and `isValid` are computed refs driven off `originals` + `fieldErrors`. Gate a "Save" button on `isDirty && isValid` without wiring per-field watchers.
- **Submission lifecycle** – `isSubmitting`, `submitCount`, and `submitError` surface every outcome of `handleSubmit`. Spinner + per-click counter + reactive error banner without extra refs.
- **Reset primitives** – `reset(next?)` re-seeds from schema defaults (or a constraint partial) and rebuilds the `originals` baseline. `resetField(path)` restores a single leaf or a whole sub-tree.
- **Typed array helpers** – `append` / `prepend` / `insert` / `remove` / `swap` / `move` / `replace`, each narrowed to paths whose leaf is an array (`ArrayPath<Form>`) and values whose shape matches the element type (`ArrayItem<Form, Path>`). See the [dynamic-field-arrays recipe](./docs/recipes/dynamic-field-arrays.md).
- **Full field-state tracking** – Per-path `value`, `touched`, `focused`, `blurred`, `isConnected`, `updatedAt`, `errors`.
- **Reactive field errors** – `fieldErrors` auto-populates on validation failure and clears on success; [`setFieldErrorsFromApi`](./docs/recipes/server-errors.md) maps server 422 envelopes onto fields for inline display.
- **Structured paths** – Field names with literal dots round-trip losslessly via array-form paths (`register(['user.name'])` vs `register(['user', 'name'])`). Dotted-string form still accepted for ergonomics.
- **TypeScript-first** – Every strictness flag on (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, branded `PathKey`/`FormKey`, no `any` in public surface).
  <br><br>

## 🪩 Installation

Chemical X Forms works under Nuxt 3/4, bare Vue 3 (CSR), and bare Vue 3 + `@vue/server-renderer` (SSR).

### Nuxt 3 / Nuxt 4

```bash
npm install @chemical-x/forms zod
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@chemical-x/forms/nuxt'],
})
```

### Bare Vue 3 (CSR or SSR)

```bash
npm install @chemical-x/forms zod
```

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

For SSR (`@vue/server-renderer`), `renderChemicalXState(app)` / `hydrateChemicalXState(app, payload)` bridge the server→client boundary. See [test/ssr-bare-vue/round-trip.test.ts](./test/ssr-bare-vue/round-trip.test.ts) for a complete example.

### Subpath exports

| Subpath                          | Purpose                                                   |
| -------------------------------- | --------------------------------------------------------- |
| `@chemical-x/forms`              | Framework-agnostic core (plugin, `useForm`, directive)    |
| `@chemical-x/forms/nuxt`         | Nuxt 3/4 module                                           |
| `@chemical-x/forms/vite`         | Vite plugin (registers node transforms)                   |
| `@chemical-x/forms/transforms`   | Raw node transforms for custom bundlers                   |
| `@chemical-x/forms/zod`          | Zod v4 adapter (recommended; requires `zod@^4`)           |
| `@chemical-x/forms/zod-v3`       | Zod v3 adapter (legacy; requires `zod@^3`)                |

<br>

## 🪄 Usage

**Basic Example**

```vue
<script setup lang="ts">
import { useForm } from '@chemical-x/forms/zod' // zod v4; use /zod-v3 for v3
import { z } from 'zod'

// Define your schema
const schema = z.object({ planet: z.string() })

// Create your form — `key` is required
const { getFieldState, register } = useForm({ schema, key: 'planet-form' })

// Get the state of the 'planet' field
const planetState = getFieldState('planet')
</script>

<template>
  <div>
    <h1>Planet Form</h1>

    <input
      v-register="register('planet')"
      placeholder="Enter your favorite planet"
    />

    <p>Planet field State:</p>
    <pre>{{ JSON.stringify(planetState, null, 2) }}</pre>
    <hr />
  </div>
</template>
```

**Core API Functions**

Comprehensive surface in [`docs/api.md`](./docs/api.md). Quick tour:

`useForm(options)` – Initializes form state. `schema` and `key` are both required.

`v-register` – Custom, SSR-safe directive for registering components with Chemical X

`register(name: string)` – Binds a field to form state.

`handleSubmit(onSubmit, onError?)` – Builds a submit handler that runs validation and dispatches to your callback. Bind it to `@submit.prevent` directly:

```vue
<script setup lang="ts">
const { handleSubmit } = useForm({ schema, key: 'signup' })
const onSubmit = handleSubmit(async (values) => {
  await api.post('/signup', values)
})
</script>

<template>
  <form @submit.prevent="onSubmit">...</form>
</template>
```

You can also call the returned handler programmatically: `await onSubmit()`.

`getValue(name: string)` – Retrieves a field value.

`setValue(name: string, value: any)` – Updates a field programmatically.

`getFieldState(name: string)` – Returns field state (value, touched, errors, etc.).

`fieldErrors` – Reactive `Record<path, ValidationError[]>`. Auto-populated by `handleSubmit` on validation failure and cleared on success.

`setFieldErrors(errors)` / `addFieldErrors(errors)` – Replace or merge errors imperatively.

`clearFieldErrors(path?)` – Clear one path or every path.

`setFieldErrorsFromApi(payload)` – Map a server error envelope (`{ error: { details: { path: [msg] } } }` or a raw `Record<path, string|string[]>`) into `ValidationError[]` and populate the store. Returns the produced errors.
<br><br>

**Per-field error display**

```vue
<script setup lang="ts">
import { z } from 'zod'

const { register, fieldErrors, handleSubmit, setFieldErrorsFromApi } = useForm({
  schema: z.object({ email: z.string().email() }),
  key: 'signup',
})

const onSubmit = handleSubmit(async (values) => {
  // server-side hydration after client validation passed:
  try {
    await $fetch('/api/signup', { method: 'POST', body: values })
  } catch (err) {
    if (err.statusCode === 422) setFieldErrorsFromApi(err.data)
  }
})
</script>

<template>
  <form @submit.prevent="onSubmit">
    <input v-register="register('email')" />
    <small v-if="fieldErrors.email?.[0]">{{ fieldErrors.email[0].message }}</small>
    <button>Submit</button>
  </form>
</template>
```

<br>

## 🥇 Advanced Features

- **Fully SSR-safe** – Nuxt 3/4 + bare Vue 3 + `@vue/server-renderer`. Server-side form state round-trips via `renderChemicalXState` / `hydrateChemicalXState`. See the [SSR hydration recipe](./docs/recipes/ssr-hydration.md).
- **Validation handling** – Schema validation errors populate `fieldErrors` automatically; `setFieldErrorsFromApi` hydrates server errors onto the same store.
- **Discriminated unions** – Both Zod adapters introspect discriminated unions and validate against the active branch only.
- **Performance** – Keystroke benchmark runs 7–10× faster than the pre-rewrite baseline. A CI job fails the run if the ratio drops.
- **Custom adapters** – The `AbstractSchema` contract has three sync methods; see the [custom-adapter recipe](./docs/recipes/custom-adapter.md) for a Valibot-style walkthrough.

## 📚 Documentation

- [`docs/api.md`](./docs/api.md) — every public export with signatures and return shapes
- [`docs/recipes/`](./docs/recipes) — task-oriented walkthroughs (dynamic field arrays, server errors, SSR hydration, custom adapters, validation patterns)
- [`docs/migration/`](./docs/migration) — per-release upgrade notes
- [`CHANGELOG.md`](./CHANGELOG.md) — full release history

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
