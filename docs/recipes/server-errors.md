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

## Security considerations

`setFieldErrorsFromApi` accepts arbitrary-shaped payloads from the
server. If the server itself is trusted (it's your backend, your
ORM, your error mapper), the defaults are fine. If the payload
crosses an untrusted boundary — a gateway that forwards third-party
validation errors, a federated API, a passthrough microservice —
three things are worth knowing:

1. **DoS surface.** The hydrator walks the whole details record. An
   attacker-controlled payload with tens of thousands of keys, each
   carrying a deep dotted path, costs memory and CPU on the client.
   `setFieldErrorsFromApi` takes an optional second argument with
   `maxEntries` (default 1 000) and `maxPathDepth` (default 32).
   Over-entry payloads are rejected wholesale; over-depth individual
   keys are dropped. Tighten the caps for gateway code:

   ```ts
   form.setFieldErrorsFromApi(response, { maxEntries: 50, maxPathDepth: 8 })
   ```

2. **Message content is rendered.** Vue escapes text content by
   default — no XSS — but the error copy is still visible to your
   user. An attacker-controlled `message` field can display misleading
   UI text ("Your account has been suspended — click here to verify").
   Validate the shape and length of server messages before binding.

3. **Path-traversal into fields that don't exist.** The hydrator
   accepts any string key. A malicious server could push an error
   onto `users.0.adminPasswordHash`, which is harmless (the form has
   no such field) but might confuse your UI's error surfacing. Either
   parse the payload against a Zod schema before calling
   `setFieldErrorsFromApi`, or post-filter the returned
   `ValidationError[]` against your schema's known paths.

Zod-parsing the response is the cleanest option — the details record
becomes a typed `Record<string, string | string[]>`, and anything
else fails at the boundary:

```ts
const ErrorPayload = z.object({
  error: z.object({
    details: z.record(
      z.string(),
      z.union([z.string(), z.array(z.string())])
    ),
  }),
})

const parsed = ErrorPayload.safeParse(response)
if (parsed.success) {
  form.setFieldErrorsFromApi(parsed.data, { maxEntries: 200 })
}
```
