# Server-side errors (HTTP 4xx validation failures)

Client-side validation rejects bad input before it leaves the browser,
but the server has rules the client doesn't know about: "email already
taken", "coupon expired", "we couldn't reach the payment provider".
Those errors arrive after the request — `useForm` surfaces them via
`setFieldErrorsFromApi`.

## The envelope shapes we accept

`setFieldErrorsFromApi(payload)` understands two shapes. The first is a
wrapped envelope:

```ts
{
  error: {
    details: {
      email: 'already taken',
      password: ['too short', 'must contain a digit'],
    }
  }
}
```

The second is the bare details record (useful when your backend
serialises errors directly):

```ts
{
  email: 'already taken',
  password: ['too short', 'must contain a digit'],
}
```

Keys are field paths in dotted form (`'user.email'`, `'items.0.qty'`).
Values can be either a single string or an array of strings — the
helper normalises both into `ValidationError[]`.

Paths not covered by either form (numbers, booleans, other shapes)
result in `setFieldErrorsFromApi` returning an empty array and leaving
the form's error store untouched. Inspect the return to detect that
case.

## Happy-path example

```vue
<script setup lang="ts">
import { useForm } from '@chemical-x/forms/zod'
import { z } from 'zod'

const schema = z.object({
  email: z.email(),
  password: z.string().min(8),
})

const form = useForm({ schema, key: 'signup' })

const onSubmit = form.handleSubmit(async (values) => {
  try {
    await $fetch('/api/signup', { method: 'POST', body: values })
  } catch (err: any) {
    // 422 Unprocessable Entity — your server's validation disagreed.
    if (err.statusCode === 422) {
      form.setFieldErrorsFromApi(err.data)
      return
    }
    // Other errors propagate as submitError.
    throw err
  }
})
</script>

<template>
  <form @submit.prevent="onSubmit">
    <input v-register="form.register('email')" />
    <small v-if="form.fieldErrors.email?.[0]">
      {{ form.fieldErrors.email[0].message }}
    </small>

    <input v-register="form.register('password')" type="password" />
    <small v-if="form.fieldErrors.password?.[0]">
      {{ form.fieldErrors.password[0].message }}
    </small>

    <button :disabled="form.isSubmitting.value">Sign up</button>
  </form>
</template>
```

Three details worth pointing out:

1. `handleSubmit` re-runs schema validation first. By the time your
   callback fires, client-side validation has passed. Anything the
   server rejects is genuinely server-only.

2. On a successful response, `handleSubmit` clears any pre-existing
   errors. On a failed response, the previous errors stay unless you
   explicitly clear them (via `clearFieldErrors` or `reset`).

3. `submitError` captures the thrown error for the "didn't handle it"
   path — showing a top-level banner when the error isn't a 422 is a
   one-liner.

## Mixing server + client errors

Suppose the server wants to say "your coupon is invalid, but let the
user pick a new one":

```ts
if (err.statusCode === 422) {
  // Clear any pre-existing errors on `coupon` first, so the new one
  // replaces the old.
  form.clearFieldErrors('coupon')
  // Then add server-reported errors. addFieldErrors preserves any
  // other errors currently in the store.
  form.addFieldErrors(
    (err.data.coupon ?? []).map((message: string) => ({
      path: ['coupon'],
      message,
      formKey: form.key,
    }))
  )
}
```

`setFieldErrorsFromApi` is still the right default for "replace
everything from the server payload"; `addFieldErrors` is for finer
control.

## Handling non-field errors

Some errors aren't tied to a field — "our payment provider is down",
"try again in 30 seconds". These belong in `submitError`, not
`fieldErrors`:

```ts
const onSubmit = form.handleSubmit(async (values) => {
  const res = await $fetch('/api/signup', { method: 'POST', body: values })
  if (!res.ok) {
    // Throwing keeps submitError populated for a top-level banner.
    throw new Error(res.error ?? 'Something went wrong. Try again shortly.')
  }
})
```

```vue
<template>
  <p v-if="form.submitError.value" role="alert">
    {{ (form.submitError.value as Error).message }}
  </p>
</template>
```
