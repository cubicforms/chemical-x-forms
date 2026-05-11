---
title: 'Server errors'
description: "Map server-returned validation errors back into Attaform's reactive error store via parseApiErrors — JSON envelopes, dotted paths, bare strings."
---

# Server errors (HTTP 4xx validation failures)

Server-side rules the client doesn't know — "email already taken",
"coupon expired", "we couldn't reach the payment provider" — surface
as `errors`. Two patterns, picked by what kind of error you're
routing:

- **Field-keyed errors** (server says "email already taken"): parse
  the payload with `parseApiErrors`, write the result with
  `setFieldErrors` (or `addFieldErrors`). Covered first.
- **Form-level errors** (server says "capacity exceeded" with no
  field to attach to): write the message to the form-level bucket
  with `setFormErrors`. Covered in
  [Non-field errors](#non-field-errors).

## The usual case

```vue
<script setup lang="ts">
  import { useForm, parseApiErrors } from 'attaform'
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
      throw err // Other errors flow through to `meta.submitError`.
    }
  })
</script>

<template>
  <form @submit.prevent="onSubmit">
    <input v-register="form.register('email')" />
    <small v-if="form.errors.email?.[0]">
      {{ form.errors.email[0].message }}
    </small>

    <input v-register="form.register('password')" type="password" />
    <small v-if="form.errors.password?.[0]">
      {{ form.errors.password[0].message }}
    </small>

    <button :disabled="form.meta.submitting">Sign up</button>
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

The two flavours surface together in `errors[path]` (schema
entries first, user entries second), so templates render both
without branching.

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
  expected object", "entries must be `{ message, code }` objects",
  etc.). Log it; don't apply.

```ts
const result = parseApiErrors(err.data, { formKey: form.key })
if (result.ok) {
  form.setFieldErrors(result.errors)
} else {
  console.error('Unexpected error payload:', result.rejected, err.data)
}
```

## Payload shapes

Every entry is `{ message, code }` (both required). The `code` is
forwarded verbatim onto the produced `ValidationError` so error
renderers branch on `code` instead of message strings.

A wrapped envelope:

```ts
{
  error: {
    details: {
      email: { message: 'already taken', code: 'api:duplicate-email' },
      password: [
        { message: 'too short', code: 'api:min-length' },
        { message: 'must contain a digit', code: 'api:digit-required' },
      ],
    },
  },
}
```

A bare details record works the same way:

```ts
{
  email: { message: 'already taken', code: 'api:duplicate-email' },
  password: [
    { message: 'too short', code: 'api:min-length' },
    { message: 'must contain a digit', code: 'api:digit-required' },
  ],
}
```

Keys are dotted paths (`'user.email'`, `'items.0.qty'`). A field's
value is either a single entry or an array — array entries each
produce their own `ValidationError`, so a single field can carry
multiple distinct failures with their own codes.

Pick a prefix for your codes (`api:`, `auth:`, `myapp:`) and stay
consistent so consumer error-rendering UIs can switch on `code`.

Legacy string entries (`{ email: 'taken' }`), entries missing
`code`, and entries with non-string `code` are rejected as
`{ ok: false, rejected }`.

## Branching on `code`

```ts
import { AttaformErrorCode } from 'attaform'

for (const err of form.errors.email ?? []) {
  if (err.code === 'api:duplicate-email') {
    // server-side uniqueness failure
  } else if (err.code === AttaformErrorCode.NoValueSupplied) {
    // user opened the form and didn't fill the field
  } else if (err.code.startsWith('zod:')) {
    // schema-level validation failure
  }
}
```

`AttaformErrorCode` exports the library-internal codes; the `zod:` prefix
is computed inline from `issue.code`; consumer codes (`api:`,
`auth:`, etc.) come from the wire payload or direct
`setFieldErrors` calls.

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
  // Wire entries are { message, code } — the field's value can be
  // a single entry or an array. Normalise so .map() handles both.
  const raw = err.data.coupon
  const entries: { message: string; code: string }[] = Array.isArray(raw) ? raw : raw ? [raw] : []
  form.addFieldErrors(
    entries.map((entry) => ({
      path: ['coupon'],
      message: entry.message,
      code: entry.code,
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

Some server failures aren't tied to a field — rate limits, provider
outages, a thrown exception inside your submit handler. Two surfaces
to pick from, depending on how you want them to behave.

### `setFormErrors` — displayable, reactive

For messages you intend to render in the UI, write to the form-level
error bucket. It's a first-class part of `form.errors`: reactive
across the proxy, the call form, the flat aggregate, and template
serialisation.

```ts
const onSubmit = form.handleSubmit(async (values) => {
  try {
    await $fetch('/api/signup', { method: 'POST', body: values })
  } catch (err) {
    if (err instanceof Error) {
      form.setFormErrors([{ message: err.message, code: 'api:signup' }])
    }
  }
})
```

```vue
<template>
  <div v-if="form.errors('')" role="alert" class="form-banner">
    <p v-for="e in form.errors('')" :key="e.message">{{ e.message }}</p>
  </div>

  <input v-register="form.register('email')" />
  <button :disabled="form.meta.submitting">Sign up</button>
</template>
```

The bucket is separate from field errors — a later `setFieldErrors`
call won't wipe it, and `clearFieldErrors()` leaves it alone. Clear
it explicitly with `form.clearFormErrors()` (or `form.setFormErrors([])`),
or wait for `form.reset()` which clears the entire error store.

`setFormErrors` REPLACES every form-level entry on each call, mirroring
the `setFieldErrors` semantic. For "append one to whatever's already
there," read the current bucket and write the concatenation:

```ts
const existing = form.errors('') ?? []
form.setFormErrors([...existing, { message: 'extra', code: 'api:extra' }])
```

See [error display > form-level errors](/docs/recipes/error-display#form-level-errors)
for the full read surface.

### `meta.submitError` — raw throw, snapshot

If the failure should bubble to imperative callers (so an
`await submitHandler(event)` actually rejects) AND you want a
lifecycle-tracked snapshot of the last submit's outcome, throw and
let it land on `form.meta.submitError`:

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
  <p v-if="form.meta.submitError" role="alert">
    {{ (form.meta.submitError as Error).message }}
  </p>
</template>
```

`submitError` holds whatever value the most recent failed submission
threw (typically an `Error`). It's a per-submit snapshot: a
subsequent successful submission clears it; a subsequent failing one
overwrites it. `setFormErrors` is the better pick when you want
multiple coexisting messages, codes you can branch on, or
declarative clearing alongside other error state.

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
const Entry = z.object({ message: z.string(), code: z.string() })
const ErrorPayload = z.object({
  error: z.object({
    details: z.record(z.string(), z.union([Entry, z.array(Entry)])),
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
