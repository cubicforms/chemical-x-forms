---
title: 'attaform/nuxt — Nuxt module'
description: 'Drop-in Nuxt module for Attaform: installs the Vue plugin, registers the v-register transforms and the attaform/vite plugin, threads form state through the SSR payload, and auto-imports useForm — all configurable inline via the `attaform` configKey.'
---

# `attaform/nuxt`

A Nuxt module that wires up Attaform end-to-end on Nuxt 3 / 4. Add it to `modules` in `nuxt.config.ts` and you're done — no extra plugin file, no manual `app.use(createAttaform())`.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['attaform/nuxt'],
})
```

## What the module does

- **Installs the Vue plugin.** `createAttaform()` runs against the Nuxt app on both server and client — the registry is attached, `v-register` is registered as a global directive, and devtools wires up.
- **Registers the [`attaform/vite`](/docs/api/vite) plugin.** The compile-time `v-register` transforms (`:value` / `:checked` / `:selected` injection) and the build-time `attaform/zod` alias are both active without you touching `nuxt.options.vite`.
- **Threads form state through the SSR payload.** Form values, errors, meta, and pending hydration round-trip from server-render to client-hydrate without manual `renderAttaformState` / `hydrateAttaformState` calls. Pages render with their final state, no hydration mismatch flicker.
- **Auto-imports `useForm`.** Composables can call `useForm({ schema })` with no explicit import statement, matching Nuxt's broader auto-import convention.
- **Force-includes peer deps in Vite's optimizeDeps.** `zod` and `@vue/devtools-api` are pre-bundled at startup so dynamic page-chunk imports don't trigger Vite's "discovered new dependencies at runtime" full-reload pass.

## Configuration

The module declares the `attaform` configKey, so options sit alongside `modules` in your `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['attaform/nuxt'],
  attaform: {
    defaults: {
      debounceMs: 100,
      onInvalidSubmit: 'focus-first-error',
    },
    resolveZodAlias: false,
  },
})
```

The same shape works as a tuple under `modules` if you prefer the inline form:

```ts
modules: [['attaform/nuxt', { defaults: { debounceMs: 100 } }]],
```

Both forms are equivalent — the configKey form is what most Nuxt module docs lead with, and is what you'll see in the rest of these docs.

### Options

| Option            | Type                            | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaults`        | [`AttaformDefaults`](#defaults) | `{}`    | App-level defaults applied to every `useForm` call. Per-form options always win. See [App-level defaults](/docs/recipes/app-defaults) for the resolution order, merge semantics, and the full list of supported keys (`strict`, `validateOn`, `debounceMs`, `onInvalidSubmit`, `history`, `rememberVariants`, `coerce`).                                                                                                                                                                                             |
| `resolveZodAlias` | `boolean`                       | `true`  | Forwarded to [`attaform/vite`'s `resolveZodAlias`](/docs/api/vite#resolvezodalias) option. When `true`, `attaform/zod` imports are rewritten at build time to either `attaform/zod-v3` or `attaform/zod-v4` based on the installed Zod major, so the bundle ships exactly one adapter. Set to `false` to bypass the rewrite and ship the runtime-dispatch unified entry instead — useful when your project intentionally has both Zod versions installed (via aliasing) or when monorepo resolution is non-standard. |

### `defaults`

The shape of the `defaults` object:

```ts
type AttaformDefaults = {
  strict?: boolean
  validateOn?: 'change' | 'blur' | 'submit'
  debounceMs?: number
  onInvalidSubmit?: 'none' | 'focus-first-error' | 'scroll-to-first-error' | 'both'
  history?: true | { max?: number }
  rememberVariants?: boolean
  coerce?: boolean | CoercionRegistry
}
```

`schema`, `key`, `defaultValues`, and `persist` are intentionally NOT supported at the app level — see [App-level defaults § What's supported](/docs/recipes/app-defaults#whats-supported) for the rationale.

### Reading defaults at runtime

The module publishes the resolved defaults to `runtimeConfig.public.attaform`:

```ts
const { attaform } = useRuntimeConfig().public
// attaform.defaults — the AttaformDefaults bag you passed in
```

You usually don't need this — the form library reads it internally — but it's there if a custom integration wants to mirror the same defaults outside `useForm`.

## Auto-imports

`useForm` is auto-imported from `attaform`. Both `<script setup>` and `<script>` blocks in `.vue` files, plus any file under `composables/` and `utils/`, can call it without importing:

```vue
<script setup lang="ts">
  import { z } from 'zod'

  // No `import { useForm } from 'attaform/zod'` needed.
  const form = useForm({
    schema: z.object({ email: z.email() }),
    key: 'signup',
  })
</script>
```

The auto-imported binding points at the schema-agnostic `useForm` from the `attaform` root entry. To use the typed Zod wrapper (which gives you the strongest schema inference), import it explicitly from `attaform/zod`, `attaform/zod-v3`, or `attaform/zod-v4` — your call site decides; the auto-import is convenience only.

## SSR

Server rendering works without any extra wiring. The module's plugin runs on both server and client; on the server it captures the registry's serialised state into `nuxtApp.payload` after render, and on the client the matching plugin pass reads that payload back into the registry before any component setup runs. The end result is that hydration sees the same form values, errors, and pending state the server emitted — no flash of empty inputs, no double-submit on hydration.

If you're driving SSR manually (custom Vite SSR, Vue's `renderToString` directly), reach for `renderAttaformState` / `hydrateAttaformState` instead — the Nuxt module is the right default for Nuxt projects, and the bare helpers are the escape hatch for everything else. See [SSR hydration](/docs/recipes/ssr-hydration) for the underlying mechanism.

## See also

- [App-level defaults](/docs/recipes/app-defaults) — full options table, resolution order, and merge semantics.
- [`attaform/vite`](/docs/api/vite) — the Vite plugin the module installs for you. Same `resolveZodAlias` option lives there.
- [SSR hydration](/docs/recipes/ssr-hydration) — the underlying payload mechanism the module wires up automatically.
