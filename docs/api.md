# API reference

Every public export of `decant`, grouped by subpath. Each
entry gives the signature, the shape of the return value, and the
minimal example you need to wire it up.

## Contents

- [`decant/zod`](#decantformszod) — recommended entry
- [`decant/zod-v3`](#decantformszod-v3) — legacy
- [`decant`](#decantforms) — framework-agnostic core
- [`decant/nuxt`](#decantformsnuxt) — Nuxt module
- [`decant/vite`](#decantformsvite) — Vite plugin
- [`decant/transforms`](#decantformstransforms) — raw transforms
- [The useForm return value](#the-useform-return-value)
- [Types](#types)

---

## `decant/zod`

Zod v4 adapter. Requires `zod@^4`.

```ts
import { useForm, zodAdapter, kindOf, assertZodVersion } from 'decant/zod'
```

### `useForm<Schema>(options)`

The primary entry point. Returns a typed reactive surface; see
[The useForm return value](#the-useform-return-value).

```ts
const schema = z.object({ email: z.email() })
const form = useForm({ schema, key: 'signup' })
```

Options:

| Field              | Type                                                                                                | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema`           | `z.ZodType`                                                                                         | yes      | The Zod schema describing the form shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `key`              | `string`                                                                                            | no       | Form identity. Omit for one-off forms (runtime allocates a synthetic `__cx:anon:<id>` via `useId()`). Pass a string when you need cross-component lookup via `injectForm(key)`, shared state across call-sites, a stable `persist` storage-key default, or a recognisable DevTools label. Keys starting with `__cx:` are reserved for the library's internal synthetic-key namespace; passing one throws `ReservedFormKeyError`.                                                                                                                                                                                                                                                                                                           |
| `defaultValues`    | `DeepPartial<DefaultValuesShape<Form>>`                                                             | no       | Constraints applied over schema defaults. Refinement-invalid leaves that satisfy the slim primitive type at their path (e.g. `'teal'` against `z.enum(['red','green','blue'])`, a 4-character string against `z.string().min(8)`) pass through unchanged so SSR / autosave rehydration can land partial-but-saved state as-is. Wrong-primitive leaves (a number where a string is expected) are still replaced by the schema default. Each primitive leaf may be the `unset` sentinel to mark the path displayed-empty at construction.                                                                                                                                                                                                    |
| `strict`           | `boolean`                                                                                           | no       | Defaults to `true` — defaults that fail the schema seed `schemaErrors` at construction. Pass `false` to opt out (multi-step wizards, placeholder rows).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `onInvalidSubmit`  | `'none'` \| `'focus-first-error'` \| `'scroll-to-first-error'` \| `'both'`                          | no       | What to do when submit fails validation. See [recipe](./recipes/focus-on-error.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `validateOn`       | `'change'` \| `'blur'` \| `'submit'`                                                                | no       | When per-field validation runs. Default `'change'` (every committed write). `'blur'` fires on focus-out; `'submit'` opts out of live validation entirely (submit is the only validator). See [recipe](./recipes/field-level-validation.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `debounceMs`       | `number`                                                                                            | no       | Milliseconds to wait after the last committed write before re-running validation. Default `0` (synchronous; no `setTimeout`). Only valid with `validateOn: 'change'` — TS enforces via `ValidateOnConfig`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `coerce`           | `boolean` \| `CoercionRegistry`                                                                     | no       | Schema-driven coercion of user-typed DOM values at the directive layer. Default `true` (built-in `string→number`, `string→boolean`). Pass `false` to disable, or a custom `CoercionRegistry` to replace. See [recipe](./recipes/coerce.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `rememberVariants` | `boolean`                                                                                           | no       | Whether to remember each discriminated-union variant's typed state across switches. Default `true` — switching back to a previous variant restores its prior subtree. Set `false` to drop the outgoing variant. See [recipe](./recipes/discriminated-unions.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `persist`          | `FormStorageKind \| FormStorage \| { storage, key?, debounceMs?, include?, clearOnSubmitSuccess? }` | no       | Operational config for the persistence pipeline. Three input forms: a string shorthand (`'local'` / `'session'` / `'indexeddb'`), a custom `FormStorage` adapter passed directly, or the full options bag. Per-field opt-in lives at every `register('foo', { persist: true })` call site — this config alone never causes any field to persist. Storage keys carry the schema's fingerprint (`${base}:${fingerprint}`) so schema changes auto-invalidate old drafts; the orphan-cleanup pass on mount sweeps stale-fingerprint entries on the configured backend AND wipes any matching keys on the non-configured standard backends (cross-store cleanup). Malformed payloads are wiped on read. See [recipe](./recipes/persistence.md). |
| `history`          | `true` \| `{ max?: number }`                                                                        | no       | Enable undo/redo. See [recipe](./recipes/undo-redo.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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

## `decant/zod-v3`

Zod v3 adapter. Requires `zod@^3`. New projects should use `/zod`
(v4).

```ts
import { useForm, zodAdapter, isZodSchemaType } from 'decant/zod-v3'
```

Same surface as `/zod` for the functions that apply. Helper types
for v3 introspection (`UnwrapZodObject`, `ZodTypeWithInnerType`,
…) are also exported.

---

## `decant`

The framework-agnostic core. Use this if you're bringing your own
schema library or wiring SSR by hand.

```ts
import {
  createDecant,
  useForm, // re-export of useAbstractForm
  injectForm,
  useRegistry,
  renderDecantState,
  hydrateDecantState,
  escapeForInlineScript,
  vRegister,
  canonicalizePath,
  parseApiErrors,
} from 'decant'
```

### `createDecant(options?)`

The Vue plugin. Install once per app.

```ts
createApp(App).use(createDecant()).mount('#app')
```

Options:

| Field      | Type             | Description                                                                                         |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `override` | `boolean`        | Force `isSSR` to `true` / `false`. Auto-detected otherwise.                                         |
| `devtools` | `boolean`        | Enable the Vue DevTools plugin. Default `true`. See [recipe](./recipes/devtools.md).                |
| `defaults` | `DecantDefaults` | App-level option defaults applied to every `useForm` call. See [recipe](./recipes/app-defaults.md). |

### `useForm<Form>({ schema, key, ... })`

Schema-agnostic. Takes any `AbstractSchema<Form, Form>` — wrap a
Valibot schema, ArkType schema, or a hand-rolled validator with
[a custom adapter](./recipes/custom-adapter.md). The Zod subpaths
are pre-made wrappers over this.

### `injectForm<Form>(key?)`

Reach the nearest ancestor's form (no key) or reach any form by its
key. Type-identical return to `useForm`. See
[recipe](./recipes/form-context.md).

**Resolution rules** (no-key form):

- Closest ambient ancestor wins.
- Only anonymous `useForm()` (no `key`) fills the ambient slot;
  keyed forms are reachable only via `injectForm(key)`.
- No ambient ancestor → returns `null` (dev-mode warn).
- Inherits the resolved ancestor's `formInstanceId`.

**Resolution rules** (keyed form): registry lookup by string key,
independent of component-tree position.

### `useRegistry()`

Returns the current app's `DecantRegistry`. Must be called inside
a component's `setup()`.

### `renderDecantState(app) → SerializedDecantState`

Server-side: serialize every form in the app to a plain object safe
for `JSON.stringify`. Pair with `hydrateDecantState` on the
client.

### `hydrateDecantState(app, payload)`

Client-side: rehydrate forms from the serialized payload. Call
before `app.mount(...)`.

### `escapeForInlineScript(json) → string`

Takes a JSON string and escapes the characters that would let a
form value break out of an inline `<script>` tag: `<`, `>`, `&`,
U+2028, U+2029. Pair with `renderDecantState` when hand-rolling
SSR; Nuxt handles it for you via `devalue`.

```ts
const payload = escapeForInlineScript(JSON.stringify(renderDecantState(app)))
// `<script>window.__STATE__ = ${payload}</script>` is safe to inline.
```

### `vRegister`

The `v-register` directive. Registered automatically by
`createDecant`; exported for consumers installing directives
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
  import { useRegister } from 'decant'
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

#### Custom assigners — `@update:registerValue`

The directive's default behavior is "DOM event → extract value →
`rv.setValueWithInternalPath(value)`". `@update:registerValue`
**replaces that bridge step**: your handler receives the
already-extracted value plus the `RegisterValue`, and decides what
(if anything) reaches form state.

```vue
<script setup lang="ts">
  import type { RegisterValue } from 'decant'

  const form = useForm({ schema, defaultValues: { username: '' } })

  function uppercaseAssigner(value: unknown, rv: RegisterValue): void {
    rv.setValueWithInternalPath(String(value ?? '').toUpperCase())
  }
</script>

<template>
  <input v-register="form.register('username')" @update:registerValue="uppercaseAssigner" />
</template>
```

The value you receive is **post-extraction** — `.number` modifier
means you get a number, `.trim` means you get the trimmed string,
`<input type="checkbox">` gives you the boolean. You're operating on
the same value the default assigner would have written.

Four common patterns:

- **Transform** — call `rv.setValueWithInternalPath(transformed)`
  with a normalised / masked / cast value (uppercase, slug,
  currency-format, prefix-strip).
- **Reject** — skip the call; the keystroke never reaches form
  state. Distinct from validation errors (which accept the write
  and flag it); this drops the write entirely.
- **Side-effect + default** — log / analytics / undo-stack push,
  then `rv.setValueWithInternalPath(value)` to keep normal flow.
- **Redirect** — write to a different field, multiple fields, or
  an external store; the form path itself stays unchanged.

Use `@update:registerValue` on supported roots only (`<input>`,
`<select>`, `<textarea>`). On a non-form root the directive's
listener never fires — see `useRegister()` (recommended) or
`assignKey` (Web Components) for those.

The handler signature is
`(value: unknown, registerValue: RegisterValue) => boolean | undefined`.
Return `false` to flag a rejected write to the directive's listener
(used internally by `<select>` / `.number` bindings to gate
post-write side effects); `undefined` / `void` is treated as
success.

Because the second arg is provided by the directive, the handler
can be a **top-level function** outside `setup()` — no need to
capture `rv` via closure. Multiple `@update:registerValue` listeners
on the same element all receive `(value, rv)` in registration
order; none of them is the "default" — the default assigner is
replaced wholesale once any consumer attaches.

#### Transforms — `register(path, { transforms: [...] })`

For **normalizing user input through a pipeline of pure functions**,
prefer `transforms` over `@update:registerValue`. The transforms
array is composed left-to-right, runs entirely inside the
directive's assigner, and applies uniformly across every
`v-register` element variant (`<input>`, `<select>`, `<textarea>`,
`<input type="checkbox">`, `<input type="radio">`).

```ts
import type { RegisterTransform } from 'decant'

const trim: RegisterTransform = (v) => (typeof v === 'string' ? v.trim() : v)

const lowercase: RegisterTransform = (v) => (typeof v === 'string' ? v.toLowerCase() : v)

// In setup
const rv = form.register('email', { transforms: [trim, lowercase] })
```

```vue
<input v-register="rv" />
<!-- type "  Foo@BAR.com  ", form receives "foo@bar.com" -->
```

`RegisterTransform` is `(value: unknown) => unknown`. The shape is
intentionally generic-erased so a personal library of transforms
plugs into any `register()` slot regardless of the path's value
type — write defensive bodies that no-op on type mismatch and the
same `trim` works for every string path. Type-safety at the call
site is delegated to cx's slim-primitive gate at write time.

**Pipeline ordering.** Transforms run AFTER directive modifier
extraction (`.lazy` switches the listener from `input` to `change`;
`.trim` and `.number` cast the DOM-extracted value), BEFORE the
field's assigner writes to form state:

```
DOM event → modifier cast → transforms[0] → … → transforms[n] → assigner
```

Combine freely: `<input v-register.lazy.number="register('age', { transforms: [clamp(0, 99)] })">`
casts to a number on blur, clamps, then writes.

**What transforms DON'T apply to.** This is deliberately narrow —
transforms are user-input normalization, not storage middleware:

- `form.setValue(...)` and `rv.setValueWithInternalPath(...)` —
  programmatic writes. Compose transforms yourself at the call
  site if you want the same normalization:
  `form.setValue('email', lowercase(trim(rawValue)))`.
- `form.reset()` / hydration / SSR replay — those write canonical
  state that's already been validated; running normalization over
  it would be redundant or destructive.
- `markBlank()` — already writes the slim default.

**`@update:registerValue` override compose with transforms.** The
override receives the **post-transform** value as its first arg.
A consumer who declared transforms intended "always normalize"; a
silent bypass when an override is attached would be the surprise.
If you want the raw extracted value, don't register transforms.

**Failure mode.** Transforms must be sync. cx wraps each transform
call in try/catch; on throw OR Promise return:

- The pipeline aborts (subsequent transforms don't run).
- Form state is NOT updated; the assigner returns `false`.
- The DOM's `:value` reactive binding round-trips form state back,
  snapping the input to the prior value (same UX as the
  documented "rejection" pattern).
- A `console.error` is logged. In dev (`process.env.NODE_ENV !==
'production'`) the message includes the path, transform index,
  transform `.name` (when set), the original error, and a
  remediation hint. In prod the message is a single fixed string
  with NONE of those — transform bodies can construct error
  messages from user-typed values, throw with sensitive stack
  frames, or originate inside deeply-nested call chains we don't
  control. Set `NODE_ENV=development` to surface details when
  debugging.

A throw on one keystroke doesn't poison subsequent keystrokes (the
next event runs the pipeline fresh) and doesn't affect other
fields' assigners (each field has its own `RegisterValue` and
its own pipeline).

**When to reach for `@update:registerValue` instead.** Three patterns
where the override pulls weight that `transforms` doesn't:

- **Rejection with side effect.** The override receives the
  `RegisterValue`; you can inspect it, log to telemetry, then
  conditionally call `rv.setValueWithInternalPath` or skip.
- **Redirection.** Write to a different field, multiple fields, or
  an external store using the form API.
- **Custom DOM mutation.** The override has access to the event
  flow; you can synchronously rewrite `event.target.value` if your
  use case can't rely on the `:value` round-trip.

Transforms cover normalization. The override covers control.

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

**Wire format.** Two entry shapes are accepted:

- **Structured** — `{ message: string, code: string }`. The `code`
  forwards verbatim onto the produced `ValidationError` so error
  renderers can branch on it without matching the message string.
- **Bare string** — a plain string. The Rails / Django REST Framework
  / FastAPI / Laravel default JSON shape (`{ field: ["msg"] }`).
  Synthesized into `{ message: <string>, code: <defaultCode> }` at
  parse time; `defaultCode` defaults to `'api:unknown'` and is
  configurable via the options bag.

A field's value can be a single entry, an array, or a mix of
structured and bare-string entries (multiple distinct failures at the
same path).

```jsonc
{
  "error": {
    "details": {
      "email": { "message": "taken", "code": "api:duplicate-email" },
      "password": [{ "message": "too short", "code": "api:min-length" }, "must include a number"],
      "username": ["Username is reserved."],
      "items.0.name": { "message": "blank", "code": "api:blank" },
      "": { "message": "form-level failure", "code": "api:form" },
    },
  },
}
```

```ts
const result = parseApiErrors(response, {
  formKey: form.key,
  // Stamp every bare-string entry with a custom code (default 'api:unknown'):
  defaultCode: 'api:server-validation',
  // Optional caps for untrusted gateway-passthrough payloads:
  maxEntries: 200, // default 1000
  maxPathDepth: 8, // default 32
})
if (result.ok) form.setFieldErrors(result.errors)
else console.warn('Bad payload:', result.rejected)
```

Half-structured entries (`{ message }` with no `code`, or `{ code }`
with no `message`) are still rejected — those signal a server bug
(the wire shape was _trying_ to be structured) and shouldn't be
silently coerced.

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
import { CxErrorCode } from 'decant'
// or 'decant/zod' / 'decant/zod-v3'

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
import { unset, useForm } from 'decant/zod'
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
  to the form's `blankPaths` set.
- **`setValue(path, unset)`** — translated at the API boundary;
  storage gets the slim default with `blank: true` meta.
- **`reset({ … })`** — same translation; the post-reset state
  becomes the new dirty=false baseline.

**Auto-mark on construction.** A freshly opened form has no user
input yet, so every primitive leaf the consumer didn't supply in
`defaultValues` is auto-marked `blank`. This means
`useForm({ schema: z.object({ email: z.string() }) })` (no
`defaultValues`) starts with `email` in the form's `blankPaths` set —
its `displayValue` is `''`, and `handleSubmit` raises `"No value supplied"`
until the user types something. To opt a leaf out of auto-mark,
supply a non-`unset` value for it: `defaultValues: { email: '' }`
explicitly tells the library "yes, empty string is intentional."
Auto-mark recurses through nested objects and respects partial
defaults (`{ user: { name: 'a' } }` against `user.{name, age}`
auto-marks `user.age`). It does NOT recurse into arrays — array
elements are runtime-added; opt them in per-element via `unset`.
Hydration overrides: when the form is rehydrated from a persisted
draft or SSR payload, the hydrated `blankPaths` list is
authoritative and auto-mark does not fire.

**Submit / validate honor the sentinel.** A blank path bound to a
_required_ schema (no `.optional()` / `.nullable()` / `.default(N)` /
`.catch(N)`) raises a synthesized `"No value supplied"` error during
`handleSubmit` / `validate` / `validateAsync`. Use this when "user
didn't answer" must NOT silently submit as `0` / `''` / `false`.
Optional / nullable / has-default schemas accept the empty case and
don't raise.

The directive's input listener auto-marks numeric inputs on empty
DOM (`<input type="number">` or `<input v-register.number>`); for
strings and booleans the dev opts in via `unset` because the DOM
state alone doesn't carry "user-cleared" intent.

Per-path introspection: `form.fields.<path>.blank`. Bulk
introspection: `form.blankPaths.value` returns a frozen
`ReadonlySet<PathKey>` of every marked leaf, suitable for
"unanswered fields" logging or conditional UI.

`isUnset(value)` is the runtime type guard. `Unset` is the
brand-typed `unique symbol` flavor for type-level usage.

### Other exports

- `parseDottedPath(s)` — string → `Segment[]`
- `assignKey` — `unique symbol` used to install a custom assigner on a v-register-bound element. For most cases prefer the `@update:registerValue` listener (see [Custom assigners](#custom-assigners--updateregistervalue)); reach for `assignKey` only when you need pre-mount installation (typically Web Components).
- `isRegisterValue(x)` — type guard for the object `register` returns
- `RegisterTransform` — `(value: unknown) => unknown` — type alias for entries in `register(path, { transforms: [...] })`. Generic-erased so a personal library of transforms works across any path type; see [Transforms](#transforms--registerpath--transforms-).
- `ROOT_PATH` / `ROOT_PATH_KEY` — the empty path and its key
- `PARSE_API_ERRORS_DEFAULTS` — `{ maxEntries: 1000, maxPathDepth: 32, maxTotalSegments: 10000 }` constant
- `AnonPersistError` / `InvalidPathError` / `OutsideSetupError` / `RegistryNotInstalledError` / `ReservedFormKeyError` / `SensitivePersistFieldError` / `SubmitErrorHandlerError` — error classes

---

## `decant/nuxt`

A Nuxt module that installs the plugin, registers the node
transforms, and auto-imports `useForm`. Add to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['decant/nuxt'],
})
```

Under Nuxt, `useForm` is globally available — no explicit import
needed.

---

## `decant/vite`

A Vite plugin that injects the `v-register` node transforms into
`@vitejs/plugin-vue`. Required under bare Vue + Vite for SSR-
correct `v-register` bindings on `<input>`, `<textarea>`, and
`<select>`.

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
import { decant } from 'decant/vite'

export default defineConfig({
  plugins: [vue(), decant()],
})
```

---

## `decant/transforms`

The raw Vue compiler-core node transforms. Use this subpath only
when you're rolling your own bundler pipeline (esbuild, Rspack,
custom Rollup).

```ts
import { inputTextAreaNodeTransform, selectNodeTransform } from 'decant/transforms'
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
field errors instead. So read types widen primitive-literal leaves
to their primitive supertype (`'red' | 'green' | 'blue'` becomes
`string`, `42` becomes `number`) to match what the store can
actually hold.

Array-crossing paths additionally taint with `| undefined`: once a
path crosses a numeric segment (e.g. `'posts.0.title'`), every result
is `T | undefined`. Tuple positions stay strict (their length is
static). Whole-form reads taint every unbounded array's element type
the same way. Narrow with `?.` / optional checks at array-crossing
paths.

For the strict, post-validation shape, route through `handleSubmit` /
`validate*()` — those return the strict zod-inferred type and only
fire after refinements are checked.

Reads are Pinia-style proxies — dot-access leaves directly with no
`.value`, in templates and scripts identically.

All three drillable surfaces (`values`, `errors`, `fields`) are
**leaf-aware callable Proxies**. Drill via dot/bracket OR call
dynamically — `form.fields.email.dirty` ≡ `form.fields('email').dirty`
≡ `form.fields(['email']).dirty`. Single-bracket dotted access
(`form.errors['user.email']`) is intentionally NOT supported (JS
treats the dotted string as a single key). Use chained dot/bracket
or the callable form.

| Member        | Type                                                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `values`      | `ValuesSurface<WriteShape<Form>>`                              | Whole-form reactive read. `form.values.email`, `form.values.address.city`, `form.values.posts[0]?.title`. Containers ARE useful — `form.values.address` returns the subtree object AND keeps drilling. Array element types are strict (`tags: string[]`); the safety on `arr[N]` reads relies on the consumer's `noUncheckedIndexedAccess: true` tsconfig flag, which TypeScript correctly suppresses on iteration so `v-for` / `for-of` keep `T`. Auto-unwraps in templates and scripts. `form.values('a.b.c')` and `form.values()` available for dynamic / programmatic access. |
| `fields`      | `FieldStateMap<Form>`                                          | Reactive per-field state map. Drill any path; reserved leaf props (`value`, `dirty`, `errors`, `blank`, `isConnected`, …) inject ONLY at LEAF paths — a schema field named for one of those props at depth 2+ is reachable as a descent target (no shadowing). `form.fields('email').errors`, `form.fields(['users', 0, 'name'])` for dynamic paths.                                                                                                                                                                                                                              |
| `errors`      | `FormFieldErrors<Form>`                                        | Drillable per-leaf error proxy: `form.errors.email?.[0]?.message`. Container reads descend; leaf reads return `ValidationError[] \| undefined`. Schema entries first, user entries second. Inactive-variant (DU) errors filtered. `form.errors('a.b.c')` for dynamic paths. See [error store](#error-store).                                                                                                                                                                                                                                                                      |
| `toRef(path)` | `(path: FlatPath<Form>) => Readonly<Ref<NestedReadType<...>>>` | Escape hatch — get a `Readonly<Ref>` at `path` for `watch()` or external composables that expect ref-shaped inputs. Read type matches `form.values.<path>` (slim-widened, array-tainted).                                                                                                                                                                                                                                                                                                                                                                                         |

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
`form.errors` and are returned in full from `validate*()` /
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

| Member                     | Signature                                                                                                                                                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setValue(value)`          | `<V extends SetValuePayload<WriteShape<Form>, WriteShape<Form>>>(value: V) => boolean`                                                                               | Replace the whole form. Callback form's `prev` widens via `WriteShape<Form>` (matching what's actually storable). Array `prev.posts[N]` reads get `\| undefined` from the consumer's `noUncheckedIndexedAccess: true`; iteration over `prev.posts` stays strict. Returns `false` if the slim-primitive gate rejects. Programmatic — does NOT trigger persistence.                                                                                                                                                                                                                                     |
| `setValue(path, value)`    | `<P extends FlatPath<Form>, V extends SetValuePayload<WriteShape<NestedType<Form, P>>, NonNullable<WriteShape<NestedType<Form, P>>>>>(path: P, value: V) => boolean` | Replace a single leaf or sub-tree. Callback form's `prev` is `NonNullable<WriteShape<NestedType<Form, P>>>` — runtime auto-defaults missing slots before the callback fires. Returns `false` on slim-primitive rejection. Programmatic — does NOT trigger persistence.                                                                                                                                                                                                                                                                                                                                |
| `register(path, options?)` | `(path: P, options?: RegisterOptions) => RegisterValue<NestedReadType<WriteShape<Form>, P>>`                                                                         | Produces the binding the `v-register` directive consumes. `innerRef`'s read type widens via `WriteShape<Form>` (matches what's storable) and carries `\| undefined` at array-crossing paths; the directive renders `undefined` as empty correctly. `options.persist: true` opts the field into persistence; `options.acknowledgeSensitive: true` overrides the sensitive-name heuristic; `options.transforms: [...]` runs a sync pipeline on user input before it lands in form state (see [Transforms](#transforms--registerpath--transforms-)). See [persistence recipe](./recipes/persistence.md). |

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
| `errors`                  | `FormFieldErrors<Form>` — leaf-aware drillable callable Proxy. Per-leaf `ValidationError[] \| undefined`; container reads descend. Schema entries first, user entries second. Inactive-variant (DU) errors filtered.                   |
| `setFieldErrors(errors)`  | `(ValidationError[]) => void` — replaces the user-error store. For server / API responses, parse the payload via `parseApiErrors` (top-level helper) and feed the result here. See [server-errors recipe](./recipes/server-errors.md). |
| `addFieldErrors(errors)`  | `(ValidationError[]) => void` — appends to the user-error store.                                                                                                                                                                       |
| `clearFieldErrors(path?)` | `(path?) => void` — clears BOTH stores at the given path (or all paths if omitted). With live validation, the schema half re-populates on the next mutation if the value is still invalid.                                             |

For a "show all errors" UI (path-keyed, form-level, unmapped server,
cross-field-refine), use `form.meta.errors` — a flat
`ValidationError[]` covering EVERY error in the form (unfiltered).

### Form-level meta

The form-level flags, counters, and aggregates live on a single
`meta` object (`reactive()` + `readonly()`). Vue's reactive
auto-unwraps refs at property access, so `form.meta.isSubmitting`
is a primitive in both templates and scripts — no `.value`. The
full type is the exported `FormMeta` interface.

| Member              | Type                         | What it does                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta.isDirty`      | `boolean`                    | `true` iff any leaf's current value differs from its original.                                                                                                                                                                                                                                                                                                  |
| `meta.isValid`      | `boolean`                    | `true` iff both the schema-error and user-error stores are empty.                                                                                                                                                                                                                                                                                               |
| `meta.isSubmitting` | `boolean`                    | `true` while the submit handler is running.                                                                                                                                                                                                                                                                                                                     |
| `meta.isValidating` | `boolean`                    | `true` while any validation run is in flight (reactive, imperative, or pre-submit).                                                                                                                                                                                                                                                                             |
| `meta.submitCount`  | `number`                     | Incremented once per call, regardless of outcome.                                                                                                                                                                                                                                                                                                               |
| `meta.submitError`  | `unknown`                    | Whatever the callback threw; `null` on success. Cleared on every new submission.                                                                                                                                                                                                                                                                                |
| `meta.canUndo`      | `boolean`                    | Gate an "Undo" button on this. Always present; `false` when `history` is off.                                                                                                                                                                                                                                                                                   |
| `meta.canRedo`      | `boolean`                    | Gate a "Redo" button on this. Always present; `false` when `history` is off.                                                                                                                                                                                                                                                                                    |
| `meta.historySize`  | `number`                     | Total snapshots across both stacks. `0` when `history` is off.                                                                                                                                                                                                                                                                                                  |
| `meta.errors`       | `readonly ValidationError[]` | Flat aggregate of EVERY error in the form (path-keyed + form-level + unmapped + cross-field refines). UNFILTERED — inactive-variant errors stay in. Filter the array yourself for narrower views.                                                                                                                                                               |
| `meta.instanceId`   | `string`                     | Per-`useForm()`-call identity. Stable for one mount; new on remount; orthogonal to `form.key` (the user-supplied shared identifier). Useful for devtools panels disambiguating shared-key mounts, telemetry, E2E test selectors (`data-form-id={form.meta.instanceId}`), and Vue `:key` for keyed lists of forms. Opaque format — treat as identity, not state. |

`meta` is read-only — `meta.x = y` writes are rejected at runtime
with a dev-mode warning (use `setValue` / `handleSubmit` /
`reset` to mutate the form). Watchers use the getter form:
`watch(() => form.meta.isSubmitting, …)`.

### Focus + scroll

| Member                         | Signature               | What it does                                                                                                                                                      |
| ------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `focusFirstError(options?)`    | `(options?) => boolean` | Focuses the **visually-first** errored field's connected, visible element registered through this `useForm()` callsite. Returns `true` if an element was focused. |
| `scrollToFirstError(options?)` | `(options?) => boolean` | Scrolls that element into view. Returns `true` on success.                                                                                                        |

"Visually-first" is DOM-tree order via `compareDocumentPosition` — the
field rendered above another in the template wins, regardless of which
the schema declared earlier. CSS `order:` flexbox/grid reordering is
NOT respected (DOM-tree order wins) — visual-order via
`getBoundingClientRect` would force layout per comparison and break
under `display: none`. The 99% case (semantic source-order rendering)
matches what users see.

Scope is per `useForm()` callsite: when two `useForm({ key })` calls
share a key (sidebar + main rendering the same form), each callsite's
`focusFirstError` only targets elements registered through THAT
callsite. Children using `injectForm()` inherit their ancestor's
instance ID, so parent-submit-focus continues to work for inputs
registered by deep children.

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
(`meta.canUndo`, `meta.canRedo`, `meta.historySize`) live on the
`meta` bundle above. Inert stubs when `history` isn't
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

### Blank introspection

| Member                | Type                  | What it does                                                                                                                                                                                                                                                                                                                   |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blankPaths.value`    | `ReadonlySet<string>` | Frozen snapshot of every path-key currently in the form's `blankPaths` set. Reactive — Vue tracks `.has()` / `.size` / iteration. Mutating the snapshot is a no-op (writes go through `setValue(_, unset)`, the directive's input listener, or `markBlank()` on a register binding). See `unset` exported from the core entry. |
| `fields.<path>.blank` | `boolean`             | Per-path equivalent: `true` while `path` is in the form's `blankPaths` set.                                                                                                                                                                                                                                                    |

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
  CoercionEntry,
  CoercionRegistry,
  CoercionResult,
  CurrentValueContext,
  CurrentValueWithContext,
  CustomDirectiveRegisterAssignerFn,
  DeepPartial,
  DefaultValuesResponse,
  DefaultValuesShape,
  FieldState,
  FieldStateLeaf,
  FieldStateMap,
  FieldStateMapEntry,
  FlatPath,
  FormErrorRecord,
  FormErrorsSurface,
  FormKey,
  FormMeta,
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
  RegisterTransform,
  RegisterValue,
  SetValueCallback,
  SetValuePayload,
  SettledValidationStatus,
  SlimPrimitiveKind,
  SubmitHandler,
  Unset,
  UseFormReturnType,
  UseFormConfiguration,
  ValidateOn,
  ValidateOnConfig,
  ValidationError,
  ValidationResponse,
  ValidationResponseWithoutValue,
  WriteShape,
} from 'decant'
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
  below) at the call site for `register`, `values`, `fields`,
  and `toRef`.
- **`WriteShape<T>`** — recursive mapped type that widens primitive-
  literal leaves to their primitive supertype. `'red' | 'green'` →
  `string`; `42` → `number`; nested objects recurse; tuples
  preserve positions; unbounded arrays widen elements; `Date`,
  `RegExp`, `Map`, `Set`, and functions pass through unchanged.
  Applied to read surfaces that observe storage (`form.values`,
  `form.fields.<path>.value`, `register.innerRef`). NOT applied
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
  exported alongside under the same name from `decant`.
- **`IsTuple<T>`** — `true` for tuples (literal `length`), `false`
  for unbounded arrays (`length: number`). Used internally by
  `NestedReadType` to decide whether to taint past a numeric
  segment.
- **`SetValuePayload<Write, Read = Write>`** — union of `Write` and
  `SetValueCallback<Read>`. The whole-form `setValue` parameterises
  both to `WriteShape<Form>` (`prev` matches `form.values`); the
  path-form parameterises `Read` to `NonNullable<NestedType<F, P>>`.
- **`SetValueCallback<Read>`** — `(prev: Read) => Read`. The
  callback's return shape matches its input shape; runtime
  mergeStructural completes any structural gaps.
- **`ArrayPath<Form>`** — `FlatPath<Form>` filtered to array-leaf
  paths. Used by `append` / `remove` / etc.
- **`ArrayItem<Form, Path>`** — the element type of the array at
  `Path`.
- **`ValidationError`** — `{ path: readonly Segment[]; message:
string; formKey: FormKey }`.
- **`FieldStateLeaf<Value>`** — runtime shape of a single
  `form.fields.<path>` read: `value` / `original` (typed
  `Value`), `pristine` / `dirty` / `blank` (booleans), `focused` /
  `blurred` / `touched` (`boolean | null`), `errors`
  (`readonly ValidationError[]`), `path`, `isConnected`, `updatedAt`.
  Schema fields with names matching these leaf keys at depth ≥ 2
  are shadowed by the leaf — bracket-access via `toRef` is the
  workaround.
- **`FieldStateMap<Form>`** — the recursive type behind
  `form.fields`. Top-level fields and nested objects are
  reachable via dot-descent; leaf keys (`value`, `dirty`, `errors`,
  …) read off the FieldStateLeaf at the current path.
- **`FieldState<Value = unknown>`** — richer per-field type kept for
  type-level utility code: `currentValue` / `originalValue` /
  `previousValue` (typed `Value`), the same flag set as
  `FieldStateLeaf`, plus `meta` (`MetaTrackerValue`). Returned by no
  current public API directly; useful when type-narrowing or
  building higher-order helpers.
- **`ValidateOn`** — `'change' | 'blur' | 'submit'`. The trigger for
  per-field validation. Default `'change'`. `'submit'` opts out of
  live validation entirely (submit is the only validator).
- **`ValidateOnConfig`** — discriminated union over `validateOn` that
  enforces `debounceMs` is only valid with `'change'`. The public
  `useForm` signature intersects `UseFormConfiguration` with this so
  pairing `debounceMs` with `'blur'` / `'submit'` is a TS error
  rather than a silent runtime drop.
- **`RegisterTransform`** — `(value: unknown) => unknown`. Element of
  `register(path, { transforms: [...] })`. Generic-erased so a
  personal library of transforms plugs into any path. See
  [Transforms](#transforms--registerpath--transforms-).
- **`CoercionEntry<I, O>`** — `{ input: I; output: O; transform: (value) => CoercionResult<O> }`
  where `I`, `O` extend `SlimPrimitiveKind`. One coercion rule. Author
  with `defineCoercion(...)` for narrowed `transform` parameter typing.
- **`CoercionRegistry`** — `readonly CoercionEntry[]`. The shape
  consumed by `useForm({ coerce })` and `defaults.coerce`. Spread
  `defaultCoercionRules` to extend rather than replace.
- **`CoercionResult<O>`** — `{ coerced: true; value: O } | { coerced: false }`.
  Returned by a `CoercionEntry.transform`. Returning `{ coerced: false }`
  signals "this rule doesn't apply" — the write passes through
  untouched.
- **`FormMeta`** — the shape of `form.meta`: form-level flags
  (`isDirty`, `isValid`, `isSubmitting`, `isValidating`), counters
  (`submitCount`, `historySize`), the flat `errors` aggregate, and
  the per-mount `instanceId`.
- **`FormErrorsSurface<F>`** — the shape of `form.errors`. Drillable
  callable Proxy; per-leaf `ValidationError[] | undefined`. Replaces
  the pre-0.14 flat-record shape `Partial<Record<FlatPath<F>, ValidationError[]>>`.
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
  `rawValue`, `isConnected`, `formKey`, `path`. Read from
  `FieldState.meta` when type-narrowing through that surface.
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
