# Form context in nested components

Splitting a form across components? Don't prop-drill `register` /
`fieldErrors` / `handleSubmit` through every layer. Call
`useFormContext()` in any descendant and get the same handle back.

## The common case — ambient resolution

Parent owns the form:

```vue
<!-- SignupForm.vue -->
<script setup lang="ts">
  import { useForm } from '@chemical-x/forms/zod'
  import { z } from 'zod'

  interface Form {
    email: string
    profile: { name: string; age: number }
  }

  const schema = z.object({
    email: z.email(),
    profile: z.object({ name: z.string(), age: z.number() }),
  })

  const { handleSubmit } = useForm<Form>({ schema, key: 'signup' })
  const onSubmit = handleSubmit(async (values) => {
    await api.post('/signup', values)
  })
</script>

<template>
  <form @submit.prevent="onSubmit">
    <EmailRow />
    <ProfileGroup />
    <button>Sign up</button>
  </form>
</template>
```

Any descendant grabs the same form:

```vue
<!-- EmailRow.vue -->
<script setup lang="ts">
  import { useFormContext } from '@chemical-x/forms/zod'

  interface Form {
    email: string
    profile: { name: string; age: number }
  }

  const { register, fieldErrors } = useFormContext<Form>()
</script>

<template>
  <label>Email</label>
  <input v-register="register('email')" type="email" />
  <small v-if="fieldErrors.email?.[0]">
    {{ fieldErrors.email[0].message }}
  </small>
</template>
```

You supply the `Form` generic — Vue's injection system erases it,
so the library can't recover your shape on your behalf. Other than
that, `useFormContext<Form>()` returns an object type-identical to
`useForm`'s return.

## Reaching a form that isn't an ancestor

Floating save buttons, sidebar status widgets, anything in a
different branch of the component tree:

```vue
<!-- FloatingSaveButton.vue (anywhere in the app) -->
<script setup lang="ts">
  import { useFormContext } from '@chemical-x/forms/zod'

  interface Form {
    /* … */
  }

  const { state, handleSubmit } = useFormContext<Form>('signup')
</script>

<template>
  <button :disabled="!state.isDirty || state.isSubmitting" @click="handleSubmit(onSave)()">
    Save
  </button>
</template>
```

Pass the same `key` you passed to `useForm({ key: 'signup' })`. If no
form is registered under that key when the component mounts, you
get a clear error naming the missing key.

## Do I need to pass a `key` to `useForm`?

Only if something else needs to find the form by name:

- **Ambient access is free.** `useFormContext<Form>()` with no
  argument resolves via Vue's `provide`/`inject` and doesn't care
  whether the owning `useForm` had a key. A key-less parent + a
  key-less descendant call works identically to a named pair.
- **Distant access needs a key.** `useFormContext<Form>('signup')`
  looks the form up in the registry by name; if `useForm` didn't
  supply one, the name isn't discoverable.

Skip `key` for single-component one-off forms (login modal,
settings panel). Supply one when you want cross-component lookup,
multi-call-site shared state, a stable persistence default, or a
legible DevTools label.

### Gotcha: multiple `useForm` calls in the same component

Vue's `provide`/`inject` is last-write-wins per component. If a
parent calls `useForm` twice, the second call overwrites the first
in the ambient context, and descendants using
`useFormContext<Form>()` (no key) will only see the second form.

```ts
// Parent component
const formA = useForm({ schema: schemaA }) // provides ambient → A
const formB = useForm({ schema: schemaB }) // provides ambient → B (overwrites A)
// Descendants' useFormContext<Form>() reads B. A is unreachable via ambient.
```

The runtime emits a dev-mode `console.warn` when it detects a
second ambient provide on the same component, naming both forms so
the regression is visible at the site.

**Fixes** — either give each form a key and use explicit lookup
downstream:

```ts
useForm({ schema: schemaA, key: 'a' })
useForm({ schema: schemaB, key: 'b' })
// Descendants:
const a = useFormContext<FormA>('a')
const b = useFormContext<FormB>('b')
```

…or split the two forms into their own components. Components
owning a single form don't hit this.

## Lifetime

Both resolution modes ref-count on the form's registry entry. In
practice:

- The form survives until every component that reached it unmounts.
- You don't coordinate cleanup — it just works.
- A form accessed only by `useFormContext(key)` stays alive as long
  as at least one consumer is mounted, even if the original
  `useForm` owner unmounted first.

## Error messages

`useFormContext()` throws only in two cases:

- **No ambient form** — you called `useFormContext()` with no
  ancestor `useForm` and no key argument. The error names both
  resolutions so you can pick either.
- **Key not registered** — you called `useFormContext('key-name')`
  but nothing is registered. The error includes the key value so
  you can spot typos or mounting-order bugs.

## When not to use it

If your form logic fits in one component, stick with `useForm`
directly. `useFormContext` is a small reactive overhead you don't
need when there's nothing to share.

Reach for it when field components are reusable across forms, or
when a distant component needs read-only status (`state.isDirty`,
`state.isSubmitting`, `fieldErrors`) of a form it doesn't own.
