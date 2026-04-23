# Troubleshooting

Patterns the community (and the maintainer's inbox) have surfaced
more than once. Each entry lists the symptom, the cause, and the fix.

## "My field doesn't validate"

Three independent causes share this symptom.

**Schema doesn't actually include the field.** The schema is the
source of truth; `useForm` only enforces what the schema declares.
Check that the field is a leaf on the schema object — an `.optional()`
wrapper without an inner refinement will accept anything.

**`validationMode: 'lax'` is in play.** Default for all consumers.
Refinements (`.min`, `.email`, `.refine`, …) are stripped during
initial-state derivation so the form mounts with empty values without
failing. They re-apply on submit, but if you're watching `validate()`
computed refs for a field that's still empty, lax mode won't flag it.
Switch to `'strict'` if you want refinements to fire immediately.

**The path you're watching doesn't match the path in the schema.**
Dotted paths go through `canonicalizePath`, which converts
integer-like strings to numbers: `'items.0.name'` and
`['items', 0, 'name']` are the same path. If you pass the array form
with a string `'0'` in it, it's treated as a string key and won't
match an array index.

## "Hydration mismatch after SSR"

The server and client produced different HTML for the same form.
Three common causes:

**Forgot to call `hydrateChemicalXState(app, payload)` on the client
before `app.mount(...)`.** Rehydration has to land before component
setup runs, because `useForm` reads the payload during setup. See
`docs/recipes/ssr-hydration.md`.

**Non-JSON-safe value in the form.** `renderChemicalXState` is
JSON-safe-in → JSON-safe-out. `Date`, `Map`, `Set`, `BigInt`, and
circular refs don't survive `JSON.stringify`. Either coerce to
strings at the form boundary (`z.date().transform((d) =>
d.toISOString())`) or use a structured-clone serialiser like Nuxt's
`devalue` — under Nuxt, this is automatic via `nuxtApp.payload`.

**`escapeForInlineScript` missing on the bare-Vue side.** A form
value containing `</script>` will visibly break the inline payload
script. Import `escapeForInlineScript` from `@chemical-x/forms` and
wrap your `JSON.stringify(payload)`. Not required under Nuxt.

## "Form from another page leaked state in"

Two components used the same `key`. `useForm(..., { key: 'signup' })`
called from two pages that stay mounted at the same time will
rendezvous on the same `FormState`. The fix is unique keys — a
module-level constant per form, not a generated value:

```ts
// bad — collides across instances
useForm({ schema, key: `form-${Math.random()}` })

// good — stable, unique per purpose
const signupFormKey = 'signup' as const
useForm({ schema, key: signupFormKey })
```

The memory-leak eviction (Phase 8.1) handles the usual
mount/unmount cycle — keys collide only when two forms with the same
key live at the same time.

## "`register('email')` returns a `never`-typed value"

The schema generic can't be inferred. This usually means:

- You passed the schema through a variable typed as `ZodObject`
  without its concrete shape. Give it a precise type, or let TS
  infer from the literal: `z.object({ email: z.string() })`.
- You imported `useForm` from `@chemical-x/forms` (the abstract
  entry) but passed a zod schema directly. The zod wrappers live at
  `@chemical-x/forms/zod` and `@chemical-x/forms/zod-v3` — import
  from the matching subpath.

See `docs/migration/0.7-to-0.8.md` for the details on the required
`key` contract and the subpath split.

## "`handleSubmit` doesn't run when I submit the form"

As of 0.7, `handleSubmit(onSubmit)` returns a *handler function*,
not a promise. Bind the returned value to `@submit.prevent`:

```vue
<script setup lang="ts">
const submit = handleSubmit(async (values) => {
  await api.signup(values)
})
</script>

<template>
  <form @submit.prevent="submit">...</form>
</template>
```

See `docs/migration/0.6-to-0.7.md` for the full signature change.

## "My custom adapter's errors have the wrong path"

`validateAtPath` returns `ValidationError[]` with `path: (string |
number)[]`. The path the adapter emits is the path downstream code
uses — if the adapter emits `['user', 'email']` and the rest of the
app asks for `'user.email'`, the segments have to match after
`canonicalizePath` normalisation. Integer-looking strings normalise
to numbers, so `'items.0.name'` and `['items', 0, 'name']` end up in
the same `PathKey`. Mixed forms (`['items', '0', 'name']` — string
`'0'` vs number `0`) do NOT canonicalise to the same key; emit
numbers when the position is an array index.

## Still stuck?

Reproduce in `test/` — vitest is configured, jsdom is set up for
directive work, and the Nuxt fixture is one command away (`pnpm test
-- test/ssr.test.ts`). If the repro passes, the bug is likely in
your app wiring; if it fails, it's probably worth a PR.
