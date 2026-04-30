# `blank` — the storage / display divergence side-channel

The form library tracks one extra bit per primitive leaf called `blank`.
Most of the time you don't need to think about it — submit / validate
already incorporate it, and `form.errors` reflects it reactively. But
when you do hit it, this is the model.

## Why it exists

The whole library obeys one principle: **`errors = f(schema, state)`**.
Storage plus the schema is enough to know whether the form is valid.
That's almost true — there's exactly one case where it isn't.

Numeric inputs lie. A `<input type="number">` whose value the user has
just cleared shows `''` in the DOM, but the slim shape requires a
number, so storage holds `0`. The schema can't tell the difference
between "user typed `0`" and "user supplied nothing" — both produce
`0` in storage. Without a side-channel, the runtime would either:

- Trust storage and silently submit `0` for an unfilled required field
  (the public-housing-form footgun: "Income? `$0`. Approved.").
- Re-define `0` as "definitely blank," which loses the case where the
  user actually meant `0`.

`blankPaths` is the side-channel. It's a reactive `Set<PathKey>`
recording paths where the runtime knows storage and the visible
display diverge. The schema author writes `z.number()` and gets the
"empty input" signal back without inventing a sentinel value.

## Where it shines (and where it doesn't)

The mechanism is principled exactly because the asymmetry below is
real, not invented:

| Type      | Storage slim default | DOM "empty" | Need the side-channel?                 |
| --------- | -------------------- | ----------- | -------------------------------------- |
| `number`  | `0`                  | `''`        | **Yes** — storage and display diverge. |
| `bigint`  | `0n`                 | `''`        | **Yes** — same reason.                 |
| `string`  | `''`                 | `''`        | No — they match byte-for-byte.         |
| `boolean` | `false`              | unchecked   | No — they match.                       |

So `blank` auto-marks **only numeric leaves**. For strings and
booleans, the schema sees what the user sees. If you want
"required string must be non-empty," express that in the schema
(`z.string().min(1)`) and a refinement error fires the moment storage
is `''` — no library-level guess required. The library doesn't
second-guess the schema's accepted-empty verdict.

## Lifecycle (numeric)

```
form mounts (no defaults)
  → blankPaths.add('income')
  → form.errors.income = [{ code: 'cx:no-value-supplied', … }]
  → form.fields.income.blank === true

user types "5"
  → blankPaths.delete('income')
  → form.errors.income = undefined
  → form.fields.income.blank === false

user clears the input (backspace)
  → directive sees el.value === ''
  → blankPaths.add('income')
  → form.errors.income re-appears reactively
  → form.fields.income.blank === true

user types "0"
  → blankPaths stays empty (the value is intentional)
  → form.errors.income stays undefined
```

`errors = f(schema, state)` holds at every step — `state` includes
`(form.value, blankPaths)`, and the function recomputes whenever
either changes.

## Lifecycle (string)

```
form mounts (no defaults)
  → blankPaths empty (strings don't auto-mark)
  → form.errors.email = undefined          (z.string() accepts '')
  → form.fields.email.blank === false

user types "hi" then deletes
  → blankPaths still empty
  → form.errors.email still undefined      (z.string() still accepts '')
  → form.fields.email.blank === false
```

If the schema is `z.string().min(1)` instead, the lifecycle is the
same on `blankPaths` — but `form.errors.email` carries a refinement
error whenever storage is `''`, because that's the schema speaking.
The blank channel stays out of it.

## Explicit opt-in for any primitive: the `unset` sentinel

Sometimes you do want a string or boolean leaf to start blank — a
"please choose" indicator on a checkbox, a deferred-fill text field.
That's an explicit consumer signal, not runtime inference. Use the
`unset` sentinel:

```ts
import { unset, useForm } from '@chemical-x/forms/zod'

useForm({
  schema: z.object({ agreed: z.boolean(), note: z.string() }),
  defaultValues: { agreed: unset, note: unset },
})

// Or imperatively:
form.setValue('agreed', unset)
form.reset({ note: unset })
```

`unset` works at any primitive leaf and adds the path to `blankPaths`.
Combined with required schemas, it surfaces a `cx:no-value-supplied`
error reactively — same lifecycle as the numeric case, just driven by
your intent rather than runtime inference.

## How to read `blank` in your UI

The library never renders. It exposes the signal; your component
decides what to do.

```vue
<script setup lang="ts">
  const form = useForm({ schema })
</script>

<template>
  <input v-register="form.register('income')" />

  <!-- show errors only after the user has touched the field -->
  <p v-if="form.errors.income && form.fields.income.touched" class="error">
    {{ form.errors.income[0].message }}
  </p>

  <!-- separately, an "unanswered" hint that distinguishes from errors -->
  <span v-if="form.fields.income.blank" class="hint"> Required — please enter a number </span>
</template>
```

Reading `form.errors.income` directly gives you whatever the schema
and the blank channel produced. Reading `form.fields.income.blank`
gives you the raw "did the user supply something?" bit, useful for
pre-error indicators or progress meters.

## Submit-time integration

`handleSubmit`, `validate`, and `validateAsync` all consult the same
reactive store. A required path that's blank produces a
`cx:no-value-supplied` entry in their response, no separate API call
needed. Conversely, a successful submit means _both_ refinement
validation passed _and_ every required path has a non-blank value.

Your `onError` callback gets the merged error list:

```ts
const handler = form.handleSubmit(
  (values) => api.submit(values),
  (errors) => {
    const blank = errors.filter((e) => e.code === 'cx:no-value-supplied')
    const refinement = errors.filter((e) => e.code !== 'cx:no-value-supplied')
    // ... your UX
  }
)
```

The error code is stable (`cx:no-value-supplied`); filter on it when
you want to display blank-required cases differently from refinement
failures.

## Persistence

Persisted drafts carry `blankPaths` alongside `form` so a hydrated
form lands in the same UI state the user left it. A user who cleared
a numeric input, navigated away, and came back sees the field empty
and the error reappear — same lifecycle, just resumed.

See [`recipes/persistence.md`](./recipes/persistence.md) for the
hydration boundary.

## TL;DR

- `blank` exists for numeric leaves where storage is `0`/`0n` but
  display is `''`. That's the only place runtime inference is needed.
- Strings and booleans don't auto-mark — `''`/`false` are the same
  byte-for-byte at storage and display, and the schema is the
  authority on whether they're acceptable.
- `unset` is the universal explicit opt-in for any primitive type.
- `form.errors` is reactive end-to-end: a blank required path
  produces an error the moment it's true, no `validate()` call
  required.
- The library exposes the signal; the UI decides what to render and
  when.
