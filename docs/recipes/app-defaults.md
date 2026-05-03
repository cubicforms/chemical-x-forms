# App-level defaults

cx ships sensible library defaults (`validateOn: 'change'`,
`debounceMs: 0`, `strict: true`, `coerce: true`,
`rememberVariants: true`, `onInvalidSubmit: 'none'`) that fit most
apps out of the box. Set app-wide overrides once via the plugin
instead of repeating them at every `useForm` call.

## Setup

### Bare Vue 3

```ts
// main.ts
import { createApp } from 'vue'
import { createDecant } from 'decant'

createApp(App)
  .use(
    createDecant({
      defaults: {
        debounceMs: 100,
        onInvalidSubmit: 'focus-first-error',
      },
    })
  )
  .mount('#app')
```

### Nuxt 3 / 4

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['decant/nuxt'],
  decant: {
    defaults: {
      debounceMs: 100,
      onInvalidSubmit: 'focus-first-error',
    },
  },
})
```

## Resolution order

For each option, the resolved value is the first defined among:

```
useForm({ … })  >  createDecant({ defaults })  >  library default
```

So a per-form value always wins, an app-level default fills in when
omitted, and the library's built-in default is the final fallback.

## Merge semantics

Every option resolves independently — set anything once at the app
level, override anything per-form without losing the rest:

```ts
// Plugin side
createDecant({
  defaults: { validateOn: 'change', debounceMs: 100 },
})

// useForm calls
useForm({ schema })
// → validateOn: 'change', debounceMs: 100 (app-level both)

useForm({ schema, validateOn: 'blur' })
// → validateOn: 'blur', debounceMs: ignored
//   (validateOn: 'blur' rejects debounceMs by type, the inherited
//   100 is silently dropped)

useForm({ schema, debounceMs: 25 })
// → validateOn: 'change' (app-level), debounceMs: 25 (per-form wins)
```

`validateOn` and `debounceMs` are flat top-level fields — there's no
nested merge object anymore. The TS-level `ValidateOnConfig`
discriminated union enforces that `debounceMs` is only valid when
`validateOn` is `'change'` (or omitted); pairing it with `'blur'` /
`'submit'` is a compile-time error.

## What's supported

`DecantDefaults` covers the form-shaping options:

```ts
type DecantDefaults = {
  strict?: boolean
  validateOn?: 'change' | 'blur' | 'submit'
  debounceMs?: number
  onInvalidSubmit?: 'none' | 'focus-first-error' | 'scroll-to-first-error' | 'both'
  history?: true | { max?: number }
  rememberVariants?: boolean
  coerce?: boolean | CoercionRegistry
}
```

What's **not** supported (and why):

- `schema`, `key`, `defaultValues` — per-form by definition. A
  cross-form schema doesn't make sense; per-form keys are identity.
- `persist` — opt-in per form already; cross-form storage defaults
  are ambiguous (key-prefix collisions, adapter selection). Set
  `persist` per-form for now; this may land as a follow-up if a real
  use case appears.

## Per-form `defaultValues`

App-level defaults shape options like `strict` and `validateOn`.
Per-form initial values live on each `useForm({ defaultValues })`
call.

Three patterns:

```ts
import { unset } from 'decant/zod'

// 1. Plain values — explicit defaults flow into storage and the form
//    is not blank for those leaves.
useForm({ schema, defaultValues: { email: 'me@example.com', count: 10 } })

// 2. Omit defaultValues entirely — every NUMERIC primitive leaf
//    (number, bigint) is auto-marked blank at construction. Storage
//    holds the schema's slim defaults; the form displays empty;
//    `form.errors.<path>` reactively carries 'No value supplied' for
//    required schemas. Strings and booleans are NOT auto-marked
//    because their slim defaults match what the DOM shows natively
//    — the schema is the authority on whether `''` / `false` is
//    acceptable. See `docs/blank.md` for the full rationale.
useForm({ schema })

// 3. Mark specific leaves as `unset` — those leaves are blank
//    explicitly, regardless of type. Numeric siblings without an
//    explicit value still auto-mark; string / boolean siblings
//    without an explicit value are NOT auto-marked.
useForm({ schema, defaultValues: { email: unset, count: 10 } })
//                                  ^^^^^^^^^^^^^ blank (explicit unset)
//                                                  ^^^^^^^^^ explicit value
```

`unset` works in `setValue('email', unset)` and `reset({ email: unset })`
identically — same semantic everywhere.

Auto-mark and explicit `unset` converge on the same state: the path
lives in the form's `blankPaths` set, surfaced via
`form.fields.<path>.blank` and `form.blankPaths.value` for bulk
introspection. The merged `form.errors.<path>` reactively carries
`'No value supplied'` (`code: 'cx:no-value-supplied'`) for required
schemas; `.optional()` / `.nullable()` / `.default(N)` / `.catch(N)`
schemas accept the empty case.

To opt a numeric leaf OUT of auto-mark, supply a non-`unset` value
(`defaultValues: { count: 0 }` is the explicit "0 is intentional"
signal). For strings and booleans you don't need an opt-out — they're
not auto-marked in the first place. See `docs/blank.md` for why the
asymmetry is principled (storage / display divergence is real for
numerics and absent for strings / booleans).

## Alternative: userland wrapper

If you need defaults but don't want to touch the plugin (third-party
component library, opting in only for some forms), wrap `useForm` in
your project:

```ts
// composables/useAppForm.ts
import { useForm as cxUseForm } from 'decant/zod'
import type { z } from 'zod'

export function useAppForm<S extends z.ZodObject>(opts: Parameters<typeof cxUseForm<S>>[0]) {
  return cxUseForm({
    validateOn: 'change',
    debounceMs: 100,
    ...opts,
  })
}
```

This is fully equivalent for the consumer — every `useAppForm` call
gets your defaults; per-form options still win via the spread. The
plugin-level approach is more idiomatic for first-party apps; the
wrapper is right when you can't (or shouldn't) influence the plugin
config from your call site.
