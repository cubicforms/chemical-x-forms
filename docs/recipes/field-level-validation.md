# Live field validation

Attaform validates as you type by default — `validateOn: 'change'` with
`debounceMs: 0` is implicit. Errors at any path reflect the live
`(value, schema)` continuously, so consumers can render inline
feedback without reaching for a separate "is this field valid?"
query.

The data layer (errors as a function of value) and the rendering
layer (when to **show** errors) are separate concerns: the merged
`errors` store is always current; gating display on
`form.fields.<path>.touched` / `form.meta.submitCount` / etc. is your
call.

## Default in action

No configuration needed:

```ts
useForm({ schema, key: 'signup' })
```

Type into an `<input v-register="register('email')" />`, see
`form.errors.email` populate (or clear) synchronously after each
keystroke (default `debounceMs: 0` skips `setTimeout` entirely; the
schema work itself rides `Promise.resolve().then(...)`, so errors
land on the next microtask).

## Tune or opt out

```ts
useForm({
  schema,
  key: 'signup',
  validateOn: 'change',
  debounceMs: 500, // coalesce rapid bursts; useful for slow async refines
})
```

Three modes:

| `validateOn` | When it fires                                                      | Debounced?                                            |
| ------------ | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `'change'`   | (default) Every committed write: directive input, `setValue`, etc. | Yes — `debounceMs` (default `0` = sync).              |
| `'blur'`     | Tab away from a registered field.                                  | No — immediate. `debounceMs` is rejected by the type. |
| `'submit'`   | Explicit opt-out — submit is the only validator.                   | — `debounceMs` is rejected by the type.               |

The TS-level `ValidateOnConfig` discriminated union enforces that
`debounceMs` is only valid with `validateOn: 'change'`. Pairing it
with `'blur'` / `'submit'` is a compile-time error rather than a
silent runtime drop.

## Which mode?

- **`'change'`** — the default. Inline feedback as the user types;
  expensive async refines (email uniqueness, server-side lookups)
  ride on the same `debounceMs` window so the network isn't hit on
  every keystroke.
- **`'blur'`** — quieter. Feedback only after the user leaves the
  field. Best when the schema is simple and per-keystroke checks
  feel noisy.
- **`'submit'`** — the explicit opt-out. Submit is the only
  validator. Use for small forms + fast-to-submit flows where live
  feedback would distract.

## What you get

Each run targets one path at a time. On success, errors at that
path are cleared; on failure, they're overwritten. Sibling fields
are untouched — a user typing into `email` won't clear the existing
`password` error.

```vue
<template>
  <input v-register="register('email')" />
  <small v-if="errors.email?.[0]">
    {{ errors.email[0].message }}
  </small>
</template>
```

The same `errors` store handles submit validation and live
field validation — no new reactive surface to wire up.

## Rapid typing

Type fast, validate once. Successive writes reset the debounce
timer (or fire synchronously when `debounceMs: 0`) and cancel any
in-flight validation for that path:

```ts
form.setValue('email', 'a') // schedules / runs
form.setValue('email', 'ab') // cancels prior, reschedules / runs
form.setValue('email', 'abc') // cancels prior, reschedules / runs
// …debounceMs after the LAST write, validation runs once on 'abc'.
```

If a slow server reply arrives for "ab" after "abc" starts
validating, the stale result is dropped.

## Submit is still authoritative

When `handleSubmit` fires, any pending field-level runs are cancelled
and the submit's full-form validation wins. Your users can't get
"my submit said the form was valid, but a stale field-level error
sneaked in afterwards".

`reset()` does the same — field-level state is cancelled before the
fresh form lands.

## `meta.isValidating` for UI

`form.meta.isValidating` is `true` while any validation is in flight
— submit, reactive `validate()`, one-shot `validateAsync`, or a
field-level run. Gate UI:

```vue
<button :disabled="form.meta.isValidating">Submit</button>
```

## Tuning `debounceMs`

The default `0` feels snappy and matches the obvious mental model.
For expensive async checks (DB hit, third-party API), bump it:

```ts
useForm({ schema, validateOn: 'change', debounceMs: 500 })
```

`debounceMs: 0` is the off switch — when set, validation runs
synchronously after each committed write with no `setTimeout`
indirection (see `docs/migration/0.13-to-0.14.md` for the timing
shift).

## Storage commit timing vs. validation timing

`debounceMs` is purely a VALIDATION debounce. Form storage commits
happen at the directive's listener — per keystroke for
`<input v-register>`, per blur for `<input v-register.lazy>`. The
validation debounce counts ms since the last committed write,
regardless of which listener fired.

If you want validation to wait for the user to leave the field,
use `validateOn: 'blur'` instead of trying to pair `validateOn:
'change'` with `<input v-register.lazy>` — the latter still fires
on every `change` event and the validation debounce coalesces them
the same way.

## Nested paths

`setValue('user.profile.email', …)` validates exactly that path,
not the containing objects. Your `errors['user.profile.email']`
lookup gets the error.

## Caveat: blur doesn't re-validate on typing

With `validateOn: 'blur'`, if the user sees an error and edits the
field without leaving it, the stale error stays until the next
blur. Switch to `'change'` when live feedback matters more than
keystroke quiet.
