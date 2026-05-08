---
description: 'Five minutes from pnpm install to a working Vue 3 form: write a Zod schema, mount with useForm, render with v-register — type-safe end to end.'
---

# Quick start

Get a working Attaform form on screen in under five minutes.

## 1. Install

::ui-install-command{:show-quick-start="false"}
::

`zod` is a peer dependency. Both Zod 3 and Zod 4 are supported — `attaform/zod` auto-detects the version you have installed.

## 2. Your first form

```vue
<script setup lang="ts">
  import { z } from 'zod'
  import { useForm } from 'attaform/zod'

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

That's the whole library in one screen:

- **`v-register`** binds a native input directly to a path on the form. No two-way wiring, no manual `v-model` plumbing.
- **`form.errors`** is a reactive proxy. Refinement errors surface as the user types; required-field "no value supplied" errors fire on submit.
- **`form.meta.valid`** and `form.meta.submitting` gate the submit button — submit auto-runs validation first, so the callback receives strictly-typed values.

You don't need to call `app.use(createAttaform())` or add a Vite plugin to get this working — `useForm` auto-installs the registry the first time you call it.

Open the [live playground](/play) to edit this exact example without leaving the browser.

## 3. Going further

Each section below opts in to a layered capability. None are required for the example above.

### Adding labels and placeholders

Attach metadata to fields so the schema stays the single source of truth for both shape and presentation:

```vue
<script setup lang="ts">
  import { z } from 'zod'
  import { useForm, fieldMeta } from 'attaform/zod'

  const schema = z.object({
    email: z.email().register(fieldMeta, {
      label: 'Email',
      placeholder: 'you@example.com',
    }),
    password: z.string().min(8).register(fieldMeta, { label: 'Password' }),
  })

  const form = useForm({ schema, key: 'signup' })
</script>

<template>
  <label>
    {{ form.fields.email.label }}
    <input
      v-register="form.register('email')"
      type="email"
      :placeholder="form.fields.email.placeholder"
    />
  </label>
</template>
```

Read `form.fields.<path>.label` / `.placeholder` (and any custom metadata you attach) directly in the template. See [Schema-attached metadata](/docs/api/zod#schema-attached-metadata) for the full surface.

### Bare Vue + SSR

For server-rendered pages, install the Vite plugin so `:value` / `:checked` / `:selected` bindings appear in the SSR HTML — without it, the first render is correct but `v-register`-bound elements briefly flash blank during hydration.

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
import { attaform } from 'attaform/vite'

export default defineConfig({
  plugins: [vue(), attaform()],
})
```

The Vite plugin also rewrites `attaform/zod` imports at build time to either `attaform/zod-v3` or `attaform/zod-v4` based on the Zod major you installed — your bundle ships exactly one adapter. Pass `attaform({ resolveZodAlias: false })` to opt out (e.g. when intentionally running both Zod versions side by side).

For [SSR payload round-tripping](/docs/recipes/ssr-hydration) (`renderAttaformState` / `hydrateAttaformState`), install the Vue plugin explicitly on your server entry — auto-install only covers the component-setup path.

### Nuxt

Add the module — it wires the Vite plugin (transforms + build-time alias), the SSR payload bridge, and `useForm` auto-imports in one step:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['attaform/nuxt'],
})
```

### App-wide options

If you want to set defaults across every `useForm` call (or disable devtools), install the Vue plugin explicitly. Auto-install always runs with default options; `createAttaform({ ... })` must run before the first `useForm`:

```ts
// main.ts
import { createApp } from 'vue'
import { createAttaform } from 'attaform'

createApp(App)
  .use(createAttaform({ defaults: { debounceMs: 100 } }))
  .mount('#app')
```

## 4. Where to next

| If you want to…                                   | Read                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| See every option `useForm` accepts                | [`attaform/zod`](/docs/api/zod)                                    |
| Understand `form.values` / `form.errors` / `meta` | [The useForm return value](/docs/api/use-form-return)              |
| Add labels, descriptions, custom payload keys     | [Schema-attached metadata](/docs/api/zod#schema-attached-metadata) |
| Persist drafts across reloads                     | [Persistence](/docs/recipes/persistence)                           |
| Validate on `blur` instead of `change`            | [Field-level validation](/docs/recipes/field-level-validation)     |
| Handle server-side validation errors              | [Server errors](/docs/recipes/server-errors)                       |
| Add undo / redo                                   | [Undo / redo](/docs/recipes/undo-redo)                             |
| Build dynamic field arrays (`append`/`remove`/…)  | [Dynamic field arrays](/docs/recipes/dynamic-field-arrays)         |
| Hit a problem                                     | [Troubleshooting](/docs/troubleshooting)                           |
