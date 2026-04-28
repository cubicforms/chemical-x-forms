# Async validation

Use `z.refine(async …)` anywhere in your schema — uniqueness checks,
allow-lists, server availability. Chemical X awaits the result before
dispatching your submit handler.

## Async refinements

```ts
import { z } from 'zod'
import { useForm } from '@chemical-x/forms/zod'

const signupSchema = z.object({
  email: z.email().refine(async (value) => {
    const res = await fetch(`/api/email-available?e=${encodeURIComponent(value)}`)
    const { available } = (await res.json()) as { available: boolean }
    return available
  }, 'Email already registered'),
  password: z.string().min(8),
})

const { handleSubmit, fieldErrors } = useForm({ schema: signupSchema, key: 'signup' })
```

That's all the wiring you need. `handleSubmit` validates, waits for
any async refinement to settle, and then dispatches to your callback
(or populates `fieldErrors` if validation fails).

## Live "checking…" UI with `validate()`

`validate()` returns a reactive ref whose value carries a `pending`
flag — use it to show a spinner while async validation is in flight.

```vue
<script setup lang="ts">
  const { validate } = useForm({ schema: signupSchema, key: 'signup' })
  const status = validate()
</script>

<template>
  <p v-if="status.pending">Checking…</p>
  <p v-else-if="status.success">Looks good!</p>
  <ul v-else>
    <li v-for="e in status.errors" :key="e.message">{{ e.message }}</li>
  </ul>
</template>
```

When the form mutates, `pending` flips back to `true` and the
library re-validates. If the user types faster than the server can
answer, older responses are discarded — your ref only ever shows the
latest result.

## One-shot validation with `validateAsync(path?)`

For non-submit flows — a "continue" button on a wizard, a manual
re-check after a server round-trip — `await` a single validation run:

```ts
const { validateAsync, fieldErrors } = useForm({ schema, key: 'signup' })

async function onContinueClick() {
  const result = await validateAsync()
  if (!result.success) return
  goToNextStep()
}
```

`validateAsync(path)` validates the subtree at `path`; `validateAsync()`
validates the whole form.

## Disabling buttons during validation

`state.isValidating` is a reactive boolean that's `true` while ANY
validation run is in flight — submit, reactive `validate()`, or
`validateAsync`. Gate UI off it:

```vue
<button :disabled="form.state.isValidating || form.state.isSubmitting">Continue</button>
```

## Combining with server errors

Async validation covers what the **schema** knows. Real server
errors (payment declined, coupon expired) still arrive after a real
POST — parse them via `parseApiErrors` and write them with
`setFieldErrors` in your `catch`. Wire entries are
`{ message, code }` (both required); see the
[server-errors recipe](./server-errors.md) for the full payload
shape.

```ts
import { parseApiErrors } from '@chemical-x/forms'

const onSubmit = handleSubmit(async (values) => {
  try {
    await $fetch('/api/signup', { method: 'POST', body: values })
  } catch (err) {
    if (err.statusCode === 422) {
      const result = parseApiErrors(err.data, { formKey: form.key })
      if (result.ok) {
        setFieldErrors(result.errors)
        focusFirstError({ preventScroll: true })
      }
    }
  }
})
```

`state.isSubmitting` stays `true` across the full handler
(validation + server round-trip), so UI gated on it works without
extra wiring.

## Cross-field validation

Use zod's sync `.refine` for rules that span fields:

```ts
const schema = z
  .object({
    password: z.string().min(8),
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  })
```

Sync and async refines work side by side — the adapter runs both in
order.

## Discriminated unions

Let one field decide the shape of the rest:

```ts
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('card'), number: z.string().min(16) }),
  z.object({ type: z.literal('bank'), routing: z.string().length(9) }),
])
```

Both Zod adapters pick the active branch from the discriminator's
current value and validate against only that branch.

## Seeding the form from an async source

`useForm` itself runs synchronously — for "fetch the user's profile,
then show the form pre-filled", seed inside `onMounted`:

```ts
const form = useForm({ schema, key: 'profile' })

onMounted(async () => {
  const profile = await $fetch('/api/profile')
  form.reset(profile)
})
```

`reset(next)` applies `next` over the schema's defaults — same
precedence rules as the `defaultValues` option on `useForm`.
