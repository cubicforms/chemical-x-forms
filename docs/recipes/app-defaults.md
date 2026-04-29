# App-level defaults

cx ships sensible library defaults (`fieldValidation: { on: 'change',
debounceMs: 125 }`, `validationMode: 'strict'`, `onInvalidSubmit:
'none'`) that fit most apps out of the box. Set app-wide overrides
once via the plugin instead of repeating them at every `useForm` call.

## Setup

### Bare Vue 3

```ts
// main.ts
import { createApp } from 'vue'
import { createChemicalXForms } from '@chemical-x/forms'

createApp(App)
  .use(
    createChemicalXForms({
      defaults: {
        fieldValidation: { debounceMs: 100 },
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
  modules: ['@chemical-x/forms/nuxt'],
  chemicalX: {
    defaults: {
      fieldValidation: { debounceMs: 100 },
      onInvalidSubmit: 'focus-first-error',
    },
  },
})
```

## Resolution order

For each option, the resolved value is the first defined among:

```
useForm({ … })  >  createChemicalXForms({ defaults })  >  library default
```

So a per-form value always wins, an app-level default fills in when
omitted, and the library's built-in default is the final fallback.

## Merge semantics

| Option            | Merge                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| `validationMode`  | Per-form replaces default outright.                                        |
| `onInvalidSubmit` | Per-form replaces default outright.                                        |
| `history`         | Per-form replaces default outright (whole config object, not field-level). |
| `fieldValidation` | **Field-level merge** — see below.                                         |

`fieldValidation` is the only deep-merged option. It's small (`on` +
`debounceMs`) and the use case is real: set `debounceMs` once for the
whole app, override `on` per-form when needed.

```ts
// Plugin side
createChemicalXForms({
  defaults: { fieldValidation: { debounceMs: 100 } },
})

// useForm calls
useForm({ schema })
// → fieldValidation: { on: 'change', debounceMs: 100 }
//   (library default 'on' + app-level debounceMs)

useForm({ schema, fieldValidation: { on: 'blur' } })
// → fieldValidation: { on: 'blur', debounceMs: 100 }
//   (per-form 'on' wins; app-level debounceMs carries over)

useForm({ schema, fieldValidation: { debounceMs: 50 } })
// → fieldValidation: { on: 'change', debounceMs: 50 }
//   (library default 'on' + per-form debounceMs)
```

## What's supported

`ChemicalXFormsDefaults` covers the form-shaping options:

```ts
type ChemicalXFormsDefaults = {
  validationMode?: 'strict' | 'lax'
  onInvalidSubmit?: 'none' | 'focus-first-error' | 'scroll-to-first-error' | 'both'
  fieldValidation?: { on?: 'change' | 'blur' | 'none'; debounceMs?: number }
  history?: true | { max?: number }
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

App-level defaults shape options like `validationMode` and
`fieldValidation`. Per-form initial values live on each
`useForm({ defaultValues })` call.

Three patterns:

```ts
import { unset } from '@chemical-x/forms/zod'

// 1. Plain values — explicit defaults flow into storage and the form
//    is not transient-empty for those leaves.
useForm({ schema, defaultValues: { email: 'me@example.com', count: 10 } })

// 2. Omit defaultValues entirely — every primitive leaf (string,
//    number, boolean, bigint) is auto-marked transient-empty at
//    construction. Storage holds the schema's slim defaults; the
//    form displays empty; submit raises 'No value supplied' for
//    required schemas.
useForm({ schema })

// 3. Mark specific leaves as `unset` — those leaves are transient-
//    empty; siblings without an explicit value are auto-marked too.
useForm({ schema, defaultValues: { email: unset, count: 10 } })
//                                  ^^^^^^^^^^^^^ transient-empty
//                                                  ^^^^^^^^^ explicit value
```

`unset` works in `setValue('email', unset)` and `reset({ email: unset })`
identically — same semantic everywhere.

The auto-mark and the explicit `unset` paths converge on the same
state: the path lives in the form's transient-empty set, surfaced
via `getFieldState(path).value.pendingEmpty` and
`form.transientEmptyPaths.value` for bulk introspection. Submit /
validate / validateAsync raise `'No value supplied'` (`code:
'cx:no-value-supplied'`) for required schemas; `.optional()` /
`.nullable()` / `.default(N)` / `.catch(N)` schemas accept the
empty case.

To opt a leaf OUT of auto-mark, supply a non-`unset` value for it
(`defaultValues: { email: '' }` is the explicit "empty string is
intentional" signal — storage holds `''` and the path is NOT
transient-empty).

## Alternative: userland wrapper

If you need defaults but don't want to touch the plugin (third-party
component library, opting in only for some forms), wrap `useForm` in
your project:

```ts
// composables/useAppForm.ts
import { useForm as cxUseForm } from '@chemical-x/forms/zod'
import type { z } from 'zod'

export function useAppForm<S extends z.ZodObject>(opts: Parameters<typeof cxUseForm<S>>[0]) {
  return cxUseForm({
    fieldValidation: { on: 'change', debounceMs: 100 },
    ...opts,
  })
}
```

This is fully equivalent for the consumer — every `useAppForm` call
gets your defaults; per-form options still win via the spread. The
plugin-level approach is more idiomatic for first-party apps; the
wrapper is right when you can't (or shouldn't) influence the plugin
config from your call site.
