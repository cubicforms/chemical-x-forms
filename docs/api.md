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

| Field             | Type                                                                        | Required | Description                                                                                                                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`          | `z.ZodType`                                                                 | yes      | The Zod schema describing the form shape.                                                                                                                                                                                                                                                   |
| `key`             | `string`                                                                    | no       | Form identity. Omit for one-off forms (runtime allocates a synthetic `cx:anon:<id>` via `useId()`). Pass a string when you need cross-component lookup via `useFormContext(key)`, shared state across call-sites, a stable `persist` storage-key default, or a recognisable DevTools label. |
| `defaultValues`   | `DeepPartial<Form>`                                                         | no       | Constraints applied over schema defaults.                                                                                                                                                                                                                                                   |
| `validationMode`  | `'lax'` \| `'strict'`                                                       | no       | Defaults to `'lax'`. See [Types](#types).                                                                                                                                                                                                                                                   |
| `onInvalidSubmit` | `'none'` \| `'focus-first-error'` \| `'scroll-to-first-error'` \| `'both'`  | no       | What to do when submit fails validation. See [recipe](./recipes/focus-on-error.md).                                                                                                                                                                                                         |
| `fieldValidation` | `{ on, debounceMs }`                                                        | no       | Live field validation. Default `{ on: 'change', debounceMs: 200 }` — errors track live. Pass `{ on: 'none' }` to opt out (submit-only). See [recipe](./recipes/field-level-validation.md).                                                                                                  |
| `persist`         | `{ storage, key?, debounceMs?, include?, version?, clearOnSubmitSuccess? }` | no       | Persist draft state. See [recipe](./recipes/persistence.md).                                                                                                                                                                                                                                |
| `history`         | `true` \| `{ max?: number }`                                                | no       | Enable undo/redo. See [recipe](./recipes/undo-redo.md).                                                                                                                                                                                                                                     |

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
} from '@chemical-x/forms'
```

### `createChemicalXForms(options?)`

The Vue plugin. Install once per app.

```ts
createApp(App).use(createChemicalXForms()).mount('#app')
```

Options:

| Field      | Type      | Description                                                                          |
| ---------- | --------- | ------------------------------------------------------------------------------------ |
| `override` | `boolean` | Force `isSSR` to `true` / `false`. Auto-detected otherwise.                          |
| `devtools` | `boolean` | Enable the Vue DevTools plugin. Default `true`. See [recipe](./recipes/devtools.md). |

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

### `canonicalizePath(input) → { segments, key }`

Normalise a dotted-string or array path into a structured `Path`
plus a stable `PathKey`. Use when building custom adapters.

### Other exports

- `parseDottedPath(s)` — string → `Segment[]`
- `assignKey(el, key)` — low-level DOM marking used by `vRegister`
- `isRegisterValue(x)` — type guard for the object `register` returns
- `ROOT_PATH` / `ROOT_PATH_KEY` — the empty path and its key
- `InvalidPathError` / `RegistryNotInstalledError` / `SubmitErrorHandlerError` — error classes

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

| Member                   | Type                            | What it does                                                        |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------- |
| `getValue()`             | `Readonly<Ref<Form>>`           | Whole form reactive ref.                                            |
| `getValue(path)`         | `Readonly<Ref<LeafOf<path>>>`   | Single-field ref. Path is `FlatPath<Form>`.                         |
| `getValue({ withMeta })` | `CurrentValueWithContext<Form>` | Whole form with meta.                                               |
| `getFieldState(path)`    | `Ref<FieldState>`               | Per-field errors + touched / focused / blurred / isConnected flags. |

### Writing values

| Member                  | Signature                               | What it does                                              |
| ----------------------- | --------------------------------------- | --------------------------------------------------------- |
| `setValue(value)`       | `(value: Form) => boolean`              | Replace the whole form.                                   |
| `setValue(path, value)` | `(path, value) => boolean`              | Replace a single leaf or sub-tree.                        |
| `register(path)`        | `(path) => RegisterValue<LeafOf<path>>` | Produces the binding the `v-register` directive consumes. |

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

| Member                                    | Type                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `fieldErrors`                             | `Readonly<FormFieldErrors<Form>>` — Proxy view; dot-access leaves directly, no `.value`. Merges schema + user; schema entries first. |
| `setFieldErrors(errors)`                  | `(ValidationError[]) => void` — replaces the user-error store.                            |
| `addFieldErrors(errors)`                  | `(ValidationError[]) => void` — appends to the user-error store.                          |
| `clearFieldErrors(path?)`                 | `(path?) => void` — clears BOTH stores at the given path (or all paths if omitted). With live validation, the schema half re-populates on the next mutation if the value is still invalid. |
| `setFieldErrorsFromApi(payload, limits?)` | Hydrates a server error envelope into the user-error store. Survives subsequent schema revalidation. See [server-errors recipe](./recipes/server-errors.md). |

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

| Member             | Signature                            | What it does                                                                        |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `reset(next?)`     | `(next?: DeepPartial<Form>) => void` | Re-seed the whole form. Rebuilds originals, clears errors + touched + submit state. |
| `resetField(path)` | `(path: FlatPath<Form>) => void`     | Restore one path (leaf or container) to its original value.                         |

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

| Member                        | Signature                                                               |
| ----------------------------- | ----------------------------------------------------------------------- |
| `append(path, value)`         | Path narrowed to `ArrayPath<Form>`; value narrowed to `ArrayItem<...>`. |
| `prepend(path, value)`        | Same typing as `append`.                                                |
| `insert(path, index, value)`  | Same typing as `append`; index numeric.                                 |
| `remove(path, index)`         | Numeric index.                                                          |
| `swap(path, a, b)`            | Two numeric indices.                                                    |
| `move(path, from, to)`        | Two numeric indices.                                                    |
| `replace(path, index, value)` | Never grows the array.                                                  |

See [dynamic-field-arrays recipe](./recipes/dynamic-field-arrays.md)
for the `v-for` pattern.

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
  DeepPartial,
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
  DefaultValuesResponse,
  NestedType,
  OnError,
  OnInvalidSubmitPolicy,
  OnSubmit,
  PendingValidationStatus,
  PersistConfig,
  PersistIncludeMode,
  ReactiveValidationStatus,
  RegisterValue,
  SettledValidationStatus,
  SubmitHandler,
  UseAbstractFormReturnType,
  UseFormConfiguration,
  ValidationError,
  ValidationMode,
  ValidationResponse,
  ValidationResponseWithoutValue,
} from '@chemical-x/forms'
```

The ones you'll touch most:

- **`FlatPath<Form>`** — union of every addressable path for the
  form. Dotted strings.
- **`NestedType<Form, Path>`** — the leaf type at `Path`.
- **`ArrayPath<Form>`** — `FlatPath<Form>` filtered to array-leaf
  paths. Used by `append` / `remove` / etc.
- **`ArrayItem<Form, Path>`** — the element type of the array at
  `Path`.
- **`ValidationError`** — `{ path: readonly Segment[]; message:
string; formKey: FormKey }`.
- **`FieldState`** — `{ value, errors, isConnected, touched,
focused, blurred, updatedAt }`.
- **`ValidationMode`** — `'lax' | 'strict'`. Most forms stay with
  `'lax'`.
- **`AbstractSchema`** — the schema contract. See
  [custom-adapter recipe](./recipes/custom-adapter.md).
