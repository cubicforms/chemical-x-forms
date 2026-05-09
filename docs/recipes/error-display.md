---
title: 'Error display'
description: 'Centralise the "should I render this error?" heuristic with `field.showErrors` and `field.firstError`. Override per-form, app-wide, or compose with the library default for a layered predicate.'
---

# Error display

Validation errors live on `field.errors`, but rendering them takes
more than presence — most apps want errors to surface only after a
submit attempt or after the user has actually interacted with a
field. Spelling that heuristic out at every error site bloats
templates and drifts across components:

```vue
<!-- Don't — the heuristic is repeated everywhere it renders -->
<input v-register="register('email')" />
<span
  v-if="
    form.fields.email.errors.length > 0 &&
    (form.meta.submitCount > 0 || (form.fields.email.touched && form.fields.email.dirty))
  "
>
  {{ form.fields.email.errors[0].message }}
</span>
```

`field.showErrors` and `field.firstError` collapse the whole pattern
to a two-line idiom:

```vue
<input v-register="register('email')" />
<span v-if="form.fields.email.showErrors">
  {{ form.fields.email.firstError?.message }}
</span>
```

`showErrors` is the gate, `firstError` is the data. Each is reactive,
each is independent, each works on leaf and container paths alike.

## The two primitives

### `field.showErrors`

`true` when there are errors at this path AND the configured
heuristic decides they're ready to render. The framework gates the
predicate on `errors.length > 0`, so `showErrors` is `false`
whenever there's nothing to show — regardless of the heuristic.

### `field.firstError`

The first `ValidationError` at this path in deterministic
schema-declaration order, or `undefined` when there are none. Pure
data — independent of `showErrors`. Reach for it when you want a
single highest-priority message; reach for `field.errors` when you
want the full list.

`firstError` is `errors[0]` — the underlying ordering is stable
(schema → blank → user errors at one path; bucketed by
`pathOrdinal` across descendants for container paths) so the same
set of errors always produces the same `firstError`.

## The default heuristic

Out of the box:

```ts
const defaultShouldShowErrors = (field, formMeta) =>
  formMeta.submitCount > 0 || (field.touched === true && field.dirty)
```

"Show errors after the first submit attempt OR after the user has
interacted with the field AND made a change." Standard form UX —
errors stay quiet until they're actionable.

## Override per form

```ts
useForm({
  schema,
  shouldShowErrors: (field, formMeta) => formMeta.submitCount > 0,
})
```

Per-form override beats the plugin default and beats the library
default.

## Override app-wide

```ts
import { createAttaform } from 'attaform'

createApp(App).use(
  createAttaform({
    defaults: {
      shouldShowErrors: (field, formMeta) => formMeta.submitCount > 0 || field.touched === true,
    },
  })
)
```

Every form in the app inherits this heuristic unless it sets its
own.

## Boolean shorthand

```ts
useForm({ schema, shouldShowErrors: true }) // always show when errors exist
useForm({ schema, shouldShowErrors: false }) // never show — adopters who gate manually
```

`true` means "show errors whenever any exist"; `false` means "never
gate via `showErrors` — read `firstError` / `errors` directly and
write your own template logic." `true` does NOT render an empty
errors block — the framework still gates on `errors.length > 0`.

## Compose with `defaultShouldShowErrors`

The library default is publicly exported. Layered predicates that
add a special case but otherwise defer to the library default pick
up future heuristic refinements automatically:

```ts
import { defaultShouldShowErrors } from 'attaform'

useForm({
  schema,
  shouldShowErrors: (field, formMeta) =>
    field.path[0] === 'urgent' || defaultShouldShowErrors(field, formMeta),
})
```

If a future Attaform release tweaks the default heuristic (say, to
also fire on blur), every layered predicate that defers to the
default inherits the change without code edits.

## Container paths

Both primitives work on container paths — render row-level or
section-level summary errors with the same idiom:

```vue
<div v-for="(_, i) in form.values.users" :key="i">
  <input v-register="register(['users', i, 'name'])" />
  <input v-register="register(['users', i, 'email'])" />
  <!-- One row-level summary instead of per-field repetition -->
  <span v-if="form.fields.users[i]?.showErrors" class="row-error">
    {{ form.fields.users[i]?.firstError?.message }}
  </span>
</div>
```

For a container, `firstError` is the first error in the aggregated
subtree (descendants sorted by schema-declaration order); `showErrors`
runs the predicate against the container's aggregated state
(`touched` becomes "any descendant touched", `dirty` becomes "any
descendant dirty", etc.). Same predicate; uniform across depth.

## `form.meta.showErrors`

`form.meta` is the root container's FieldState plus the form-level
lifecycle fields, so `form.meta.showErrors` and
`form.meta.firstError` are the form-wide rollup:

```vue
<div v-if="form.meta.showErrors" class="form-summary">
  Please fix the {{ form.meta.errors.length }} highlighted issue(s).
</div>
```

## Predicate signature

```ts
type ShouldShowErrors = (
  field: Omit<FieldState, 'showErrors' | 'firstError'>,
  formMeta: Omit<FormMeta, 'showErrors' | 'firstError'>
) => boolean
```

Both arguments omit `showErrors` / `firstError` — those are derived
FROM this predicate, so reading them inside would be a self-
reference. The omit is enforced at the type level AND at runtime
(the keys literally are not present on the objects), so cycles are
impossible whether you're writing TypeScript, vanilla JS, or
casting through `as`.

The predicate must be **pure** and **SSR-safe**. It runs inside Vue
computeds; reading reactive state (`field.touched`,
`formMeta.submitCount`, etc.) registers as a dependency
automatically, but DOM access (`window`, `document`) breaks SSR.

## Opting out of `showErrors`

Adopters who want full control read `field.errors` (or
`field.firstError` for the sugar) and gate rendering with their own
template logic:

```vue
<span v-if="form.fields.email.errors.length > 0 && customGate">
  {{ form.fields.email.firstError?.message }}
</span>
```

`firstError` is always available; `showErrors` is the convenience.
