---
title: 'attaform — core runtime API'
description: 'The schema-agnostic core of Attaform: createAttaform plugin, useAbstractForm composable, v-register directive, parseApiErrors, and shared types.'
---

# `attaform`

The framework-agnostic core. Use this if you're bringing your own
schema library or wiring SSR by hand.

```ts
import {
  createAttaform,
  useForm, // re-export of useAbstractForm
  injectForm,
  useRegistry,
  renderAttaformState,
  hydrateAttaformState,
  escapeForInlineScript,
  vRegister,
  canonicalizePath,
  parseApiErrors,
} from 'attaform'
```

## `createAttaform(options?)`

The Vue plugin. Install once per app.

```ts
createApp(App).use(createAttaform()).mount('#app')
```

Options:

| Field      | Type               | Description                                                                                          |
| ---------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `override` | `boolean`          | Force `ssr` to `true` / `false`. Auto-detected otherwise.                                            |
| `devtools` | `boolean`          | Enable the Vue DevTools plugin. Default `true`. See [recipe](/docs/recipes/devtools).                |
| `defaults` | `AttaformDefaults` | App-level option defaults applied to every `useForm` call. See [recipe](/docs/recipes/app-defaults). |

## `useForm<Form>({ schema, key, ... })`

Schema-agnostic. Takes any `AbstractSchema<Form, Form>` — wrap a
Valibot schema, ArkType schema, or a hand-rolled validator with
[a custom adapter](/docs/recipes/custom-adapter). The Zod subpaths
are pre-made wrappers over this. For options, see
[`attaform/zod`](/docs/api/zod#useformschemaoptions).

## `injectForm<Form>(key?)`

Reach the nearest ancestor's form (no key) or reach any form by its
key. Type-identical return to `useForm`. See
[recipe](/docs/recipes/form-context).

**Resolution rules** (no-key form):

- Closest ambient ancestor wins.
- Only anonymous `useForm()` (no `key`) fills the ambient slot;
  keyed forms are reachable only via `injectForm(key)`.
- No ambient ancestor → returns `null` (dev-mode warn).
- Inherits the resolved ancestor's `formInstanceId`.

**Resolution rules** (keyed form): registry lookup by string key,
independent of component-tree position.

## `useRegistry()`

Returns the current app's `AttaformRegistry`. Must be called inside
a component's `setup()`.

## `renderAttaformState(app) → SerializedAttaformState`

Server-side: serialize every form in the app to a plain object safe
for `JSON.stringify`. Pair with `hydrateAttaformState` on the
client.

## `hydrateAttaformState(app, payload)`

Client-side: rehydrate forms from the serialized payload. Call
before `app.mount(...)`.

## `escapeForInlineScript(json) → string`

Takes a JSON string and escapes the characters that would let a
form value break out of an inline `<script>` tag: `<`, `>`, `&`,
U+2028, U+2029. Pair with `renderAttaformState` when hand-rolling
SSR; Nuxt handles it for you via `devalue`.

```ts
const payload = escapeForInlineScript(JSON.stringify(renderAttaformState(app)))
// `<script>window.__STATE__ = ${payload}</script>` is safe to inline.
```

## `vRegister`

The `v-register` directive. Registered automatically by
`createAttaform`; exported for consumers installing directives
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
  import { useRegister } from 'attaform'
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

### Wrapper-component primitives

The `RegisterValue` returned by `register(...)` is a `shallowReadonly`
reactive proxy. Top-level reads track in `computed` / `watchEffect`,
mutations are blocked, and inner refs (`innerRef`, `displayValue`)
keep their `Ref` shape. A generic wrapper using `useRegister()` can
derive field state from the captured RV alone — no separate `path`
prop:

| Field            | Type                 | Use                                                                          |
| ---------------- | -------------------- | ---------------------------------------------------------------------------- |
| `path`           | `PathKey`            | Canonical, JSON-encoded path (`'["items",0,"name"]'`). Stable Map / Set key. |
| `segments`       | `readonly Segment[]` | Frozen path array (`['items', 0, 'name']`). Pass to `form.fields(...)`.      |
| `formKey`        | `string`             | Mirrors `form.key` so wrappers can target a specific form by key.            |
| `formInstanceId` | `string`             | Per-mount runtime id — disambiguates sibling forms with the same `key`.      |

`useRegister()` itself returns a hybrid Proxy: it answers like a
`Ref<RegisterValue | undefined>` to Vue's template auto-unwrap (so
`v-register="rv"` keeps feeding the directive the underlying RV and
its path-migration diff stays sound across renders), AND every other
property read pierces to the captured RV — so `rv.path`,
`rv.segments`, `rv.formKey` work directly in `<script setup>` without
a `.value` step. Reads inside reactive scopes still track the
underlying `shallowRef`, so derived state re-runs when the parent
rebinds.

