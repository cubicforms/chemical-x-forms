# Form context in nested components

Splitting a form across components? Don't prop-drill `register` /
`errors` / `handleSubmit` through every layer. Call
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

  // Anonymous useForm — ambient mode. Pass `key: 'signup'` instead
  // when descendants should reach it via `useFormContext<Form>('signup')`.
  const { handleSubmit } = useForm<Form>({ schema })
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

  const { register, errors } = useFormContext<Form>()
</script>

<template>
  <label>Email</label>
  <input v-register="register('email')" type="email" />
  <small v-if="errors.email?.[0]">
    {{ errors.email[0].message }}
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

The two resolution modes are cleanly split:

- **Anonymous (no `key`) → ambient access.** `useForm({ schema })`
  fills the parent's ambient slot. Any descendant's
  `useFormContext<Form>()` (no key) resolves to it.
- **Keyed (`key: 'x'`) → explicit access only.** `useForm({ schema,
key: 'x' })` registers the form under `'x'` but does NOT fill the
  ambient slot. Descendants reach it via `useFormContext<Form>('x')`,
  not via the no-key form.

Skip `key` for single-component one-off forms (login modal,
settings panel). Supply one when you want cross-component lookup,
multi-call-site shared state, a stable persistence default, or a
legible DevTools label.

### Gotcha: multiple anonymous `useForm` calls in the same component

Vue's `provide`/`inject` is last-write-wins per component. If a
parent calls `useForm` twice without keys, the second overwrites
the first in the ambient slot, and descendants using
`useFormContext<Form>()` only see the second.

```ts
// Parent component
const formA = useForm({ schema: schemaA }) // provides ambient → A
const formB = useForm({ schema: schemaB }) // provides ambient → B (overwrites A)
// Descendants' useFormContext<Form>() reads B. A is unreachable via ambient.
```

The runtime emits a dev-mode `console.warn` lazily — when (and only
when) a descendant actually consumes the ambient slot via
`useFormContext<Form>()` with no key. The warning lists each
anonymous `useForm()` call by source frame so you can navigate to
the offending sites.

**Fix** — give each form a key (which removes them from the ambient
slot entirely) and look them up explicitly:

```ts
useForm({ schema: schemaA, key: 'a' })
useForm({ schema: schemaB, key: 'b' })
// Descendants:
const a = useFormContext<FormA>('a')
const b = useFormContext<FormB>('b')
```

Mixing modes is fine — keyed forms don't interfere with an ambient
sibling. A parent with three keyed forms plus one anonymous form
produces no warning; the descendant's `useFormContext<F>()`
unambiguously resolves to the (only) anonymous one.

…or split the two anonymous forms into separate components, so each
owns the ambient slot of its own subtree.

## Lifetime

Both resolution modes ref-count on the form's registry entry. In
practice:

- The form survives until every component that reached it unmounts.
- Cleanup is automatic — no explicit dispose call from the consumer.
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
`state.isSubmitting`, `errors`) of a form it doesn't own.
