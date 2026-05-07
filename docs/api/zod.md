# `attaform/zod`

Zod v4 adapter. Requires `zod@^4`.

```ts
import { useForm, zodAdapter, fieldMeta, withMeta, kindOf, assertZodVersion } from 'attaform/zod'
import type { FieldMetaPayload, ZodKind } from 'attaform/zod'
```

## `useForm<Schema>(options)`

The primary entry point. Returns a typed reactive surface; see
[The useForm return value](/docs/api/use-form-return).

```ts
const schema = z.object({ email: z.email() })
const form = useForm({ schema, key: 'signup' })
```

Options:

| Field              | Type                                                                                                | Required | Description                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`           | `z.ZodType`                                                                                         | yes      | The Zod schema describing the form shape.                                                                                                      |
| `key`              | `string`                                                                                            | no       | Form identity for `injectForm(key)`, shared state, persistence keys, or DevTools labels. See [Keys](#keys).                                    |
| `defaultValues`    | `DeepPartial<DefaultValuesShape<Form>>`                                                             | no       | Constraints applied over schema defaults. Each leaf may be the `unset` sentinel. See [Default values](#default-values).                        |
| `strict`           | `boolean`                                                                                           | no       | Default `true` — defaults that fail the schema seed `schemaErrors` at construction. `false` opts out (multi-step wizards, placeholder rows).   |
| `onInvalidSubmit`  | `'none'` \| `'focus-first-error'` \| `'scroll-to-first-error'` \| `'both'`                          | no       | Behaviour on failed submit. See [recipe](/docs/recipes/focus-on-error).                                                                        |
| `validateOn`       | `'change'` \| `'blur'` \| `'submit'`                                                                | no       | When per-field validation runs. Default `'change'`. See [recipe](/docs/recipes/field-level-validation).                                        |
| `debounceMs`       | `number`                                                                                            | no       | Wait after the last write before re-validating. Default `0`. Only valid with `validateOn: 'change'`.                                           |
| `coerce`           | `boolean` \| `CoercionRegistry`                                                                     | no       | DOM-input coercion. Default `true` (`string→number`, `string→boolean`). See [recipe](/docs/recipes/coerce).                                    |
| `rememberVariants` | `boolean`                                                                                           | no       | Default `true` — switching back to a discriminated-union variant restores its prior subtree. See [recipe](/docs/recipes/discriminated-unions). |
| `persist`          | `FormStorageKind \| FormStorage \| { storage, key?, debounceMs?, include?, clearOnSubmitSuccess? }` | no       | Persistence config. Per-field opt-in lives at `register()`. See [Persistence config](#persistence-config).                                     |
| `history`          | `true` \| `{ max?: number }`                                                                        | no       | Enable undo/redo. See [recipe](/docs/recipes/undo-redo).                                                                                       |

### Keys

Omit for one-off forms — the runtime allocates a synthetic
`__atta:anon:<id>` via `useId()`. Pass a string when you need
cross-component lookup via `injectForm(key)`, shared state across
call-sites, a stable `persist` storage-key default, or a
recognisable DevTools label.

Keys starting with `__atta:` are reserved for the library's
internal synthetic-key namespace; passing one throws
`ReservedFormKeyError`.

### Default values

Refinement-invalid leaves that satisfy the slim primitive type at
their path (e.g. `'teal'` against `z.enum(['red','green','blue'])`,
a 4-character string against `z.string().min(8)`) pass through
unchanged so SSR / autosave rehydration can land partial-but-saved
state as-is. Wrong-primitive leaves (a number where a string is
expected) are still replaced by the schema default.

Each primitive leaf may be the `unset` sentinel to mark the path
displayed-empty at construction.

### Persistence config

The form-level option is operational only — backend, key,
debounce, error inclusion. Per-field opt-in lives at every
`register('foo', { persist: true })` call site; this config alone
never causes any field to persist.

Three input forms: a string shorthand (`'local'` / `'session'` /
`'indexeddb'`), a custom `FormStorage` adapter passed directly, or
the full options bag.

Storage keys carry the schema's fingerprint
(`${base}:${fingerprint}`) so schema changes auto-invalidate old
drafts. The orphan-cleanup pass on mount sweeps stale-fingerprint
entries on the configured backend AND wipes any matching keys on
the non-configured standard backends. Malformed payloads are wiped
on read.

See [persistence recipe](/docs/recipes/persistence) for the full pattern.

## Schema-attached metadata

Attach labels, descriptions, and placeholders directly to schema
fields. Read them off `form.fields(path).label` / `.description` /
`.placeholder` / `.meta` — same surface for leaves and containers.

```ts
import { z } from 'zod'
import { fieldMeta, withMeta } from 'attaform/zod'

// Native Zod 4 chain
const A = z.object({
  email: z.email().register(fieldMeta, {
    label: 'Email',
    placeholder: 'you@example.com',
  }),
})

// Helper (works on v3 and v4)
const B = z.object({
  email: withMeta(z.email(), {
    label: 'Email',
    placeholder: 'you@example.com',
  }),
})
```

Both forms write to the same `fieldMeta` registry; pick whichever
reads naturally. Container schemas register the same way:
`z.object({...}).register(fieldMeta, { label: 'Pickup address' })`.

**Resolution order** for each field on `form.fields(path)`:

| Field         | Sources                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `label`       | registered `label` → `humanize(lastSegment)` (camelCase / snake_case / kebab-case → Title Case; numeric segments collapse to `''`) |
| `description` | registered `description` → `schema.description` (Zod's `.describe(...)`) → `undefined`                                             |
| `placeholder` | registered `placeholder` → `undefined`                                                                                             |
| `meta`        | the full registered payload, frozen — empty object when nothing has been registered                                                |

Setting both `.describe('...')` and `.register(fieldMeta, { description: '...' })` is fine — the registered description wins,
and `.describe()` stays readable for unrelated tooling (JSON-Schema
export, etc.).

**Custom payload keys.** `FieldMetaPayload` is an `interface` — extend
it via TypeScript module augmentation:

```ts
declare module 'attaform/zod' {
  interface FieldMetaPayload {
    tooltip?: string
    icon?: string
  }
}

const schema = z.object({
  email: z.email().register(fieldMeta, { label: 'Email', tooltip: 'For login' }),
})

// template: {{ form.fields.email.meta.tooltip }} → 'For login'
```

The single `fieldMeta` registry holds the augmented shape — no
fragmentation across consumers.

## `zodAdapter(schema)`

Lower-level. Returns an `AbstractSchema<Form, Form>` that wraps a
Zod schema. Reach for it only when composing your own `useForm`-like
hook.

## `kindOf(schema)`

Returns the zod kind (`'string'`, `'number'`, `'object'`,
`'discriminated-union'`, etc.) for a Zod 4 schema. For advanced
adapter work — wrapping `register`, building per-kind UI, branching
on schema shape.

## `assertZodVersion(schema)`

Throws if the installed `zod` major doesn't match the adapter. Use
when wiring custom adapter code that introspects schema internals
and would silently misbehave under the wrong version.

## `type ZodKind`

Union of the strings returned by `kindOf` — `'string' | 'number' | 'boolean' | 'object' | 'array' | 'tuple' | 'discriminated-union' | 'union' | …`.
