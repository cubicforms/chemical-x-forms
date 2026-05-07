# Register transforms

A pipeline of pure sync functions that runs over user input before
the assigner writes to form state. Use for trim, lowercase, mask,
clamp — any always-on normalisation, no matter how the user typed.

## Basic example

```ts
import type { RegisterTransform } from 'attaform'

const trim: RegisterTransform = (v) => (typeof v === 'string' ? v.trim() : v)

const lowercase: RegisterTransform = (v) => (typeof v === 'string' ? v.toLowerCase() : v)

// In setup
const rv = form.register('email', { transforms: [trim, lowercase] })
```

```vue
<input v-register="rv" />
<!-- type "  Foo@BAR.com  ", form.values.email === "foo@bar.com" -->
```

`RegisterTransform` is `(value: unknown) => unknown` —
generic-erased so the same `trim` works for every string path.
Type-safety at the call site is delegated to attaform's slim-primitive
gate at write time.

## Pipeline ordering

```text
DOM event → modifier cast → coerce → transforms[0] → … → transforms[n] → assigner
```

- **Modifier cast** — `.lazy` / `.trim` / `.number` from the
  directive itself.
- **Coerce** — schema-driven type coercion (see
  [coerce recipe](./coerce.md)).
- **Transforms** — your sync pipeline, left-to-right.
- **Assigner** — the default writer, or `@update:registerValue` if
  you've attached one.

Combine freely:
`<input v-register.lazy.number="register('age', { transforms: [clamp(0, 99)] })">`
casts to a number on blur, clamps, then writes.

## What transforms DON'T apply to

Transforms are user-input normalisation, not storage middleware:

- **Programmatic writes** (`form.setValue`, `rv.setValueWithInternalPath`) — compose transforms yourself at the call site: `form.setValue('email', lowercase(trim(rawValue)))`.
- **`form.reset()` / hydration / SSR replay** — already canonical state; re-normalising would be redundant or destructive.
- **`markBlank()`** — already writes the slim default.

## Composing with `@update:registerValue`

The override receives the **post-transform** value as its first
arg. A consumer who declared transforms intended "always
normalise"; a silent bypass when an override is attached would
be the surprise.

If you want the raw extracted value, don't register transforms
— use the override exclusively. If you want both pre- and
post-transform inspection inside the override, register
transforms and read the first arg.

## Failure mode

Transforms must be **sync**. Attaform wraps each call in try/catch; on
throw OR Promise return:

- The pipeline aborts (subsequent transforms don't run).
- Form state is NOT updated; the assigner returns `false`.
- The DOM's `:value` reactive binding round-trips form state
  back, snapping the input to the prior value (same UX as the
  documented "rejection" pattern).
- A `console.error` is logged. In dev the message includes the
  path, transform index, transform `.name`, the original error,
  and a remediation hint. In prod the message is a single fixed
  string with NONE of those — transform bodies can construct
  error messages from user-typed values, throw with sensitive
  stack frames, or originate inside deeply-nested call chains
  we don't control.

A throw on one keystroke doesn't poison subsequent keystrokes
(the next event runs the pipeline fresh) and doesn't affect
other fields' assigners (each field has its own pipeline).

## When to reach for `@update:registerValue` instead

Three patterns where the override pulls weight that `transforms`
doesn't:

- **Rejection with side effect.** The override receives the
  `RegisterValue`; you can inspect, log to telemetry, then
  conditionally call `rv.setValueWithInternalPath` or skip.
- **Redirection.** Write to a different field, multiple fields,
  or an external store using the form API.
- **Custom DOM mutation.** The override has access to the event
  flow; you can synchronously rewrite `event.target.value` if
  your use case can't rely on the `:value` round-trip.

Transforms cover normalisation. The override covers control.
