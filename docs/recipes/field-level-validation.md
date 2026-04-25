# Live field validation

By default, validation runs on submit. Opt into per-field validation
when you want inline feedback — "passwords don't match", "email
looks invalid", "this username is taken" — before the user clicks
submit.

## Turn it on

```ts
useForm({
  schema,
  key: 'signup',
  fieldValidation: { on: 'change', debounceMs: 200 },
})
```

Three modes:

| `on`       | When it fires                                    | Debounced?          |
| ---------- | ------------------------------------------------ | ------------------- |
| `'none'`   | Never (default). Submit is the only validator.   | —                   |
| `'change'` | Every mutation: register input, `setValue`, etc. | Yes — `debounceMs`. |
| `'blur'`   | Tab away from a field.                           | No — immediate.     |

## Which mode?

- **`'change'`** — best when your schema includes async checks
  (email uniqueness, username lookup). Users get immediate
  feedback; the server isn't hit on every keystroke.
- **`'blur'`** — best for simple field rules (required, min length,
  format). No wait, but only after the user leaves the field.
- **`'none'`** — default. Small forms + fast-to-submit flows.

## What you get

Each run targets one path at a time. On success, errors at that
path are cleared; on failure, they're overwritten. Sibling fields
are untouched — a user typing into `email` won't clear the existing
`password` error.

```vue
<template>
  <input v-register="register('email')" />
  <small v-if="fieldErrors.email?.[0]">
    {{ fieldErrors.email[0].message }}
  </small>
</template>
```

The same `fieldErrors` store handles submit validation and live
field validation — no new reactive surface to wire up.

## Rapid typing

Type fast, validate once. Successive writes reset the debounce
timer and cancel any in-flight validation for that path:

```ts
form.setValue('email', 'a') // schedules
form.setValue('email', 'ab') // cancels prior, reschedules
form.setValue('email', 'abc') // cancels prior, reschedules
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

## `isValidating` for UI

`isValidating` is `true` while any validation is in flight — submit,
reactive `validate()`, one-shot `validateAsync`, or a field-level
run. Gate UI:

```vue
<button :disabled="isValidating">Submit</button>
```

## Tuning `debounceMs`

The default `200ms` feels snappy without battering your server. For
expensive async checks (DB hit, third-party API), bump it:

```ts
fieldValidation: { on: 'change', debounceMs: 500 }
```

For cheap sync-only rules, drop it to `0` — validation fires on the
next microtask after each mutation.

## Nested paths

`setValue('user.profile.email', …)` validates exactly that path,
not the containing objects. Your `fieldErrors['user.profile.email']`
lookup gets the error.

## Caveat: blur doesn't re-validate on typing

With `on: 'blur'`, if the user sees an error and edits the field
without leaving it, the stale error stays until the next blur.
Switch to `'change'` when live feedback matters more than
keystroke quiet.