```vue
<!-- ErrorRow.vue — wraps any v-register binding, shows the first error -->
<script setup lang="ts">
  import { computed } from 'vue'
  import { injectForm, useRegister } from 'attaform'

  const rv = useRegister()
  const form = injectForm()
  const field = computed(() => (form !== null ? form.fields(rv.segments) : undefined))
</script>

<template>
  <div class="row">
    <slot />
    <small v-if="field?.validating">Checking…</small>
    <small v-else-if="field?.errors[0]">{{ field.errors[0].message }}</small>
    <!-- Or read the path directly in the template — auto-unwrap pierces:
         <small>bound to {{ rv.path }}</small> -->
  </div>
</template>
```

`field.validating` is the per-field analogue of
`form.meta.validating`: it's `true` while a field-level validation
run (debounced or cross-field) is in flight at this path. Whole-form
`validate()` / `validateAsync()` calls drive `form.meta.validating`
only — they don't flip per-field flags. See [field-level validation
recipe](/docs/recipes/field-level-validation#per-field).

### Modifiers

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

### Custom assigners

Overrides the directive's default "DOM event → extract value →
`rv.setValueWithInternalPath(value)`" bridge. The handler receives
the post-extraction value plus the `RegisterValue` and decides what
(if anything) reaches form state.

```vue
<script setup lang="ts">
  import type { RegisterValue } from 'attaform'

  const form = useForm({ schema, defaultValues: { username: '' } })

  function uppercaseAssigner(value: unknown, rv: RegisterValue): void {
    rv.setValueWithInternalPath(String(value ?? '').toUpperCase())
  }
</script>

<template>
  <input v-register="form.register('username')" @update:registerValue="uppercaseAssigner" />
</template>
```

Modifier extraction runs first — `.number` gives you a number,
`.trim` the trimmed string, `<input type="checkbox">` the boolean.

Four patterns:

| Pattern               | What to do                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Transform             | Call `rv.setValueWithInternalPath(normalised)`.                                                        |
| Reject                | Skip the call; the keystroke drops entirely (distinct from validation errors, which accept then flag). |
| Side-effect + default | Log / analytics, then call through.                                                                    |
| Redirect              | Write to a different field or external store.                                                          |

Handler signature:
`(value: unknown, registerValue: RegisterValue) => boolean | undefined`.
Return `false` to flag a rejected write; `undefined` / `void` is
success. Use only on `<input>`, `<select>`, `<textarea>` roots — for
non-form roots see `useRegister()` or `assignKey` (Web Components).

The handler can be a top-level function outside `setup()` since
`rv` is supplied by the directive. Multiple listeners on the same
element receive `(value, rv)` in registration order.

### Transforms

A pipeline of pure functions for normalizing user input. Composed
left-to-right; runs inside the directive's assigner across every
`v-register` element variant.

```ts
import type { RegisterTransform } from 'attaform'

const trim: RegisterTransform = (v) => (typeof v === 'string' ? v.trim() : v)
const lowercase: RegisterTransform = (v) => (typeof v === 'string' ? v.toLowerCase() : v)

const rv = form.register('email', { transforms: [trim, lowercase] })
```

```vue
<input v-register="rv" />
<!-- type "  Foo@BAR.com  ", form receives "foo@bar.com" -->
```

`RegisterTransform` is `(value: unknown) => unknown` — generic-erased
so a personal library of transforms plugs into any `register()` slot.
Write defensive bodies that no-op on type mismatch.

**Pipeline ordering**: transforms run after modifier extraction,
before the assigner writes to form state.

```text
DOM event → modifier cast → transforms[0] → … → transforms[n] → assigner
```

Combine freely: `<input v-register.lazy.number="register('age', { transforms: [clamp(0, 99)] })">`.

**Scope.** Transforms apply to user-input via the directive only —
NOT to `setValue`, `reset`, hydration, SSR replay, or `markBlank()`.
For programmatic writes, compose transforms at the call site:
`form.setValue('email', lowercase(trim(rawValue)))`.

**With `@update:registerValue`.** The override receives the
post-transform value as its first arg. If you want the raw
extracted value, don't register transforms.

**Failure mode.** Must be sync. On throw OR Promise return: the
pipeline aborts, form state is unchanged, the assigner returns
`false`, the DOM reverts via the `:value` binding, and a
`console.error` is logged. Dev mode includes the path, transform
index, transform `.name`, and remediation hint; prod logs a fixed
string only. A throw on one keystroke doesn't poison subsequent
keystrokes or other fields.

**Transforms cover normalization. `@update:registerValue` covers
control** (rejection-with-side-effect, redirection, custom DOM
mutation).

## `canonicalizePath(input) → { segments, key }`

Normalise a dotted-string or array path into a structured `Path`
plus a stable `PathKey`. Use when building custom adapters.

## `parseApiErrors(payload, options) → ParseApiErrorsResult`

Pure transformation: takes a server response in the common shapes
(`{ error: { details } }`, `{ details }`, or a raw `{ path: entry }`
record) and returns `{ ok, errors, rejected? }`. Pair with
`form.setFieldErrors(result.errors)` to apply.

**Wire format.** Two entry shapes:

- **Structured** — `{ message: string, code: string }`. `code`
  forwards onto the produced `ValidationError`.
- **Bare string** — synthesized into
  `{ message, code: defaultCode }`. `defaultCode` defaults to
  `'api:unknown'`.

A field's value may be a single entry, an array, or a mix.

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

See [server-errors recipe](/docs/recipes/server-errors) for the full
pattern.

## Error codes

Every `ValidationError` carries a required `code: string` for stable
machine identification. Convention is `<scope>:<kebab-case>`:

| Scope    | Owner              | Examples                                                                          |
| -------- | ------------------ | --------------------------------------------------------------------------------- |
| `atta:`  | Library core       | `atta:no-value-supplied`, `atta:adapter-threw`, `atta:path-not-found`             |
| `zod:`   | Zod adapter        | `zod:too_small`, `zod:invalid_format`, `zod:custom` (forwarded from `issue.code`) |
| consumer | Your app / backend | `api:duplicate-email`, `auth:expired-token`, `myapp:account-locked`               |

The library exports `AttaformErrorCode` for branching on internal codes:

```ts
import { AttaformErrorCode } from 'attaform'
// or 'attaform/zod' / 'attaform/zod-v3'

if (error.code === AttaformErrorCode.NoValueSupplied) {
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

## `unset`

A brand-typed sentinel symbol used to mark a primitive leaf as
**displayed-empty** while storage holds the schema's slim default
(`0` for `z.number()`, `''` for `z.string()`, `false` for
`z.boolean()`, `0n` for `z.bigint()`).

```ts
import { unset, useForm } from 'attaform/zod'
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

**Auto-mark on construction.** Every primitive leaf the consumer
didn't supply in `defaultValues` is auto-marked `blank`. To opt a
leaf out, supply a non-`unset` value (`defaultValues: { email: '' }`).
Auto-mark recurses through nested objects, NOT arrays. Hydration
(persisted draft, SSR payload) overrides — the hydrated `blankPaths`
list is authoritative.

**Submit / validate honor the sentinel.** A blank path bound to a
required schema raises `"No value supplied"` during `handleSubmit` /
`validate*`. Optional / nullable / has-default schemas accept the
empty case.

The directive's input listener auto-marks numeric inputs on empty
DOM; strings and booleans require explicit `unset` (DOM state alone
doesn't carry "user-cleared" intent).

**Introspection.** `form.fields.<path>.blank` per-path;
`form.blankPaths.value` (frozen `ReadonlySet<PathKey>`) for bulk.
`isUnset(value)` is the runtime guard; `Unset` the type-level
brand.

## Other exports

- `parseDottedPath(s)` — string → `Segment[]`
- `assignKey` — `unique symbol` used to install a custom assigner on a v-register-bound element. For most cases prefer the `@update:registerValue` listener (see [Custom assigners](#custom-assigners)); reach for `assignKey` only when you need pre-mount installation (typically Web Components).
- `isRegisterValue(x)` — type guard for the object `register` returns
- `RegisterTransform` — `(value: unknown) => unknown` — type alias for entries in `register(path, { transforms: [...] })`. Generic-erased so a personal library of transforms works across any path type; see [Transforms](#transforms--registerpath--transforms-).
- `ROOT_PATH` / `ROOT_PATH_KEY` — the empty path and its key
- `PARSE_API_ERRORS_DEFAULTS` — `{ maxEntries: 1000, maxPathDepth: 32, maxTotalSegments: 10000 }` constant
- `AnonPersistError` / `InvalidPathError` / `OutsideSetupError` / `RegistryNotInstalledError` / `ReservedFormKeyError` / `SensitivePersistFieldError` / `SubmitErrorHandlerError` — error classes
