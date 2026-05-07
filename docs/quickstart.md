# Quick start

Get a working Attaform form on screen in under five minutes. The
mainline path is Nuxt — bare-Vue + Vite is one section down.

## 1. Install

::ui-install-command{:show-quick-start="false"}
::

`zod` is a peer dependency. Requires Vue 3 and Zod 4 — for Zod v3,
swap the import for [`attaform/zod-v3`](/docs/api/zod-v3) (same
surface, separate adapter).

## 2. Wire it up

### Nuxt 3 / 4

Add the module to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['attaform/nuxt'],
})
```

That's everything. The module installs the plugin, registers the
`v-register` directive, and auto-imports `useForm` so you can call
it without an explicit import.

### Bare Vue + Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { attaform } from 'attaform/vite'

export default defineConfig({
  plugins: [vue(), attaform()],
})
```

```ts
// main.ts
import { createApp } from 'vue'
import { createAttaform } from 'attaform'
import App from './App.vue'

createApp(App).use(createAttaform()).mount('#app')
```

The Vite plugin is required for SSR-correct `v-register` bindings.
For other bundlers, see [`attaform/transforms`](/docs/api/transforms).

## 3. Your first form

```vue
<script setup lang="ts">
  import { z } from 'zod'
  import { useForm } from 'attaform/zod' // or auto-imported under Nuxt

  const schema = z.object({
    email: z.email(),
    password: z.string().min(8, 'At least 8 characters'),
  })

  const form = useForm({ schema, key: 'signup' })

  const onSubmit = form.handleSubmit(async (values) => {
    // `values` is fully typed from the schema — no `as`, no manual narrowing.
    await api.signup(values)
  })
</script>

<template>
  <form @submit.prevent="onSubmit">
    <label>
      Email
      <input v-register="form.register('email')" type="email" />
      <small>{{ form.errors.email?.[0]?.message }}</small>
    </label>

    <label>
      Password
      <input v-register="form.register('password')" type="password" />
      <small>{{ form.errors.password?.[0]?.message }}</small>
    </label>

    <button type="submit" :disabled="!form.meta.valid || form.meta.submitting">
      {{ form.meta.submitting ? 'Creating account…' : 'Create account' }}
    </button>
  </form>
</template>
```

Three things this demonstrates:

- **`v-register`** binds a native input directly to a path on the form.
  No two-way wiring, no manual `v-model` plumbing.
- **`form.errors`** is a reactive proxy. Refinement errors surface as
  the user types; required-field "no value supplied" errors fire on
  submit.
- **`form.meta.valid`** and `form.meta.submitting` gate the
  submit button — submit auto-runs validation first, so the callback
  receives strictly-typed values.

Open the [live playground](/play) to edit this exact example without
leaving the browser.

## 4. Where to next

| If you want to…                                   | Read                                                           |
| ------------------------------------------------- | -------------------------------------------------------------- |
| See every option `useForm` accepts                | [`attaform/zod`](/docs/api/zod)                                |
| Understand `form.values` / `form.errors` / `meta` | [The useForm return value](/docs/api/use-form-return)          |
| Persist drafts across reloads                     | [Persistence](/docs/recipes/persistence)                       |
| Validate on `blur` instead of `change`            | [Field-level validation](/docs/recipes/field-level-validation) |
| Handle server-side validation errors              | [Server errors](/docs/recipes/server-errors)                   |
| Add undo / redo                                   | [Undo / redo](/docs/recipes/undo-redo)                         |
| Build dynamic field arrays (`append`/`remove`/…)  | [Dynamic field arrays](/docs/recipes/dynamic-field-arrays)     |
| Hit a problem                                     | [Troubleshooting](/docs/troubleshooting)                       |
