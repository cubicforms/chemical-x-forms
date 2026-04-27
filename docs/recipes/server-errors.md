# Server errors (HTTP 4xx validation failures)

Client-side schema validation rejects bad shape before the request
leaves the browser. The server has rules the client doesn't —
"email already taken", "coupon expired", "we couldn't reach the
payment provider" — and those come back as `fieldErrors` via the
two-step pattern: parse the payload with `parseApiErrors`, write
the result with `setFieldErrors` (or `addFieldErrors`).

The form API has only one error setter on it (`setFieldErrors` /
`addFieldErrors` / `clearFieldErrors`); shape adapters live as pure
helpers exported alongside `useForm`. One canonical write surface,
explicit transformation step.

## The usual case

```vue
<script setup lang="ts">
  import { useForm, parseApiErrors } from '@chemical-x/forms'
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
        const result = parseApiErrors(err.data, { formKey: form.key })
        if (result.ok) form.setFieldErrors(result.errors)
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
already passed — this is genuinely for server-only failures.

**API-injected errors persist** across schema revalidation and
successful submits. `setFieldErrors` and `addFieldErrors` write to
a separate user-error store (internally distinct from the
schema-validation pipeline's store); nothing automatically clears
them. The user's next keystroke will re-run schema validation
against the field — that updates the schema-error half, but your
API entries stay until you call `clearFieldErrors(path)` (or
unmount the form).

The two flavours surface together in `fieldErrors[path]` (schema
entries first, user entries second), so templates render both
without branching.

## Why two steps instead of one

Earlier versions shipped a `form.setFieldErrorsFromApi(payload)`
shortcut. We removed it in 0.12: an error is an error, regardless
of where it came from, and the form's setter surface should reflect
that. Shape adapters belong as pure exported helpers — they're
unit-testable in isolation, don't need a form mounted, and scale
cleanly when other shapes (GraphQL, JSON:API, etc.) come along.

The result is one canonical setter (`setFieldErrors`) plus
composable parsers. The two-step pattern reads as what's actually
happening: parse → write.

## The result type

`parseApiErrors` returns a discriminated result so you can detect
malformed payloads without try/catch:

```ts
type ParseApiErrorsResult = {
  readonly ok: boolean
  readonly errors: ValidationError[]
  readonly rejected?: string
}
```

- `{ ok: true, errors }` — payload recognised. `errors` may be
  empty (server returned a 422 with no field-level details).
- `{ ok: false, errors: [], rejected }` — payload shape wasn't
  recognised. `rejected` carries a reason ("payload was string,
  expected object", "details was not a record of string |
  string[]", etc.). Log it; don't apply.

```ts
const result = parseApiErrors(err.data, { formKey: form.key })
if (result.ok) {
  form.setFieldErrors(result.errors)
} else {
  console.error('Unexpected error payload:', result.rejected, err.data)
}
```

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

Anything else — numbers, booleans, nested objects — returns
`{ ok: false, rejected }`. Inspect the result to branch on that
case.

## Pairing with focus-on-error

A 422 with no visible focus is invisible to screen-reader users and
easy to miss for sighted users scrolled past the error. Hydrate

- focus in the same block:

```ts
const onSubmit = form.handleSubmit(async (values) => {
  try {
    await $fetch('/api/signup', { method: 'POST', body: values })
  } catch (err: any) {
    if (err.statusCode === 422) {
      const result = parseApiErrors(err.data, { formKey: form.key })
      if (result.ok) {
        form.setFieldErrors(result.errors)
        form.focusFirstError({ preventScroll: true })
        form.scrollToFirstError({ block: 'center', behavior: 'smooth' })
      }
    }
  }
})
```

## Mixing server + client errors

To replace one field's error without wiping the rest, skip the
parser and construct the entries directly:

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

`parseApiErrors` + `setFieldErrors` is the right default for
"replace everything from this payload". `addFieldErrors` +
`clearFieldErrors` are for finer control. Both write to the same
user-error store; merging is structural.

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

**1. Entry-count / path-depth caps.** `parseApiErrors` accepts
optional caps in its options bag:

```ts
const result = parseApiErrors(response, {
  formKey: form.key,
  maxEntries: 50,
  maxPathDepth: 8,
})
```

Defaults are `maxEntries: 1000`, `maxPathDepth: 32`. Over-budget
payloads are rejected wholesale (the result is `{ ok: false,
rejected }`); over-depth individual keys are dropped while the rest
of the payload still applies. Tighten the caps for pass-through
code.

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
if (parsed.success) {
  const result = parseApiErrors(parsed.data, {
    formKey: form.key,
    maxEntries: 200,
  })
  if (result.ok) form.setFieldErrors(result.errors)
}
```
