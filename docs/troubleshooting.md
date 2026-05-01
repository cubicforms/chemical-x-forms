# Troubleshooting

Common issues — symptom first, fix second.

## "My field doesn't validate"

Three independent causes.

**The schema doesn't include the field.** An `.optional()` wrapper
without an inner refinement accepts anything. Double-check the
schema is what you think it is.

**You're in `validationMode: 'lax'` and watching `validate()`.** Lax
mode strips refinements during default-values derivation so the form
mounts with empty values without failing. Refinements re-apply on
submit. If you want `validate()` to fire refinements immediately, drop
the `validationMode: 'lax'` opt-out — strict is the default.

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

## "v-register on my component does nothing (typing doesn't update the form)"

`<MyComponent v-register="...">` works only when the component's
rendered root element is one Vue's directive can bind: `<input>`,
`<textarea>`, or `<select>`. For components whose root is a `<div>`
/ `<label>` / styled wrapper, the directive can't read `el.value`
off the wrapper and skips listener attachment to avoid the bubbled-
write bug — typing into a descendant input goes nowhere.

The fix: call `useRegister()` in the child's setup and re-bind
v-register onto an inner native element:

```vue
<!-- StyledInput.vue -->
<script setup lang="ts">
  import { useRegister } from '@chemical-x/forms'
  const register = useRegister()
</script>

<template>
  <div class="wrapper">
    <input v-register="register" />
  </div>
</template>
```

The dev-mode console warning `v-register on <div> is a no-op …`
points here. See the [components recipe](./recipes/persistence.md#component-support)
for the four supported patterns (native root, useRegister,
injectForm for compound components, and the `assignKey`
escape hatch).

## "Submit fails with 'No value supplied' on a field the user can leave blank"

The path is in the form's `blankPaths` set and bound to a required
schema. Three resolutions, depending on intent:

- **The field is genuinely optional.** Wrap the schema:
  `z.string().optional()`, `z.number().nullable()`, or
  `z.string().default('')`. Optional / nullable / has-default
  schemas accept the empty case and don't raise.
- **The field is required but the consumer wants `''` to count as
  "filled".** Supply an explicit default at construction:
  `defaultValues: { email: '' }`. The library reads this as "empty
  string is intentional" and skips the auto-mark for that leaf.
- **The library should treat a blank field as "user didn't fill
  it."** Working as intended — the synthesized error
  (`code: 'cx:no-value-supplied'`) prevents silently submitting
  `0` / `''` / `false` for an unfilled required field.

See [app-defaults recipe](./recipes/app-defaults.md) for the
auto-mark rules and the `unset` sentinel.

## "Persisted state is gone after a schema change"

Working as intended. As of 0.12, storage keys carry the schema's
fingerprint (`${base}:${fingerprint}`). When the schema changes
shape, the fingerprint changes, the old key becomes unreachable,
and the orphan-cleanup pass on the next mount removes it. No
manual `version` bump needed — it's automatic.

If the schema didn't change shape but state was wiped anyway, the
fingerprint is over-sensitive. Common causes in custom adapters:

- The adapter's `fingerprint()` mixes function-valued metadata
  (refinement bodies, transform fns) into the hash without
  collapsing to a sentinel. Two refines of the same shape produce
  different hashes; consumers see drafts vanish on every refine
  edit. Collapse functions to `'fn:*'`.
- The fingerprint includes a timestamp or per-call random ID. It
  must be a pure function of the schema's structure.

If you genuinely need to invalidate drafts without changing the
schema (e.g. shipping a security fix that requires fresh state),
call `form.clearPersistedDraft()` on mount or evict the registry
entry programmatically.

## "I see `prev?.first ?? ''` getting flagged as redundant"

Working as intended. As of 0.12, the path-form `setValue` callback
receives a fully-defaulted `prev` — the runtime calls
`getDefaultAtPath` on missing slots before invoking the callback,
so consumer code can read `prev.first.toUpperCase()` directly. Drop
the optional chain.

Whole-form callback `prev` is `WriteShape<Form>`. Array reads
(`prev.posts[5]`) carry `| undefined` from your tsconfig's
`noUncheckedIndexedAccess: true` — narrow with `?.` or a guard.
Iteration (`for (const p of prev.posts)`, `prev.posts.map(...)`)
keeps the strict element type; that's the flag's intended scope.

## "`form.values.posts[0].title.toUpperCase()` started type-erroring"

Working as intended. Once a read path crosses an array index, the
result carries `| undefined` — the runtime can return undefined for
out-of-bounds reads, so the type tracks that. Narrow with optional
chaining:

```ts
form.values.posts[0]?.title?.toUpperCase() ?? ''
```

Or read from `form.fields.posts[0].title.value` if you also want
the per-field flags (`dirty`, `errors`, `touched`) alongside the
value. The same `| undefined` taint applies; narrow the same way.

Tuple positions stay strict — out-of-bounds is a type-system error
on tuples, not a runtime case.

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

## "My custom adapter is missing `code` on its ValidationErrors"

Every `ValidationError` carries a required `code: string`. Pick a
stable scope prefix for your adapter (e.g. `'mylib:'`) and forward
the underlying issue's code under it:

```ts
return {
  errors: result.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    formKey: '',
    code: `mylib:${issue.code ?? 'unknown'}`,
  })),
  // ...
}
```

See the [custom-adapter recipe](./recipes/custom-adapter.md) for
the full contract including `isRequiredAtPath` (used by the blank
validation augmentation) and `getSlimPrimitiveTypesAtPath` (used
by the slim-primitive write gate).

## "Dev warnings don't fire — am I in production?"

The library uses a `__DEV__` flag that resolves from
`process.env.NODE_ENV !== 'production'` at module load. Standard
bundlers (Vite, Webpack, Rollup with `@rollup/plugin-replace`)
inline `process.env.NODE_ENV` at build time so the flag becomes
a constant the compiler can dead-code-eliminate.

**If you're importing the library directly from a browser-native
ESM CDN (esm.sh, Skypack, unpkg) without a bundler,** `process`
is undefined and `__DEV__` is permanently `false` — every dev-mode
warning is silenced even though you're clearly in development.
The library works correctly; only the diagnostic surface degrades.

The fix is to put a bundler in your pipeline (or use a CDN that
serves a bundled distribution). For production apps, this is
already the case; for prototype-style CDN imports, it's a
deliberate trade-off: no `process.env.NODE_ENV` replacement, no
dev warnings.

## Still stuck?

Reproduce in `test/` — vitest is configured, jsdom is set up for
directive work, and the Nuxt fixture is one command away (`pnpm
test -- test/ssr.test.ts`). If your repro passes, the bug is
likely in your app wiring; if it fails, it's probably worth a PR.
