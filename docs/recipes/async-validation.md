# Advanced validation patterns

Chemical X treats validation as schema-driven: whatever rules your
schema library can express, `handleSubmit` / `validate()` will apply.
This recipe covers three patterns that come up often.

> **Async validators are not yet supported.** `validateAtPath` is
> synchronous — zod's `.refine(async ...)` and `.transform(async ...)`
> throw at runtime. Async validation is on the post-beta roadmap
> (Plan 4). For now, run async checks inside your `handleSubmit`
> callback and feed the result into `setFieldErrorsFromApi` — see the
> server-errors recipe.

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

const form = useForm({ schema, key: 'signup' })
```

The error lands on `fieldErrors.passwordConfirmation` — the `path` in
`.refine`'s options tells zod where to attribute the issue.

## Chained validators

Compose multiple sync refines by chaining:

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
does NOT short-circuit later ones by default. If you need short-circuit
semantics, use `z.superRefine` with an early `ctx.addIssue + ctx.abort`.

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

## Doing async work from `handleSubmit`

Until async validators land, the pattern is:

```ts
const onSubmit = form.handleSubmit(async (values) => {
  // 1. Your schema has already validated the shape. If you need an
  //    async check (uniqueness, remote allow-list), do it now.
  const emailTaken = await checkEmailAvailability(values.email)
  if (emailTaken) {
    form.setFieldErrors([
      { path: ['email'], message: 'That email is already taken', formKey: form.key },
    ])
    return
  }

  // 2. Proceed with the real request.
  await $fetch('/api/signup', { method: 'POST', body: values })
})
```

`isSubmitting` is true for the full duration including your async
check, so UI gated on `isSubmitting` works correctly without
extra wiring.

## Why not async refines today?

Supporting async refines requires:

- `validateAtPath` returning a `Promise<ValidationResponse>` instead
  of a synchronous one. Every caller (the `validate()` reactive ref,
  `handleSubmit`, `runValidation`) has to `await` the result.
- Care about overlapping invocations — a user typing quickly into an
  async-validated field would fire multiple concurrent checks that
  could resolve out of order.
- A cancellation story for stale in-flight validations.

This is a genuinely breaking change to the core (every current caller
assumes sync validation). Plan 4 will tackle it with proper regression
coverage. The `setFieldErrors` / `setFieldErrorsFromApi` bridge from
`handleSubmit` is the supported interim answer.
