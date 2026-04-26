# Server errors (HTTP 4xx validation failures)

Client-side schema validation rejects bad shape before the request
leaves the browser. The server has rules the client doesn't —
"email already taken", "coupon expired", "we couldn't reach the
payment provider" — and those come back as `fieldErrors` via
`setFieldErrorsFromApi`.

## The usual case

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
      if (err.statusCode === 422) {
        form.setFieldErrorsFromApi(err.data)
        return
      }
      throw err // Other errors flow through to `state.submitError`.
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

    <button :disabled="form.state.isSubmitting">Sign up</button>
  </form>
</template>
```

By the time your callback runs, client-side schema validation has
already passed — `setFieldErrorsFromApi` is genuinely for server-
only failures.

**API-injected errors persist** across schema revalidation and
successful submits. `setFieldErrors`, `addFieldErrors`, and
`setFieldErrorsFromApi` all write to a separate user-error store
(internally distinct from the schema-validation pipeline's store);
nothing automatically clears them. The user's next keystroke will
re-run schema validation against the field — that updates the
schema-error half, but your API entries stay until you call
`clearFieldErrors(path)` (or unmount the form).

The two flavours surface together in `fieldErrors[path]` (schema
entries first, user entries second), so templates render both
without branching.

## Payload shapes

Two shapes work out of the box. A wrapped envelope:

```ts
{
  error: {
    details: {
      email: 'already taken',
      password: ['too short', 'must contain a digit'],
    },
  },
}
```

Or a bare details record:

```ts
{
  email: 'already taken',
  password: ['too short', 'must contain a digit'],
}
```

Keys are dotted paths (`'user.email'`, `'items.0.qty'`). Values can
be a string or an array of strings — both normalise into
`ValidationError[]`.

Anything else — numbers, booleans, nested objects — returns an
empty array and leaves your error store untouched. Inspect the
return to branch on that case.

## Pairing with focus-on-error

A 422 with no visible focus is invisible to screen-reader users and
easy to miss for sighted users scrolled past the error. Hydrate

- focus in the same block:

```ts
import { focusFirstError } from '@chemical-x/forms'

const onSubmit = form.handleSubmit(async (values) => {
  try {
    await $fetch('/api/signup', { method: 'POST', body: values })
  } catch (err: any) {
    if (err.statusCode === 422) {
      form.setFieldErrorsFromApi(err.data)
      form.focusFirstError({ preventScroll: true })
      form.scrollToFirstError({ block: 'center', behavior: 'smooth' })
    }
  }
})
```

## Mixing server + client errors

To replace one field's error without wiping the rest:

```ts
if (err.statusCode === 422) {
  form.clearFieldErrors('coupon')
  form.addFieldErrors(
    (err.data.coupon ?? []).map((message: string) => ({
      path: ['coupon'],
      message,
      formKey: form.key,
    }))
  )
}
```

`setFieldErrorsFromApi` is the right default for "replace everything
from this payload". `addFieldErrors` + `clearFieldErrors` are for
finer control.

## Non-field errors

Some server errors aren't tied to a field — rate limits, provider
outages. They belong in `state.submitError`, not `fieldErrors`:

```ts
const onSubmit = form.handleSubmit(async (values) => {
  const res = await $fetch('/api/signup', { method: 'POST', body: values })
  if (!res.ok) {
    throw new Error(res.error ?? 'Something went wrong. Try again shortly.')
  }
})
```

```vue
<template>
  <p v-if="form.state.submitError" role="alert">
    {{ (form.state.submitError as Error).message }}
  </p>
</template>
```

## Untrusted payloads

If your API response is first-party, defaults are fine. If the
payload might cross an untrusted gateway or a federated API, three
things to know:

**1. Entry-count / path-depth caps.** `setFieldErrorsFromApi` takes
an optional second argument:

```ts
form.setFieldErrorsFromApi(response, { maxEntries: 50, maxPathDepth: 8 })
```

Defaults are `maxEntries: 1000`, `maxPathDepth: 32`. Over-budget
payloads are rejected; over-depth keys are dropped. Tighten the caps
for pass-through code.

**2. Message content shows in your UI.** Vue's text binding escapes
output, so XSS is not a concern — but an attacker-controlled
message can display misleading copy ("your account is suspended;
click here"). Validate the length and allowed characters before
binding.

**3. Unknown paths accept quietly.** An error pushed to
`users.0.adminPasswordHash` is harmless (no field renders it) but
can confuse error-surfacing logic. Pre-parse the payload with a Zod
schema to reject anything unexpected:

```ts
const ErrorPayload = z.object({
  error: z.object({
    details: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  }),
})

const parsed = ErrorPayload.safeParse(response)
if (parsed.success) form.setFieldErrorsFromApi(parsed.data, { maxEntries: 200 })
```
