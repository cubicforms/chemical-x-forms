---
title: 'Why Attaform'
description: 'Why teams pick Attaform for Vue 3 forms — schema-driven types, validation, SSR, persistence, undo/redo, devtools, all from one Zod schema.'
---

# Why Attaform

You're choosing a form library for a Vue&nbsp;3 or Nuxt project, and you
have to bet on something that'll still feel right at the end of the
year — not just at the end of the afternoon. Here's the case for
Attaform, on its own terms.

## One source of truth: your schema

Write a Zod schema. That's the source of truth for:

- **Types** — every path, value, error, and write shape is inferred.
  No `any`, no manual generics, no reaching for the type plumbing
  whenever you add a field.
- **Defaults** — Attaform reads the schema's slim shape (`''` for
  strings, `0` for numbers, `false` for booleans) and uses it as the
  storage default. Override per field; don't repeat what the schema
  already says.
- **Validation** — refinements run synchronously by default, async
  refinements await before submit dispatches.
- **Errors** — refinements emit, paths surface — `form.errors.email`
  is reactive end-to-end.

One schema in, full reactive surface out. The schema is the API.

## Type-safe end to end

Every part of the public surface is typed against your schema:

```ts twoslash
import { useForm } from 'attaform/zod'
import { z } from 'zod'

const schema = z.object({
  email: z.email(),
  age: z.number().int().min(13),
})

const form = useForm({ schema })

// `form.fields.<path>` knows the exact set of paths in the schema.
// `form.errors.<path>` is reactive, typed, narrowable.
// `form.setValue('age', 'twenty-one')` is a type error.
form.setValue('age', 21)
```

`form.fields(path)` returns aggregated state at any depth — leaves
or containers, both. You don't write a separate "are any of these
fields touched" reducer; the rolled-up FieldState already knows.

## Live, layered validation

- Per-field on `change`, `blur`, or `submit` — your call, per form.
- Sync refinements fire on the keystroke, async refinements await.
- A form's `meta.valid` is _gated_ — it only flips true after every
  active path has resolved at least one validation pass, including
  the async ones. No flash-of-valid window for users with a slow
  uniqueness check.
- Server-side errors map back into the same reactive store via
  `parseApiErrors`. The render surface is the same whether the
  error came from Zod or your API.

## SSR-first, hydration-clean

Forms render server-side and hydrate without a flash:

- **Nuxt** — zero config. The module ships an SSR plugin that
  threads form state through `nuxtApp.payload`. Values, errors,
  touched / focused / blurred flags all round-trip.
- **Bare Vue 3 + `@vue/server-renderer`** — two one-liner helpers
  (`renderAttaformState` / `hydrateAttaformState`) bridge the
  server → client boundary.

The form your server rendered _is_ the form your client picks up.
Read [`recipes/ssr-hydration`](./recipes/ssr-hydration.md) for the
full setup.

## Built-in, not bolted on

These ship with the core, not as third-party plugins:

- **Field arrays** — typed `append` / `insert` / `remove` / `swap`
  with stable keys and per-item validation.
- **Undo / redo** — bounded history stack, opt-in per form,
  integrates cleanly with persistence and SSR.
- **Persistence** — opt-in per field, write to localStorage,
  sessionStorage, or IndexedDB. Sensitive paths (passwords, tokens)
  are excluded by default.
- **Discriminated unions** — variant-aware fields, snapshot/restore
  on discriminator change. Switch between branches without losing
  the values you typed.
- **DevTools** — every form shows up in the Vue DevTools panel:
  inspect state, errors, history, persistence drafts.
- **Schema-attached metadata** — `withMeta(schema, { label,
description })` flows directly into `form.fields.<path>.label`.
  Stop hard-coding labels in JSX.

## Native inputs, Vue directive

`v-register` is a Vue directive, not a wrapper component. Your
`<input>` stays a native `<input>`; there's no field-component
overhead between the DOM and the form.

```vue
<input v-register="form.register('email')" />
```

That's the whole binding. A11y attributes, value sync, focus state,
blank tracking — all native.

## Tree-shakable, ESM-only

Attaform ships ESM. The Vite plugin applies `v-register` transforms
at compile time so the production bundle stays slim — no runtime
directive resolution, no compatibility shims for non-Vue
environments. Bring only the entry you need: `attaform/zod` for
Zod 4, `attaform/zod-v3` for Zod 3, `attaform/nuxt` for the Nuxt
module, `attaform/vite` for the build plugin.

## Where to next

| Goal                                 | Read                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| Get a form on screen                 | [Quick start](./quickstart.md)                         |
| Understand the full surface          | [`useForm` return value](./api/use-form-return.md)     |
| Add server-side errors               | [Server errors](./recipes/server-errors.md)            |
| SSR-render forms in Nuxt or bare Vue | [SSR hydration](./recipes/ssr-hydration.md)            |
| Persist long forms across reloads    | [Persistence](./recipes/persistence.md)                |
| Compare with what you already write  | [The `useForm` return value](./api/use-form-return.md) |
