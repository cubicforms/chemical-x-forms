# API reference

Every public export of `@chemical-x/forms`, grouped by subpath. Each
entry gives the signature, the shape of the return value, and the
minimal example you need to wire it up.

## Contents

- [`@chemical-x/forms/zod`](#chemical-xformszod) — recommended entry
- [`@chemical-x/forms/zod-v3`](#chemical-xformszod-v3) — legacy
- [`@chemical-x/forms`](#chemical-xforms) — framework-agnostic core
- [`@chemical-x/forms/nuxt`](#chemical-xformsnuxt) — Nuxt module
- [`@chemical-x/forms/vite`](#chemical-xformsvite) — Vite plugin
- [`@chemical-x/forms/transforms`](#chemical-xformstransforms) — raw transforms
- [The useForm return value](#the-useform-return-value)
- [Types](#types)

---

## `@chemical-x/forms/zod`

Zod v4 adapter. Requires `zod@^4`.

```ts
import { useForm, zodAdapter, kindOf, assertZodVersion } from '@chemical-x/forms/zod'
```

### `useForm<Schema>(options)`

The primary entry point. Returns a typed reactive surface; see
[The useForm return value](#the-useform-return-value).

```ts
const schema = z.object({ email: z.email() })
const form = useForm({ schema, key: 'signup' })
```

Options:

| Field             | Type                                                                                                | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema`          | `z.ZodType`                                                                                         | yes      | The Zod schema describing the form shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `key`             | `string`                                                                                            | no       | Form identity. Omit for one-off forms (runtime allocates a synthetic `__cx:anon:<id>` via `useId()`). Pass a string when you need cross-component lookup via `useFormContext(key)`, shared state across call-sites, a stable `persist` storage-key default, or a recognisable DevTools label. Keys starting with `__cx:` are reserved for the library's internal synthetic-key namespace; passing one throws `ReservedFormKeyError`.                                                                                                                                                                                                                                                                                                       |
| `defaultValues`   | `DeepPartial<DefaultValuesShape<Form>>`                                                             | no       | Constraints applied over schema defaults. Refinement-invalid leaves that satisfy the slim primitive type at their path (e.g. `'teal'` against `z.enum(['red','green','blue'])`, a 4-character string against `z.string().min(8)`) pass through unchanged so SSR / autosave rehydration can land partial-but-saved state as-is. Wrong-primitive leaves (a number where a string is expected) are still replaced by the schema default. Each primitive leaf may be the `unset` sentinel to mark the path displayed-empty at construction.                                                                                                                                                                                                    |
| `validationMode`  | `'lax'` \| `'strict'`                                                                               | no       | Defaults to `'strict'` — defaults that fail the schema seed `schemaErrors` at construction. Pass `'lax'` to opt out (multi-step wizards, placeholder rows). See [Types](#types).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `onInvalidSubmit` | `'none'` \| `'focus-first-error'` \| `'scroll-to-first-error'` \| `'both'`                          | no       | What to do when submit fails validation. See [recipe](./recipes/focus-on-error.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `fieldValidation` | `{ on, debounceMs }`                                                                                | no       | Live field validation. Default `{ on: 'change', debounceMs: 125 }` — errors track live. Pass `{ on: 'none' }` to opt out (submit-only). See [recipe](./recipes/field-level-validation.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `persist`         | `FormStorageKind \| FormStorage \| { storage, key?, debounceMs?, include?, clearOnSubmitSuccess? }` | no       | Operational config for the persistence pipeline. Three input forms: a string shorthand (`'local'` / `'session'` / `'indexeddb'`), a custom `FormStorage` adapter passed directly, or the full options bag. Per-field opt-in lives at every `register('foo', { persist: true })` call site — this config alone never causes any field to persist. Storage keys carry the schema's fingerprint (`${base}:${fingerprint}`) so schema changes auto-invalidate old drafts; the orphan-cleanup pass on mount sweeps stale-fingerprint entries on the configured backend AND wipes any matching keys on the non-configured standard backends (cross-store cleanup). Malformed payloads are wiped on read. See [recipe](./recipes/persistence.md). |
| `history`         | `true` \| `{ max?: number }`                                                                        | no       | Enable undo/redo. See [recipe](./recipes/undo-redo.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### `zodAdapter(schema)`

Lower-level. Returns an `AbstractSchema<Form, Form>` that wraps a
Zod schema. Use it only when composing your own `useForm`-like
hook; most consumers import `useForm` directly.

### `kindOf(schema)`

Returns the zod kind (`'string'`, `'number'`, `'object'`,
`'discriminated-union'`, etc.) for a zod v4 schema. For advanced
adapter work.

### `assertZodVersion(version)`

Throws if the installed zod major doesn't match the argument.

### `type ZodKind`

Union of the strings returned by `kindOf`.

---

## `@chemical-x/forms/zod-v3`

Zod v3 adapter. Requires `zod@^3`. New projects should use `/zod`
(v4).

```ts
import { useForm, zodAdapter, isZodSchemaType } from '@chemical-x/forms/zod-v3'
```

Same surface as `/zod` for the functions that apply. Helper types
for v3 introspection (`UnwrapZodObject`, `ZodTypeWithInnerType`,
…) are also exported.

---

## `@chemical-x/forms`

The framework-agnostic core. Use this if you're bringing your own
schema library or wiring SSR by hand.

```ts
import {
  createChemicalXForms,
  useForm, // re-export of useAbstractForm
  useFormContext,
  useRegistry,
  renderChemicalXState,
  hydrateChemicalXState,
  escapeForInlineScript,
  vRegister,
  canonicalizePath,
  parseApiErrors,
} from '@chemical-x/forms'
```

### `createChemicalXForms(options?)`

The Vue plugin. Install once per app.

```ts
createApp(App).use(createChemicalXForms()).mount('#app')
```

Options:

| Field      | Type                     | Description                                                                                         |
| ---------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| `override` | `boolean`                | Force `isSSR` to `true` / `false`. Auto-detected otherwise.                                         |
| `devtools` | `boolean`                | Enable the Vue DevTools plugin. Default `true`. See [recipe](./recipes/devtools.md).                |
| `defaults` | `ChemicalXFormsDefaults` | App-level option defaults applied to every `useForm` call. See [recipe](./recipes/app-defaults.md). |

### `useForm<Form>({ schema, key, ... })`

Schema-agnostic. Takes any `AbstractSchema<Form, Form>` — wrap a
Valibot schema, ArkType schema, or a hand-rolled validator with
[a custom adapter](./recipes/custom-adapter.md). The Zod subpaths
are pre-made wrappers over this.

### `useFormContext<Form>(key?)`

Reach the nearest ancestor's form (no key) or reach any form by its
key. Type-identical return to `useForm`. See
[recipe](./recipes/form-context.md).

### `useRegistry()`

Returns the current app's `ChemicalXRegistry`. Must be called inside
a component's `setup()`.

### `renderChemicalXState(app) → SerializedChemicalXState`

Server-side: serialize every form in the app to a plain object safe
for `JSON.stringify`. Pair with `hydrateChemicalXState` on the
client.

### `hydrateChemicalXState(app, payload)`

Client-side: rehydrate forms from the serialized payload. Call
before `app.mount(...)`.

### `escapeForInlineScript(json) → string`

Takes a JSON string and escapes the characters that would let a
form value break out of an inline `<script>` tag: `<`, `>`, `&`,
U+2028, U+2029. Pair with `renderChemicalXState` when hand-rolling
SSR; Nuxt handles it for you via `devalue`.

```ts
const payload = escapeForInlineScript(JSON.stringify(renderChemicalXState(app)))
// `<script>window.__STATE__ = ${payload}</script>` is safe to inline.
```

### `vRegister`

The `v-register` directive. Registered automatically by
`createChemicalXForms`; exported for consumers installing directives
manually.

Bind to a native input, select, textarea, checkbox, or radio:

```vue
<input v-register="form.register('email')" />
<select v-register="form.register('country')">...</select>
```

Or to a custom component whose root is **not** a native input —
`useRegister()` in the child reads the parent's binding so you can
re-bind `v-register` onto an inner native element. When the
wrapper's root _is_ the input itself, Vue's attribute fallthrough
handles it and `useRegister` is unnecessary.

```vue
<!-- Parent -->
<MyField label="Email" v-register="form.register('email')" />

<!-- MyField.vue (root is <label>, not <input>) -->
<script setup lang="ts">
  import { useRegister } from '@chemical-x/forms'
  defineProps<{ label: string }>()
  const register = useRegister()
</script>

<template>
  <label class="field">
    <span>{{ label }}</span>
    <input v-register="register" />
  </label>
</template>
```

#### Modifiers

`v-register` mirrors Vue's `v-model` modifier semantics, scoped per
element type. Modifier names are typed — a typo (`v-register.lazi`)
is a TypeScript error, not a silent runtime no-op.

| Element                                                      | Modifier  | What it does                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<input type="text">`, `<input type="number">`, `<textarea>` | `.lazy`   | Write on `change` (blur) instead of `input`. Disables IME composition handlers — composition events don't gate writes.                                                                                                                                              |
| `<input type="text">`, `<input type="number">`, `<textarea>` | `.trim`   | Strip leading/trailing whitespace **on blur**. While the user is typing, the model holds the raw input (whitespace included); on `change` the value is trimmed once and written to both model and DOM. Combine with `.lazy` to skip the mid-typing writes entirely. |
| `<input type="text">`, `<input type="number">`, `<textarea>` | `.number` | Cast via `parseFloat` before writing; values that can't be parsed pass through unchanged. Auto-applied for `<input type="number">` — explicit `.number` is redundant.                                                                                               |
| `<select>`                                                   | `.number` | Cast each selected option's `value` via `parseFloat` before writing. Mirrors Vue's `v-model` on `<select>`.                                                                                                                                                         |
| `<input type="checkbox">`, `<input type="radio">`            | _(none)_  | No modifiers — Vue's v-model doesn't define any here either.                                                                                                                                                                                                        |

Combine freely on text/textarea: `<input v-register.lazy.number="form.register('age')" />`.

When the slim-primitive gate rejects a write produced by a modifier
cast (e.g. `.number` × `'abc'` against a `z.number()` slot — the
non-parseable string passes through `looseToNumber` unchanged), the
directive's listener completes silently and the DOM keeps the user's
input. The form state stays at its previous value. Field-level
validation will surface a refinement error on the next render.

### `canonicalizePath(input) → { segments, key }`

Normalise a dotted-string or array path into a structured `Path`
plus a stable `PathKey`. Use when building custom adapters.

### `parseApiErrors(payload, options) → ParseApiErrorsResult`

Pure transformation: takes a server response in the common shapes
(`{ error: { details } }`, `{ details }`, or a raw `{ path: entry }`
record) and returns `{ ok, errors, rejected? }`. Pair with
`form.setFieldErrors(result.errors)` to apply. The form's setter
surface deliberately doesn't include a `…FromApi` shortcut — keeping
the parse step explicit makes the data flow obvious and the parser
unit-testable in isolation.

**Wire format.** Every entry must be `{ message, code }` (both
required strings). The `code` is forwarded verbatim onto the produced
`ValidationError` so error renderers can branch on it without
matching on the message string. A field's value can be a single
entry or an array (multiple distinct failures at the same path).

```jsonc
{
  "error": {
    "details": {
      "email": { "message": "taken", "code": "api:duplicate-email" },
      "password": [
        { "message": "too short", "code": "api:min-length" },
        { "message": "no digit", "code": "api:digit-required" },
      ],
      "items.0.name": { "message": "blank", "code": "api:blank" },
      "": { "message": "form-level failure", "code": "api:form" },
    },
  },
}
```

```ts
const result = parseApiErrors(response, {
  formKey: form.key,
  // Optional caps for untrusted gateway-passthrough payloads:
  maxEntries: 200, // default 1000
  maxPathDepth: 8, // default 32
})
if (result.ok) form.setFieldErrors(result.errors)
else console.warn('Bad payload:', result.rejected)
```

Legacy string entries (`{ field: 'message string' }`) are rejected
with `ok: false`. Pre-1.0; consumers needing per-call codes adapt
their backend.

See [server-errors recipe](./recipes/server-errors.md) for the full
pattern.

### Error codes

Every `ValidationError` carries a required `code: string` for stable
machine identification. Convention is `<scope>:<kebab-case>`:

| Scope    | Owner              | Examples                                                                          |
| -------- | ------------------ | --------------------------------------------------------------------------------- |
| `cx:`    | Library core       | `cx:no-value-supplied`, `cx:adapter-threw`, `cx:path-not-found`                   |
| `zod:`   | Zod adapter        | `zod:too_small`, `zod:invalid_format`, `zod:custom` (forwarded from `issue.code`) |
| consumer | Your app / backend | `api:duplicate-email`, `auth:expired-token`, `myapp:account-locked`               |

The library exports `CxErrorCode` for branching on internal codes:

```ts
import { CxErrorCode } from '@chemical-x/forms'
// or '@chemical-x/forms/zod' / '@chemical-x/forms/zod-v3'

if (error.code === CxErrorCode.NoValueSupplied) {
  // user opened the form and hasn't filled this field yet
}
if (error.code.startsWith('zod:')) {
  // schema-level validation failure
}
```

`zod:` codes are computed inline (no enum) since Zod's code list
evolves. String-match the prefix to handle "any zod error" generically,
or check exact codes for fine-grained branching.

The library never invents consumer-side codes — they originate in your
backend payload (via `parseApiErrors`) or in `setFieldErrors` /
`addFieldErrors` calls you make directly. Pick a prefix and stay
consistent across your app.

### `unset`

A brand-typed sentinel symbol used to mark a primitive leaf as
**displayed-empty** while storage holds the schema's slim default
(`0` for `z.number()`, `''` for `z.string()`, `false` for
`z.boolean()`, `0n` for `z.bigint()`).

```ts
import { unset, useForm } from '@chemical-x/forms/zod'
import { z } from 'zod'

const form = useForm({
  schema: z.object({ income: z.number() }),
  defaultValues: { income: unset }, // input renders blank, storage = 0
})

// Programmatic clear — same semantic as the user backspacing the field.
form.setValue('income', unset)

// Restore-with-blanks via reset.
form.reset({ income: unset })
```

Three places accept the sentinel:

- **`defaultValues`** — every primitive leaf can be `unset`. The
  library walks the payload at construction and adds the leaf's path
  to the form's transient-empty set.
- **`setValue(path, unset)`** — translated at the API boundary;
  storage gets the slim default with `transientEmpty: true` meta.
- **`reset({ … })`** — same translation; the post-reset state
  becomes the new dirty=false baseline.

**Auto-mark on construction.** A freshly opened form has no user
input yet, so every primitive leaf the consumer didn't supply in
`defaultValues` is auto-marked `pendingEmpty`. This means
`useForm({ schema: z.object({ email: z.string() }) })` (no
`defaultValues`) starts with `email` in the transient-empty set —
its `displayValue` is `''`, and `handleSubmit` raises `"No value supplied"`
until the user types something. To opt a leaf out of auto-mark,
supply a non-`unset` value for it: `defaultValues: { email: '' }`
explicitly tells the library "yes, empty string is intentional."
Auto-mark recurses through nested objects and respects partial
defaults (`{ user: { name: 'a' } }` against `user.{name, age}`
auto-marks `user.age`). It does NOT recurse into arrays — array
elements are runtime-added; opt them in per-element via `unset`.
Hydration overrides: when the form is rehydrated from a persisted
draft or SSR payload, the hydrated `transientEmptyPaths` list is
authoritative and auto-mark does not fire.

**Submit / validate honor the sentinel.** A transient-empty path
bound to a _required_ schema (no `.optional()` / `.nullable()` /
`.default(N)` / `.catch(N)`) raises a synthesized `"No value supplied"`
error during `handleSubmit` / `validate` / `validateAsync`. Use
this when "user didn't answer" must NOT silently submit as `0` /
`''` / `false`. Optional / nullable / has-default schemas accept
the empty case and don't raise.

The directive's input listener auto-marks numeric inputs on empty
DOM (`<input type="number">` or `<input v-register.number>`); for
strings and booleans the dev opts in via `unset` because the DOM
state alone doesn't carry "user-cleared" intent.

Per-path introspection: `form.getFieldState(path).value.pendingEmpty`.
Bulk introspection: `form.transientEmptyPaths.value` returns a
frozen `ReadonlySet<PathKey>` of every marked leaf, suitable for
"unanswered fields" logging or conditional UI.

`isUnset(value)` is the runtime type guard. `Unset` is the
brand-typed `unique symbol` flavor for type-level usage.

### Other exports

- `parseDottedPath(s)` — string → `Segment[]`
- `assignKey` — `unique symbol` used to install a custom assigner on a v-register-bound element
- `isRegisterValue(x)` — type guard for the object `register` returns
- `ROOT_PATH` / `ROOT_PATH_KEY` — the empty path and its key
- `PARSE_API_ERRORS_DEFAULTS` — `{ maxEntries: 1000, maxPathDepth: 32, maxTotalSegments: 10000 }` constant
- `InvalidPathError` / `OutsideSetupError` / `RegistryNotInstalledError` / `ReservedFormKeyError` / `SensitivePersistFieldError` / `SubmitErrorHandlerError` — error classes

---

## `@chemical-x/forms/nuxt`

A Nuxt module that installs the plugin, registers the node
transforms, and auto-imports `useForm`. Add to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['@chemical-x/forms/nuxt'],
})
```

Under Nuxt, `useForm` is globally available — no explicit import
needed.

---

## `@chemical-x/forms/vite`

A Vite plugin that injects the `v-register` node transforms into
`@vitejs/plugin-vue`. Required under bare Vue + Vite for SSR-
correct `v-register` bindings on `<input>`, `<textarea>`, and
`<select>`.

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
import { chemicalXForms } from '@chemical-x/forms/vite'

export default defineConfig({
  plugins: [vue(), chemicalXForms()],
})
```

---

## `@chemical-x/forms/transforms`

The raw Vue compiler-core node transforms. Use this subpath only
when you're rolling your own bundler pipeline (esbuild, Rspack,
custom Rollup).

```ts
import { inputTextAreaNodeTransform, selectNodeTransform } from '@chemical-x/forms/transforms'
```

---

## The useForm return value

`useForm(options)` returns a single object with every reactive
piece of form state as a named field. Grouped by concern:

### Reading values

Reads reflect what's stored in the form. Storage holds slim-primitive-
correct values under the [slim-write contract](#slim-write-contract):
refinement-level constraints (`z.enum([...])`, `.min(N)`, `.email()`,
`z.literal(...)`) are NOT enforced at write time — they surface as
field errors instead. So `getValue` widens primitive-literal leaves to
their primitive supertype (`'red' | 'green' | 'blue'` becomes `string`,
`42` becomes `number`) to match what the store can actually hold.

Array-crossing paths additionally taint with `| undefined`: once a
path crosses a numeric segment (e.g. `'posts.0.title'`), every result
is `T | undefined`. Tuple positions stay strict (their length is
static). Whole-form reads taint every unbounded array's element type
the same way. Narrow with `?.` / optional checks at array-crossing
paths.

For the strict, post-validation shape, route through `handleSubmit` /
`validate*()` — those return the strict zod-inferred type and only
fire after refinements are checked.

| Member                   | Type                                                              | What it does                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getValue()`             | `Readonly<Ref<WithIndexedUndefined<WriteShape<Form>>>>`           | Whole form reactive ref. Primitive-literal leaves widened; array elements tainted `Item \| undefined`.                                                                                                                              |
| `getValue(path)`         | `Readonly<Ref<NestedReadType<WriteShape<Form>, Path>>>`           | Single-field ref. Slim-widened at the leaf; `T \| undefined` once a numeric segment is crossed. Tuple positions stay strict.                                                                                                        |
| `getValue({ withMeta })` | `CurrentValueWithContext<WithIndexedUndefined<WriteShape<Form>>>` | Whole form with meta. Same widening + taint.                                                                                                                                                                                        |
| `getFieldState(path)`    | `Ref<FieldState<NestedReadType<WriteShape<Form>, Path>>>`         | Per-field state at the path. The data slots (`currentValue`, `originalValue`, `previousValue`) carry the widened leaf type; metadata (`errors`, `dirty`, `pristine`, `focused`, `blurred`, `touched`, `isConnected`) is unaffected. |

### Writing values

#### Slim-write contract

Write surfaces (`setValue`, `setValueAtPath`, `defaultValues`,
`reset`, persisted-state rehydration, `v-register` DOM-driven
writes, field-array helpers) accept the slim primitive type at each
path. The runtime gates writes on primitive `typeof`-style checks
(`string`, `number`, `boolean`, `bigint`, `Date`, `null`,
`undefined`, plain object, array, `Map`, `Set`); refinement-level
constraints (`z.enum([...])`, `.email()`, `.min(N)`,
`z.literal(...)`, regex matches) are NOT enforced at write time.
They surface via the field-validation pipeline as entries in
`fieldErrors` and are returned in full from `validate*()` /
`handleSubmit` callbacks.

The TypeScript layer reflects this via `WriteShape<T>` — a
recursive mapped type that widens primitive-literal leaves
(`'red' | 'green' | 'blue'` → `string`, `42` → `number`) while
preserving structure (objects recurse, tuples preserve positions,
unbounded arrays widen elements). Object identity types like `Date`,
`RegExp`, `Map`, `Set`, and functions pass through unchanged.

`setValue` returns `boolean` — `true` on success, `false` when the
slim-primitive gate rejected the write (wrong primitive at the
path). Rejected writes also emit a one-shot dev-mode warning per
`(path, kind)` pair. Field-array helpers (`append` / `prepend` /
`insert` / `remove` / `swap` / `move` / `replace`) return the same
boolean — `false` for both gate rejections and out-of-range index
no-ops.

#### Structural-completeness invariant

After every `setValue`, the form satisfies the slim schema: sparse
array writes auto-pad intermediate indices from the schema's
element default, and partial object writes get sibling keys filled
from the schema. Path-form callback `prev` is
`NonNullable<NestedType<Form, Path>>` — fully defaulted before the
callback fires, so consumer code reads `prev.first.toUpperCase()`
without optional-chaining.

#### Surfaces

| Member                     | Signature                                                                                                                                                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setValue(value)`          | `<V extends SetValuePayload<WriteShape<Form>, WithIndexedUndefined<WriteShape<Form>>>>(value: V) => boolean`                                                         | Replace the whole form. Callback form's `prev` widens via `WriteShape<Form>` (matching what's actually storable) and taints array reads with `\| undefined`. Returns `false` if the slim-primitive gate rejects. Programmatic — does NOT trigger persistence.                                                                                                                                                                                |
| `setValue(path, value)`    | `<P extends FlatPath<Form>, V extends SetValuePayload<WriteShape<NestedType<Form, P>>, NonNullable<WriteShape<NestedType<Form, P>>>>>(path: P, value: V) => boolean` | Replace a single leaf or sub-tree. Callback form's `prev` is `NonNullable<WriteShape<NestedType<Form, P>>>` — runtime auto-defaults missing slots before the callback fires. Returns `false` on slim-primitive rejection. Programmatic — does NOT trigger persistence.                                                                                                                                                                       |
| `register(path, options?)` | `(path: P, options?: RegisterOptions) => RegisterValue<NestedReadType<WriteShape<Form>, P>>`                                                                         | Produces the binding the `v-register` directive consumes. `innerRef`'s read type widens via `WriteShape<Form>` (matches what's storable) and carries `\| undefined` at array-crossing paths; the directive renders `undefined` as empty correctly. `options.persist: true` opts the field into persistence; `options.acknowledgeSensitive: true` overrides the sensitive-name heuristic. See [persistence recipe](./recipes/persistence.md). |

### Validation + submission

| Member                     | Signature                                                  | What it does                                                                          |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `validate(path?)`          | `(path?) => Readonly<Ref<ReactiveValidationStatus<Form>>>` | Reactive validation result. Re-runs on form mutation; value carries a `pending` flag. |
| `validateAsync(path?)`     | `(path?) => Promise<ValidationResponseWithoutValue<Form>>` | Imperative one-shot. Resolves to the settled response.                                |
| `handleSubmit(cb, onErr?)` | `(cb, onErr?) => (event?) => Promise<void>`                | Builds a submit handler. Awaits validation internally.                                |

`ReactiveValidationStatus<Form>` is a discriminated union on
`pending` — narrow on `status.pending` before trusting `success` /
`errors`. See [async-validation recipe](./recipes/async-validation.md).

### Error store

Errors are stored source-segregated under the hood — `schemaErrors`
(written by the validation pipeline) and `userErrors` (written by the
APIs below). The public surfaces below merge both transparently
(schema-first, user-second). User-injected errors **survive** schema
revalidation and successful submits — the consumer owns their lifecycle
explicitly. See the [migration guide](./migration/0.11-to-0.12.md) for
the rationale.

| Member                    | Type                                                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fieldErrors`             | `Readonly<FormFieldErrors<Form>>` — Proxy view; dot-access leaves directly, no `.value`. Merges schema + user; schema entries first.                                                                                                   |
| `setFieldErrors(errors)`  | `(ValidationError[]) => void` — replaces the user-error store. For server / API responses, parse the payload via `parseApiErrors` (top-level helper) and feed the result here. See [server-errors recipe](./recipes/server-errors.md). |
| `addFieldErrors(errors)`  | `(ValidationError[]) => void` — appends to the user-error store.                                                                                                                                                                       |
| `clearFieldErrors(path?)` | `(path?) => void` — clears BOTH stores at the given path (or all paths if omitted). With live validation, the schema half re-populates on the next mutation if the value is still invalid.                                             |

### Form-level state

The 9 form-level flags and counters live on a single `state` object
(`reactive()` + `readonly()`). Vue's reactive auto-unwraps refs at
property access, so `form.state.isSubmitting` is a primitive in
both templates and scripts — no `.value`. The full type is the
exported `FormState` interface.

| Member               | Type      | What it does                                                                        |
| -------------------- | --------- | ----------------------------------------------------------------------------------- |
| `state.isDirty`      | `boolean` | `true` iff any leaf's current value differs from its original.                      |
| `state.isValid`      | `boolean` | `true` iff both the schema-error and user-error stores are empty.                   |
| `state.isSubmitting` | `boolean` | `true` while the submit handler is running.                                         |
| `state.isValidating` | `boolean` | `true` while any validation run is in flight (reactive, imperative, or pre-submit). |
| `state.submitCount`  | `number`  | Incremented once per call, regardless of outcome.                                   |
| `state.submitError`  | `unknown` | Whatever the callback threw; `null` on success. Cleared on every new submission.    |
| `state.canUndo`      | `boolean` | Gate an "Undo" button on this. Always present; `false` when `history` is off.       |
| `state.canRedo`      | `boolean` | Gate a "Redo" button on this. Always present; `false` when `history` is off.        |
| `state.historySize`  | `number`  | Total snapshots across both stacks. `0` when `history` is off.                      |

`state` is read-only — `state.x = y` writes are rejected at runtime
with a dev-mode warning (use `setValue` / `handleSubmit` /
`reset` to mutate the form). Watchers use the getter form:
`watch(() => form.state.isSubmitting, …)`.

### Focus + scroll

| Member                         | Signature               | What it does                                                                                                  |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `focusFirstError(options?)`    | `(options?) => boolean` | Focuses the first errored field's first connected, visible element. Returns `true` if an element was focused. |
| `scrollToFirstError(options?)` | `(options?) => boolean` | Scrolls that element into view. Returns `true` on success.                                                    |

### Reset

| Member             | Signature                                                | What it does                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reset(next?)`     | `(next?: DeepPartial<DefaultValuesShape<Form>>) => void` | Re-seed the whole form. Rebuilds originals, clears errors + touched + submit state. Wipes the persisted draft if `persist:` is configured. Each leaf in `next` may be `unset` to mark the path displayed-empty post-reset. |
| `resetField(path)` | `(path: FlatPath<Form>) => void`                         | Restore one path (leaf or container) to its original value. Wipes the matching subpath from storage if `persist:` is configured.                                                                                           |

### Persistence (imperative)

| Member                       | Signature                                                                               | What it does                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `persist(path, options?)`    | `(path: FlatPath<Form>, options?: { acknowledgeSensitive?: boolean }) => Promise<void>` | One-shot read-merge-write of `path`'s current value. Bypasses the per-element opt-in gate and the debouncer. Throws `SensitivePersistFieldError` on sensitive paths unless acknowledged. Silent no-op when `persist:` isn't configured. |
| `clearPersistedDraft(path?)` | `(path?: FlatPath<Form>) => Promise<void>`                                              | Wipe the persisted entry. With `path`, removes only that subpath. Does NOT touch in-memory state or active opt-ins. Silent no-op when `persist:` isn't configured.                                                                      |

See [persistence recipe](./recipes/persistence.md) for the per-field
opt-in model these APIs sit on top of.

### Undo / redo

| Member   | Type            | What it does                         |
| -------- | --------------- | ------------------------------------ |
| `undo()` | `() => boolean` | Revert to the previous snapshot.     |
| `redo()` | `() => boolean` | Replay a previously-undone snapshot. |

`undo()` and `redo()` are top-level methods. The matching flags
(`state.canUndo`, `state.canRedo`, `state.historySize`) live on the
`state` bundle above. Inert stubs when `history` isn't
configured — consistent API shape, zero overhead.

### Field arrays (typed)

All seven helpers return `boolean` — `true` on a successful write,
`false` when the slim-primitive gate rejects the value or the
operation is a no-op (out-of-range index on `remove` / `swap` /
`move` / `replace`). Element types widen via
`WriteShape<ArrayItem<...>>` to match what the store can hold.

| Member                        | Returns   | Notes                                                                  |
| ----------------------------- | --------- | ---------------------------------------------------------------------- |
| `append(path, value)`         | `boolean` | Path narrowed to `ArrayPath<Form>`; value widened via `WriteShape<…>`. |
| `prepend(path, value)`        | `boolean` | Same typing as `append`.                                               |
| `insert(path, index, value)`  | `boolean` | Same typing as `append`; index numeric.                                |
| `remove(path, index)`         | `boolean` | Numeric index. `false` on out-of-range.                                |
| `swap(path, a, b)`            | `boolean` | Two numeric indices. `false` on out-of-range.                          |
| `move(path, from, to)`        | `boolean` | Two numeric indices. `to` clamped to `[0, length]`.                    |
| `replace(path, index, value)` | `boolean` | Never grows the array; `false` on out-of-range.                        |

See [dynamic-field-arrays recipe](./recipes/dynamic-field-arrays.md)
for the `v-for` pattern.

### Transient-empty introspection

| Member                                   | Type                  | What it does                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `transientEmptyPaths.value`              | `ReadonlySet<string>` | Frozen snapshot of every path-key currently in the form's transient-empty set. Reactive — Vue tracks `.has()` / `.size` / iteration. Mutating the snapshot is a no-op (writes go through `setValue(_, unset)`, the directive's input listener, or `markTransientEmpty()` on a register binding). See `unset` exported from the core entry. |
| `getFieldState(path).value.pendingEmpty` | `boolean`             | Per-path equivalent: `true` while `path` is in the transient-empty set.                                                                                                                                                                                                                                                                    |

### Identity

| Member | Type      | What it does                              |
| ------ | --------- | ----------------------------------------- |
| `key`  | `FormKey` | The form's key (echoes the `key` option). |

---

## Types

All types listed below are exported from the core entry:

```ts
import type {
  AbstractSchema,
  ApiErrorDetails,
  ApiErrorEnvelope,
  ArrayItem,
  ArrayPath,
  CurrentValueContext,
  CurrentValueWithContext,
  CustomDirectiveRegisterAssignerFn,
  DeepPartial,
  DefaultValuesResponse,
  DefaultValuesShape,
  FieldState,
  FieldValidationConfig,
  FieldValidationMode,
  FlatPath,
  FormErrorRecord,
  FormKey,
  FormStorage,
  FormStorageKind,
  GenericForm,
  HandleSubmit,
  HistoryConfig,
  IsTuple,
  MetaTrackerValue,
  NestedReadType,
  NestedType,
  OnError,
  OnInvalidSubmitPolicy,
  OnSubmit,
  ParseApiErrorsOptions,
  ParseApiErrorsResult,
  PendingValidationStatus,
  PersistConfig,
  PersistConfigOptions,
  PersistIncludeMode,
  ReactiveValidationStatus,
  RegisterDirective,
  RegisterFlatPath,
  RegisterValue,
  SetValueCallback,
  SetValuePayload,
  SettledValidationStatus,
  SlimPrimitiveKind,
  SubmitHandler,
  Unset,
  UseAbstractFormReturnType,
  UseFormConfiguration,
  ValidationError,
  ValidationMode,
  ValidationResponse,
  ValidationResponseWithoutValue,
  WithIndexedUndefined,
  WriteShape,
} from '@chemical-x/forms'
```

The ones you'll touch most:

- **`FlatPath<Form>`** — union of every addressable path for the
  form. Dotted strings.
- **`NestedType<Form, Path>`** — the strict leaf type at `Path`.
  Used for write-side APIs (`setValue` value argument) and for
  the path-form callback's `prev` (the runtime auto-defaults the
  slot before invoking the callback).
- **`NestedReadType<Form, Path>`** — the read-side leaf type. Walks
  the path tracking whether a numeric segment was crossed; once
  tainted, all subsequent results are `T | undefined`. Tuple
  positions stay strict. Composed with `WriteShape<...>` (see
  below) at the call site for `getValue`, `getFieldState`, and
  `register`.
- **`WriteShape<T>`** — recursive mapped type that widens primitive-
  literal leaves to their primitive supertype. `'red' | 'green'` →
  `string`; `42` → `number`; nested objects recurse; tuples
  preserve positions; unbounded arrays widen elements; `Date`,
  `RegExp`, `Map`, `Set`, and functions pass through unchanged.
  Applied to read surfaces that observe storage (`getValue`,
  `getFieldState.currentValue`, `register.innerRef`). NOT applied
  to `handleSubmit` or `validate*()` payloads — those run after
  validation, so the strict zod-inferred shape is honest there.
- **`DefaultValuesShape<T>`** — `WriteShape<T>` plus the `unset`
  sentinel admitted at every primitive leaf (`string`, `number`,
  `boolean`, `bigint`). Applied to the write surfaces that accept
  intent (`defaultValues`, `setValue`'s value, `reset`'s argument,
  field-array helpers). Non-primitive leaves (`Date`, `RegExp`,
  etc.) stay strict — `defaultValues: { joinedAt: unset }` against
  `z.date()` is a type error.
- **`Unset`** — the brand-typed `unique symbol` flavor of the
  `unset` sentinel for type-level usage. The runtime symbol is
  exported alongside under the same name from `@chemical-x/forms`.
- **`WithIndexedUndefined<T>`** — recursive transform that taints
  every unbounded array's element type with `| undefined`. Tuples,
  `Date`, `RegExp`, `Map`, `Set`, and functions pass through
  untouched. Whole-form reads use this shape.
- **`IsTuple<T>`** — `true` for tuples (literal `length`), `false`
  for unbounded arrays (`length: number`). Used internally by
  `WithIndexedUndefined` and `NestedReadType` to decide whether to
  taint.
- **`SetValuePayload<Write, Read = Write>`** — union of `Write` and
  `SetValueCallback<Read>`. The whole-form `setValue`
  parameterises `Read` to `WithIndexedUndefined<Form>`; the path-
  form parameterises `Read` to `NonNullable<NestedType<F, P>>`.
- **`SetValueCallback<Read>`** — `(prev: Read) => Read`. The
  callback's return shape matches its input shape; runtime
  mergeStructural completes any structural gaps.
- **`ArrayPath<Form>`** — `FlatPath<Form>` filtered to array-leaf
  paths. Used by `append` / `remove` / etc.
- **`ArrayItem<Form, Path>`** — the element type of the array at
  `Path`.
- **`ValidationError`** — `{ path: readonly Segment[]; message:
string; formKey: FormKey }`.
- **`FieldState<Value = unknown>`** — per-field reactive state at a
  path: `currentValue` / `originalValue` / `previousValue` (typed
  `Value`), `pristine` / `dirty` (booleans), `focused` / `blurred` /
  `touched` (`boolean | null`), `errors` (`ValidationError[]`),
  `meta` (`MetaTrackerValue`), and `isConnected` / `updatedAt`.
  Defaults to `unknown` for legacy uses; `getFieldState(path)`
  resolves `Value` to `WriteShape<NestedReadType<Form, Path>>`.
- **`ValidationMode`** — `'lax' | 'strict'`. Defaults to `'strict'` —
  the data layer reports schema errors immediately when defaults fail.
  Use `'lax'` to opt out (multi-step wizards, placeholder rows in field
  arrays, any case where mounting with invalid data is expected).
- **`AbstractSchema`** — the schema contract (6 methods:
  `fingerprint`, `getDefaultValues`, `getDefaultAtPath`,
  `getSchemasAtPath`, `validateAtPath`, `getSlimPrimitiveTypesAtPath`).
  See [custom-adapter recipe](./recipes/custom-adapter.md).
- **`SlimPrimitiveKind`** — the set of primitive `typeof`-style
  kinds the slim-write contract recognises: `'string'`, `'number'`,
  `'boolean'`, `'bigint'`, `'date'`, `'null'`, `'undefined'`,
  `'object'`, `'array'`, `'symbol'`, `'function'`, `'map'`, `'set'`.
  Returned by `AbstractSchema.getSlimPrimitiveTypesAtPath(path)`.
- **`MetaTrackerValue`** — per-leaf metadata: `updatedAt`,
  `rawValue`, `isConnected`, `formKey`, `path`. Surfaced via
  `getFieldState(path).meta` and the `withMeta: true` overloads of
  `getValue`.
- **`CurrentValueContext` / `CurrentValueWithContext`** — argument
  and return types for the metadata overloads of `getValue`.
- **`RegisterDirective`** — the union of every `v-register`
  directive variant (text input, select, checkbox, radio, dynamic).
  Most consumers use this only when augmenting Vue's `GlobalDirectives`
  manually; the Nuxt module wires it automatically.
- **`CustomDirectiveRegisterAssignerFn`** — function shape for
  custom assigners installed via the exported `assignKey` symbol.
- **`RegisterFlatPath<Form>`** — the path-constraint type used by
  `register(path)`. Consumers wrapping `register` in higher-order
  helpers can re-use it to type their wrapper's path parameter.
- **`FormStorage`** — the storage contract (4 methods: `getItem`,
  `setItem`, `removeItem`, `listKeys`). See
  [persistence recipe](./recipes/persistence.md).
