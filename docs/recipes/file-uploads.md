---
title: 'File uploads'
description: 'How Attaform binds `<input type="file">` to form state — picking, clearing, validation, and the production pattern for persisting uploads across reloads.'
---

# `<input type="file" v-register>`

`v-register` binds `<input type="file">` to form state the same way it
binds every other native input. Picks flow into storage as `File | null`
(single) or `File[]` (multiple). Required-file fields surface
"No value supplied" through the same `derivedBlankErrors` channel as
required numbers or bigints. The schema author writes `z.file()` (Zod 4)
or `z.instanceof(File)` (Zod 3) and gets typed inference back without
any plumbing.

```vue
<script setup lang="ts">
  import { z } from 'zod'
  import { useForm } from 'attaform/zod'

  const schema = z.object({
    avatar: z.file().nullable(),
    docs: z.array(z.file()),
  })

  const form = useForm({ schema, key: 'profile' })
</script>

<template>
  <form @submit="form.handleSubmit((data) => upload(data))">
    <input v-register="form.register('avatar')" type="file" accept="image/*" />
    <input v-register="form.register('docs')" type="file" multiple />
  </form>
</template>
```

## Storage shape

| Element                        | Storage value  | Blank state                   |
| ------------------------------ | -------------- | ----------------------------- |
| `<input type="file">`          | `File \| null` | `null` + path in `blankPaths` |
| `<input type="file" multiple>` | `File[]`       | `[]` + path in `blankPaths`   |

The directive canonicalises blank storage to `null` / `[]` regardless of
how you expressed "optional file" in the schema — `z.file()`,
`z.file().nullable()`, or `z.file().optional()` all settle to the same
runtime shape on register and on clear.

## What the directive owns

The variant takes care of:

- Reading `event.target.files` on change → writing `File` / `File[]` /
  `null` to storage.
- Detecting `multiple` from the DOM (`el.multiple`) so the right shape
  lands.
- Marking the path in `blankPaths` whenever storage transitions to the
  blank shape — on register, on user clear, on `form.clear(path)`, on
  `form.reset()`, and on hydration. The friendly "No value supplied"
  error stays accurate without any consumer code.
- Clearing the DOM input (`el.value = ''`) when storage goes blank.
  The browser blocks every other programmatic write to `input.files`
  for security, but the empty-string assignment is permitted.
- Refusing to opt the path into persistence regardless of
  `register(path, { persist: true })` — see below.

## Files don't persist

`File` objects are transient browser-side handles. They can't survive a
reload by design:

- `JSON.stringify(new File([...], 'x'))` returns `"{}"`. The browser
  doesn't expose the bytes to serialization.
- `input.files` is read-only at the browser layer. Even if you
  serialized the bytes elsewhere and rehydrated, you couldn't push a
  reconstructed `File` back into the DOM input.
- `localStorage` caps at ~5 MB anyway. A single phone photo blows past
  that.

So Attaform carves file paths out of the persistence opt-in registry
entirely. A file input registered with `{ persist: true }` is silently
ignored at the persistence boundary, and a one-time dev warning fires
to surface the gap during development:

```
[attaform] register('avatar', { persist: true }) on <input type="file"> —
files can't ride a refresh (browsers block programmatic writes to
<input type="file">), so this path won't be saved. For long-lived
flows, upload on selection and persist the resulting URL or ID in a
sibling string field.
```

The warning fires once per `(form, path)` so it surfaces during dev
without flooding the console. In production builds it's tree-shaken
out.

## The production pattern — upload on selection

For long-running forms (SAAS onboarding, multi-step uploads, anything
non-trivial), pair an **ephemeral File field** with a **persisted URL
field**. The File ride the picker UI; the URL rides the form state
across refreshes.

```vue
<script setup lang="ts">
  import { watch } from 'vue'
  import { z } from 'zod'
  import { useForm } from 'attaform/zod'

  const schema = z.object({
    // Ephemeral handle for the picker UI — never persists.
    idFile: z.file().nullable(),

    // The "real" field your backend cares about. Survives refresh.
    idUrl: z.string().url(),
  })

  const form = useForm({ schema, key: 'shipment', persist: 'local' })

  watch(
    () => form.values.idFile,
    async (file) => {
      if (file === null) return
      const url = await uploadToBackend(file)
      form.setValue('idUrl', url)
    }
  )
</script>

<template>
  <input v-register="form.register('idFile')" type="file" accept="application/pdf" />
  <span v-if="form.values.idUrl">Already uploaded ✓</span>
</template>
```

After a refresh: `idFile` is back at `null` (correctly — can't persist),
but `idUrl` survives. The form remembers the upload already happened
and the user doesn't have to redo it.

## What happens on a refresh without the URL pattern

Short-lived forms can skip the URL plumbing and accept the trade-off:
on refresh, the file is gone and the user re-picks. Validation makes
the gap obvious — the required-file error surfaces immediately:

```ts
const schema = z.object({ id: z.file() })
const form = useForm({ schema, key: 'contact', persist: 'local' })

// On reload: form.values.id === null, fields.id.blank === true,
// errors.id includes "No value supplied". The user re-picks the file
// to satisfy the schema before submit.
```

Perfectly fine for a 30-second contact form. For anything where losing
a file is painful (an ID upload mid-stepper, a draft document, a
multi-photo gallery), use the upload-on-select pattern above.

## Validation

Schema-level constraints on files work the way you'd expect:

```ts
const schema = z.object({
  avatar: z
    .file()
    .max(2 * 1024 * 1024)
    .mime(['image/png', 'image/jpeg']),
  docs: z
    .array(z.file().max(5 * 1024 * 1024))
    .min(1)
    .max(10),
})
```

Refinement errors surface through `form.errors.<path>` and per-field
`fields.<path>.errors`. The "No value supplied" error (from the blank
channel) wins display priority over schema errors so users see the
relevant message first — _"upload an ID"_ instead of
_"Expected File, received null"_.

## Zod 3 vs Zod 4

Both work the same through the directive — file events flow into form
state identically regardless of which schema major produced the field.
The schema-level idiom differs:

- **Zod 4**: `z.file()` is native, with `.min(size)` / `.max(size)` /
  `.mime([...])` constraints.
- **Zod 3**: `z.instanceof(File)` (single) and
  `z.array(z.instanceof(File))` (multiple). Custom refinements via
  `.refine((f) => f.size <= MAX, ...)`.

Use whichever your project's adapter is on. The Attaform plumbing
treats both the same once the value lands in storage.

## SSR

The directive's listener-attachment is client-only — Vue skips
directive lifecycle hooks during SSR, so server renders emit an empty
file input and hydration takes over from there. There's nothing
file-specific to configure for SSR; the same `useForm` + `v-register`
that works for text inputs works here.
