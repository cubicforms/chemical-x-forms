# Form context for nested components

A form's API (`register`, `getFieldState`, `handleSubmit`, …) normally
comes from the `useForm` call that owns the form. Once you split that
form across multiple components — a `FieldGroup`, a reusable `EmailRow`
— every child needs the same API. Prop-threading works for a single
level, but nested two or three levels deep it gets tedious.

`useFormContext` solves this by letting descendants (or sibling
components) resolve the ambient form without threading props.

## Ambient resolution (the common case)

Call `useForm` in the ancestor that owns the form. Call
`useFormContext` in any descendant. The child gets a handle that is
type-identical to `useForm`'s return and reads / writes the same
underlying state.

```vue
<!-- SignupForm.vue — the owner -->
<script setup lang="ts">
import { useForm } from '@chemical-x/forms/zod'
import { z } from 'zod'

interface Form {
  email: string
  profile: { name: string; age: number }
}

const schema = z.object({
  email: z.string().email(),
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

```vue
<!-- EmailRow.vue — resolves the nearest form via provide/inject -->
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

`useFormContext<Form>()` resolves whichever form the nearest ancestor
`useForm({…})` call owns, via Vue's `provide` / `inject`. You supply
the `Form` generic because Vue's `InjectionKey` erases it — the library
can't recover the shape on your behalf.

## Explicit-key resolution (distant components)

Sometimes the component that needs the form isn't a descendant — a
sidebar status widget, a floating submit button at the app root, or
anything sitting alongside the form in the component tree. Pass the
form's key to `useFormContext` to bypass the ambient lookup and reach
the form by its registry entry:

```vue
<!-- FloatingSaveButton.vue — anywhere in the app -->
<script setup lang="ts">
import { useFormContext } from '@chemical-x/forms/zod'

interface Form { /* … */ }

const { isDirty, isSubmitting, handleSubmit } = useFormContext<Form>('signup')
</script>

<template>
  <button
    :disabled="!isDirty || isSubmitting"
    @click="handleSubmit(onSubmit)()"
  >
    Save
  </button>
</template>
```

The key is the same `key` you passed to the owning `useForm` call.
If no form is registered under that key at the time `useFormContext`
runs, it throws a descriptive error — you'll see which key was
requested.

## Lifetime

Both resolution modes ref-count their consumer on the form's registry
entry. That means:

- The form's state survives until every component that reached it —
  the owner plus every `useFormContext` consumer — has unmounted.
- You don't have to coordinate teardown between parent and child; the
  registry evicts the state after the last release.
- A form accessed only by `useFormContext` calls (via an explicit key)
  is kept alive by those calls while they're mounted, even if the
  original `useForm` owner unmounts first.

## Error messages

`useFormContext()` throws in two cases:

- **No ambient form**: you called `useFormContext()` without an
  ancestor `useForm` and without an explicit key. The message names
  both resolutions so you can pick either.

- **Key not registered**: you called `useFormContext(key)` but no
  form is registered under that key. The message includes the key
  value so you can debug typos or mounting-order bugs.

## When not to use it

If your form logic fits inside a single component, skip
`useFormContext` — `useForm` is cheaper (no injection lookup, no
extra ref-count) and the prop-free single-component shape is easier
to read.

Use `useFormContext` when field components want to be reusable across
multiple forms, or when a distant component needs read-only status
(dirty, submitting, validation errors) of a form it doesn't own.
