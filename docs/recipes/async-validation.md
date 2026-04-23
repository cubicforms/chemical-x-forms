# Async validation

Chemical X treats validation as schema-driven: whatever rules your
schema library can express, `handleSubmit` / `validate()` apply.
Phase 5.6 lands **first-class async validation** — the
`AbstractSchema.validateAtPath` contract is Promise-returning, so both
adapters (zod v3 and v4) accept `.refine(async ...)` /
`.superRefine(async ...)` and all the downstream APIs wait for those
to settle.

## Async refinements

Write refinements exactly as you would synchronously; drop `async`
in:

```ts
import { z } from 'zod'
import { useForm } from '@chemical-x/forms/zod'

const signupSchema = z.object({
  email: z
    .string()
    .email()
    .refine(async (value) => {
      const res = await fetch(`/api/email-available?e=${encodeURIComponent(value)}`)
      const { available } = (await res.json()) as { available: boolean }
      return available
    }, 'Email already registered'),
  password: z.string().min(8),
})

const { handleSubmit, fieldErrors } = useForm({ schema: signupSchema, key: 'signup' })
```

`handleSubmit` awaits the async parse internally — the submit handler
dispatches to `onSubmit` / `onError` only after every refinement has
settled.

## Reactive `validate()` — pending state

The reactive `validate()` ref carries a `pending` flag so templates
can show "checking…" UI while the async parse is in flight:

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

When the form mutates, `pending` flips back to `true` and a fresh
validation kicks off; stale in-flight runs are dropped via a
generation counter so an older "taken@" response can't clobber a
newer "alice@" result.

## Imperative `validateAsync(path?)` — one-shot

For flows where you need to `await` a single validation run (server
round-trips, multi-step forms, non-submit buttons), call the
imperative helper:

```ts
const { validateAsync, fieldErrors } = useForm({ schema, key: 'signup' })

async function onContinueClick() {
  const result = await validateAsync()
  if (!result.success) {
    // fieldErrors is already populated — or inspect result.errors directly.
    return
  }
  goToNextStep()
}
```

`validateAsync(path)` validates the subtree at `path`, mirroring the
reactive `validate(path)` surface.

## `isValidating`

`isValidating` is a reactive boolean that's `true` while any
validation call — `validate()` re-run, `validateAsync(...)`, or the
pre-submit validation inside `handleSubmit` — is in flight. Use it to
disable buttons or show inline spinners without plumbing your own
tracking state:

```vue
<button :disabled="isValidating || isSubmitting">Continue</button>
```

## Cross-field validation with zod `.refine()`

Use zod's sync `.refine` (v3 and v4 both support it) to express
"field B depends on field A":

```ts
import { z } from 'zod'

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

Sync refinements work alongside async ones — the adapter's
`safeParseAsync` call handles both uniformly.

## Chained validators

Compose multiple refines by chaining:

```ts
const schema = z
  .object({
    age: z.number(),
    hasConsented: z.boolean(),
  })
  .refine((data) => data.age >= 13, {
    message: 'You must be at least 13',
    path: ['age'],
  })
  .refine((data) => !(data.age < 18 && !data.hasConsented), {
    message: 'Parental consent required for users under 18',
    path: ['hasConsented'],
  })
```

Zod runs refines in declaration order; a failure in an earlier refine
does NOT short-circuit later ones by default. Use `z.superRefine` with
an early `ctx.addIssue + ctx.abort` if you want short-circuit
semantics.

## Field-specific validation messages

For leaf rules (`.min`, `.max`, `.regex`, `.email`), zod's message
overrides land directly on the field's error path:

```ts
const schema = z.object({
  email: z.email({ message: "That doesn't look like an email." }),
  password: z
    .string()
    .min(8, { message: 'Use at least 8 characters' })
    .regex(/\d/, { message: 'Include at least one digit' }),
})
```

`fieldErrors.password` may end up with two messages when the user's
input fails both rules — `fieldErrors.password[0]` is the first in
schema order. Either display the first, or map the whole array if you
want to show them all.

## Discriminated unions

Discriminated unions let you express "this field depends on what kind
of thing this form is right now":

```ts
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('card'), number: z.string().min(16) }),
  z.object({ type: z.literal('bank'), routing: z.string().length(9) }),
])
```

Both adapters handle discriminated unions — the zod v4 adapter picks
the active branch from the discriminator key in the current form value
and validates against only that branch's schema. Switch the `type`
field and the next `validate()` call uses the new branch.

## Combining async validation with server errors

Async validation at the **schema** level covers things the schema
knows about (uniqueness checks, allow-lists). Server errors —
responses from a real POST — still flow through
`setFieldErrorsFromApi`:

```ts
const onSubmit = handleSubmit(async (values) => {
  try {
    await $fetch('/api/signup', { method: 'POST', body: values })
  } catch (err) {
    if (err.statusCode === 422) {
      // Map the server's error payload into fieldErrors and surface
      // the first bad field.
      setFieldErrorsFromApi(err.data)
      focusFirstError({ preventScroll: true })
    }
  }
})
```

`isSubmitting` stays `true` across the full handler (schema
validation + server round-trip), so UI gated on it works without
extra wiring.

## What `getInitialState` does NOT do

The contract change only covers `validateAtPath`. `getInitialState`
stays synchronous — it walks the schema shape to produce blank
defaults, which doesn't benefit from async. An async
`getInitialState` would also make SSR more expensive: the server
currently resolves initial form state synchronously inside Vue's
setup.

If you need to seed the form from an async source (API call), do it
in a `watch` outside of `useForm`:

```ts
const form = useForm({ schema, key: 'profile' })

onMounted(async () => {
  const profile = await $fetch('/api/profile')
  form.reset(profile)
})
```

`reset(next)` applies the `next` constraints over the schema's own
defaults — same precedence rules as the `useForm({ initialState })`
option, just deferred until the async source is ready.
