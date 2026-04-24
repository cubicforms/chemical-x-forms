# Troubleshooting

Common issues — symptom first, fix second.

## "My field doesn't validate"

Three independent causes.

**The schema doesn't include the field.** An `.optional()` wrapper
without an inner refinement accepts anything. Double-check the
schema is what you think it is.

**You're in `validationMode: 'lax'` (the default) and watching
`validate()`.** Lax mode strips refinements during initial-state
derivation so the form mounts with empty values without failing.
Refinements re-apply on submit. If you want `validate()` to fire
refinements immediately, switch to `'strict'`.

**The path doesn't match the schema.** `'items.0.name'` and
`['items', 0, 'name']` canonicalise to the same path. But
`['items', '0', 'name']` (string `'0'`) does NOT — emit numbers
when the position is an array index.

## "Hydration mismatch after SSR"

**Did you call `hydrateChemicalXState(app, payload)` before
`app.mount(...)`?** It has to land before setup runs. See the
[SSR recipe](./recipes/ssr-hydration.md).

**Non-JSON-safe value in the form?** `Date`, `Map`, `Set`, `BigInt`,
and circular refs don't survive `JSON.stringify`. Either coerce at
the form boundary (`z.date().transform((d) => d.toISOString())`)
or use Nuxt's `devalue`-based payload (automatic under Nuxt).

**`escapeForInlineScript` missing on the bare-Vue side?** A form
value containing `</script>` breaks the inline payload. Wrap your
`JSON.stringify(payload)` in `escapeForInlineScript`. Not required
under Nuxt.

## "Form from another page leaked state in"

Two components mounted the same `key` at the same time. Use unique,
stable string literals — not generated values:

```ts
// Bad — collides when both instances live.
useForm({ schema, key: `form-${Math.random()}` })

// Good — stable per purpose.
const signupFormKey = 'signup' as const
useForm({ schema, key: signupFormKey })
```

Mount / unmount cycles are handled automatically — keys only
collide when two forms with the same key live concurrently.

In dev, a collision whose schemas disagree on shape surfaces as
a `console.warn`:

```
[@chemical-x/forms] Two useForm() calls with key "signup" use
structurally-different schemas. Only the first caller wires the
form; the second caller's schema is silently ignored (shared
"last-write" semantics). …
  existing schema fingerprint: …
  incoming schema fingerprint: …
```

If the sharing is intentional (both sites genuinely want the same
store), pass the same schema to both. If it's accidental, give
one of them a unique key. The warning is dev-only and never fires
in production builds.

## "Shared-key warning fires for schemas I think are identical"

The fingerprint is a best-effort structural hash. Two known
false-positive sources in custom adapters:

- The adapter's `fingerprint()` builds a string whose contents
  depend on a non-deterministic input (e.g. a factory default
  getter that allocates a new value on every call). Make the
  factory path collapse to an opaque sentinel.
- Two declarations look identical in source but one has a
  refinement the other doesn't. Refinements in the Zod adapters
  intentionally collapse to `fn:*` so most refinement-only
  deltas don't fire the warning, but shape deltas (wrapping
  with `.optional()`, `.default(…)`, `.catch(…)`) do.

## "`register('email')` returns a `never`-typed value"

The schema generic couldn't be inferred. Two likely causes:

- Your schema is typed as bare `ZodObject` without its concrete
  shape. Use the literal (`z.object({ email: z.string() })`) or
  give the variable a precise type.
- You imported `useForm` from `@chemical-x/forms` (the abstract
  entry) but passed a zod schema directly. Import from
  `@chemical-x/forms/zod` or `/zod-v3` instead.

See the [0.7 → 0.8 migration](./migration/0.7-to-0.8.md) for the
subpath split and required-`key` contract.

## "`handleSubmit` doesn't run when I submit the form"

As of 0.7, `handleSubmit(onSubmit)` returns the **handler function**,
not a Promise. Bind the returned value:

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

See [0.6 → 0.7 migration](./migration/0.6-to-0.7.md).

## "Persisted state is gone after a schema change"

Bump `persist.version` when you rename a field or change a type —
old payloads with a mismatched version are dropped on read. See
[persistence recipe](./recipes/persistence.md).

## "Undo brought back stale field errors"

By design. An undo snapshot captures the form value AND the errors
that were live at the time. If you want an undo to land on a
clean error state, call `form.clearFieldErrors()` right after
`undo()`.

## "My custom adapter's errors have the wrong path"

`validateAtPath` returns `ValidationError[]` with `path: (string |
number)[]`. Whatever your adapter emits is what downstream code
uses. Mismatches between your adapter's path format and the rest
of the app's usually stem from:

- Mixing string / number types for array indices. Emit `['items',
0, 'name']` (number `0`), not `['items', '0', 'name']` (string).
- Paths relative to a sub-schema leaking through when the caller
  asked for an absolute path — re-stamp error paths with the
  field prefix before returning.

## Still stuck?

Reproduce in `test/` — vitest is configured, jsdom is set up for
directive work, and the Nuxt fixture is one command away (`pnpm
test -- test/ssr.test.ts`). If your repro passes, the bug is
likely in your app wiring; if it fails, it's probably worth a PR.
