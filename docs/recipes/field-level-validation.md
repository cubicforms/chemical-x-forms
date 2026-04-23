# Field-level validation

By default, Chemical X only validates at submit time — `handleSubmit`
runs the schema, populates `fieldErrors`, and dispatches to
`onSubmit` / `onError`. Consumers who want inline feedback
("passwords don't match", "this email is taken") before the user
clicks submit can opt in to per-field validation.

## Enabling it

Pass a `fieldValidation` option at `useForm` construction:

```ts
const form = useForm({
  schema,
  key: 'signup',
  fieldValidation: { on: 'change', debounceMs: 200 },
})
```

Three trigger modes:

| `on`       | When validation fires                                                            | Debounce                   |
| ---------- | -------------------------------------------------------------------------------- | -------------------------- |
| `'none'`   | Never — `handleSubmit` is the only validation surface. Default.                  | N/A                        |
| `'change'` | Every mutation via `setValueAtPath` (register, `setValue`, array helpers).       | Yes — `debounceMs` (200ms default). |
| `'blur'`   | Immediate, on `markFocused(path, false)` — i.e. when the user tabs away.         | No.                        |

## How it interacts with the error store

Each field-level run targets one path — say `['email']`. On resolve:

- **Success**: clear any existing errors at that path.
- **Failure**: overwrite errors at that path with the adapter's
  response, re-stamped so the paths are absolute from the form root.

Sibling fields are untouched. So a user typing into `email` while
`password` still has a pending error keeps seeing the password error;
only the email path is re-evaluated.

## Cancellation semantics

Rapid successive writes only trigger one validation per path — the
prior one is aborted:

```ts
form.setValue('email', 'a')      // schedules at T+200ms
form.setValue('email', 'ab')     // aborts prior, schedules at T+200ms (new)
form.setValue('email', 'abc')    // aborts prior, schedules at T+200ms (new again)
// …200ms after the LAST write, validation runs once against 'abc'.
```

An in-flight `safeParseAsync` that resolves after its controller is
aborted is dropped silently — the settled result doesn't reach the
error store. This is the standard "stale result" guard:

```
setValue('email', 'a')           [schedule A]
A fires; safeParseAsync in flight [A running]
setValue('email', 'ab')          [abort A; schedule B]
A resolves — dropped (controller aborted)
B fires; safeParseAsync in flight [B running]
B resolves → writes errors for 'ab'.
```

## Interaction with `handleSubmit`

Submit is authoritative. When a submit handler fires:

1. Every in-flight field-level run for every path is aborted.
2. `handleSubmit` runs the full-form validation.
3. `setAllErrors` replaces the error map with the submit result.

If a field-level run's timer hadn't fired yet, it's cleared. If one
had fired and its `safeParseAsync` was in flight, the aborted write
is dropped. No way for a late field-level result to clobber the
submit result.

## Interaction with `reset()`

Same as submit: `reset()` aborts every in-flight field run and
clears pending timers. The error store is cleared, and no late write
can populate it.

## Interaction with `isValidating`

`isValidating` is true while ANY validation is in flight — whether
triggered by `handleSubmit`, `validate()`, `validateAsync(...)`, or a
field-level run. Use it to gate UI:

```vue
<button type="submit" :disabled="isValidating">Submit</button>
```

## Choosing a mode

- **`'change'`** (debounced): best for async uniqueness checks
  (email availability, username taken). Users get immediate feedback
  but the server isn't hit on every keystroke.
- **`'blur'`**: best for simple field rules (required, min length,
  format). No debounce → no wait — but only fires on tab-away, not
  mid-typing, so the user has a chance to finish before seeing the
  error.
- **`'none'`** (default): best when the form is small / fast to
  submit and submit-time validation is fine.

## Caveats

- **`'change'` mode writes on every keystroke trigger.** If your
  schema's per-field validation is expensive (DB call, network
  request), tune `debounceMs` up (500ms or higher) so users don't
  batter your server while typing.
- **`'blur'` mode doesn't re-validate on typing.** If the user
  corrects an error without blurring, the prior error stays until
  blur fires again. Consumers who want "live" feedback should use
  `'change'`.
- **Nested paths.** Writing `setValue('user.profile.email', ...)`
  schedules validation for exactly that path — not the containing
  `user` or `user.profile` paths. The adapter's error paths are
  re-stamped to the absolute form path, so `fieldErrors['user.profile.email']`
  gets the error.
