# API reference

Every public export of `@chemical-x/forms`, grouped by subpath. Each
entry gives the signature, the shape of the return value, and the
minimal example a consumer needs to wire it up.

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

Zod v4 adapter. Requires `zod@^4` in the consumer's project.

```ts
import { useForm, zodAdapter, kindOf, assertZodVersion } from '@chemical-x/forms/zod'
```

### `useForm<Schema>({ schema, key, initialState?, validationMode? })`

The primary entry point. Returns a typed reactive surface; see
[The useForm return value](#the-useform-return-value).

```ts
const schema = z.object({ email: z.email() })
const form = useForm({ schema, key: 'signup' })
```

Options:

| Field            | Type                           | Required | Description                                                |
| ---------------- | ------------------------------ | -------- | ---------------------------------------------------------- |
| `schema`         | `z.ZodType`                    | yes      | The Zod schema describing the form shape.                  |
| `key`            | `string`                       | yes      | Unique form key within the app. Prevents cross-form state. |
| `initialState`   | `DeepPartial<Form>`            | no       | Constraints applied over schema defaults.                  |
| `validationMode` | `'lax'` \| `'strict'`          | no       | Defaults to `'lax'`. See [Types](#types).                  |

### `zodAdapter(schema)`

Lower-level primitive. Returns an `AbstractSchema<Form, Form>` that
wraps a Zod schema. Use it only when composing your own `useForm`-like
hook; most consumers import `useForm` directly.

### `kindOf(schema)`

Returns the zod kind (`'string'`, `'number'`, `'object'`,
`'discriminated-union'`, etc.) for a zod v4 schema. Exported for
advanced adapter work.

### `assertZodVersion(version)`

Throws if the installed zod major does not match the argument.
Normally called internally; exposed for symmetry with the v3 subpath.

### `type ZodKind`

Union of the strings returned by `kindOf`.

---

## `@chemical-x/forms/zod-v3`

Zod v3 adapter. Requires `zod@^3`. This subpath is legacy — new
projects should use `/zod` (v4).

```ts
import { useForm, zodAdapter, isZodSchemaType } from '@chemical-x/forms/zod-v3'
```

Same surface as `/zod` for the functions that apply; see source for the
v3-specific helper types (`UnwrapZodObject`, `ZodTypeWithInnerType`,
etc.) if you need to introspect a v3 schema yourself.

---

## `@chemical-x/forms`

The framework-agnostic core. Use this if you're not using Zod — bring
your own `AbstractSchema` — or if you're wiring up SSR by hand.

```ts
import {
  createChemicalXForms,
  useForm,           // re-export of useAbstractForm
  useRegistry,
  renderChemicalXState,
  hydrateChemicalXState,
  vRegister,
  canonicalizePath,
} from '@chemical-x/forms'
```

### `createChemicalXForms(options?)`

The Vue plugin. Install it once per app.

```ts
createApp(App).use(createChemicalXForms()).mount('#app')
```

Options (all optional):

| Field      | Type    | Description                                                                        |
| ---------- | ------- | ---------------------------------------------------------------------------------- |
| `override` | boolean | Force `isSSR` to `true`/`false`. Otherwise detected automatically. Test hook only. |

### `useForm<Form>({ schema, key, ... })`

Schema-agnostic. Takes an `AbstractSchema<Form, Form>` (anything
implementing `getInitialState` + `validateAtPath` + `getSchemasAtPath`).
The Zod subpaths wrap this — you can equally wrap a Valibot schema, an
ArkType schema, or a hand-rolled validator.

### `useRegistry()`

Returns the current app's `ChemicalXRegistry`. Must be called inside a
component's `setup()`.

### `renderChemicalXState(app) → SerializedChemicalXState`

Server-side: serialise every form in the app to a plain object safe
for `JSON.stringify` into the SSR payload. Pair with
`hydrateChemicalXState` on the client.

### `hydrateChemicalXState(app, payload)`

Client-side: rehydrate forms from the serialized payload.

### `vRegister`

The `v-register` directive. Normally installed for you by
`createChemicalXForms`; exported for consumers who install directives
manually or globally.

### `canonicalizePath(input) → { segments, key }`

Normalise a dotted-string or array path into a structured `Path` plus a
stable `PathKey`. Public for consumers building custom adapters.

### Other exports

- `parseDottedPath(s)` — string → `Segment[]`
- `assignKey(el, key)` — low-level DOM marking used by `vRegister`
- `isRegisterValue(x)` — type guard for the object `register` returns
- `ROOT_PATH` / `ROOT_PATH_KEY` — the empty path and its key
- `InvalidPathError` / `RegistryNotInstalledError` / `SubmitErrorHandlerError` — public error classes

---

## `@chemical-x/forms/nuxt`

A Nuxt module that installs the plugin, registers the node transforms,
and auto-imports `useForm`. Add to your `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['@chemical-x/forms/nuxt'],
})
```

Under Nuxt, `useForm` becomes globally available — no explicit
import needed.

---

## `@chemical-x/forms/vite`

A Vite plugin that injects the `v-register` node transforms into
`@vitejs/plugin-vue`'s compiler. Required under bare Vue + Vite for
SSR-correct `v-register` bindings on `<input>`, `<textarea>`, and
`<select>` elements.

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

The raw Vue compiler-core node transforms. Use this subpath only when
you're rolling your own bundler pipeline (esbuild, Rspack, custom
Rollup) and need to register them by hand.

```ts
import { inputTextAreaNodeTransform, selectNodeTransform } from '@chemical-x/forms/transforms'
```

---

## The useForm return value

Calling `useForm(options)` returns a single object with every reactive
piece of form state as a named field. Group by concern:

### Reading values

| Member                      | Type                                         | What it does                                                  |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `getValue()`                | `Readonly<Ref<Form>>`                        | Whole form reactive ref.                                      |
| `getValue(path)`            | `Readonly<Ref<LeafOf<path>>>`                | Single-field ref. Path is `FlatPath<Form>`.                   |
| `getValue({ withMeta })`    | `CurrentValueWithContext<Form>`              | Whole form with meta. Phase-2 stub — reserved for future.     |
| `getFieldState(path)`       | `Ref<FieldState>`                            | Per-field errors + touched/focused/blurred/isConnected flags. |

### Writing values

| Member                      | Signature                                   | What it does                                                 |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `setValue(value)`           | `(value: Form) => boolean`                  | Replace the whole form.                                      |
| `setValue(path, value)`     | `(path, value) => boolean`                  | Replace a single leaf or sub-tree.                           |
| `register(path)`            | `(path) => RegisterValue<LeafOf<path>>`     | Produces the binding the `v-register` directive consumes.    |

### Validation + submission

| Member                     | Signature                                                      | What it does                                                          |
| -------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `validate(path?)`          | `(path?) => Readonly<Ref<ValidationResponseWithoutValue>>`     | Reactive validation result. Recomputes on form mutation.              |
| `handleSubmit(cb, onErr?)` | `(cb, onErr?) => (event?) => Promise<void>`                    | Builds a submit handler. See the lifecycle refs below.                |

### Error store

| Member                               | Type                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `fieldErrors`                        | `Readonly<ComputedRef<Record<path, ValidationError[]>>>`               |
| `setFieldErrors(errors)`             | `(ValidationError[]) => void`                                          |
| `addFieldErrors(errors)`             | `(ValidationError[]) => void`                                          |
| `clearFieldErrors(path?)`            | `(path?) => void`                                                      |
| `setFieldErrorsFromApi(payload)`     | Accepts `ApiErrorEnvelope` or `ApiErrorDetails`; populates the store.  |

### Form-level aggregates

| Member        | Type                                | What it does                                                                 |
| ------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `isDirty`     | `Readonly<ComputedRef<boolean>>`    | True iff any leaf's current value ≠ its original.                            |
| `isValid`     | `Readonly<ComputedRef<boolean>>`    | True iff `fieldErrors` is empty.                                             |

### Submission lifecycle

| Member          | Type                                | What it does                                                                            |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| `isSubmitting`  | `Readonly<ComputedRef<boolean>>`    | True while the submit handler is running.                                                |
| `submitCount`   | `Readonly<ComputedRef<number>>`     | Incremented once per call, regardless of outcome.                                        |
| `submitError`   | `Readonly<ComputedRef<unknown>>`    | Whatever the callback threw; null on success. Cleared on every new submission.           |

### Reset

| Member                 | Signature                                  | What it does                                                                          |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `reset(next?)`         | `(next?: DeepPartial<Form>) => void`       | Re-seed the whole form. Rebuilds originals, clears errors + touched + submit state.   |
| `resetField(path)`     | `(path: FlatPath<Form>) => void`           | Restore one path (leaf or container) to its original value.                           |

### Field arrays (typed)

| Member                          | Signature                                                                 |
| ------------------------------- | ------------------------------------------------------------------------- |
| `append(path, value)`           | Path narrowed to `ArrayPath<Form>`; value narrowed to `ArrayItem<...>`.   |
| `prepend(path, value)`          | Same typing as `append`.                                                  |
| `insert(path, index, value)`    | Same typing as `append`; index numeric.                                   |
| `remove(path, index)`           | Numeric index.                                                            |
| `swap(path, a, b)`              | Two numeric indices.                                                      |
| `move(path, from, to)`          | Two numeric indices.                                                      |
| `replace(path, index, value)`   | Never grows the array.                                                    |

See `docs/recipes/dynamic-field-arrays.md` for the v-for pattern.

### Identity

| Member | Type       | What it does                               |
| ------ | ---------- | ------------------------------------------ |
| `key`  | `FormKey`  | The form's key (echoes the `key` option).  |

---

## Types

All types listed below are exported from the core entry:

```ts
import type {
  AbstractSchema,
  ArrayItem,
  ArrayPath,
  ApiErrorDetails,
  ApiErrorEnvelope,
  DeepPartial,
  FieldState,
  FlatPath,
  FormErrorRecord,
  FormKey,
  GenericForm,
  HandleSubmit,
  InitialStateResponse,
  NestedType,
  OnError,
  OnSubmit,
  RegisterValue,
  SubmitHandler,
  UseAbstractFormReturnType,
  UseFormConfiguration,
  ValidationError,
  ValidationMode,
  ValidationResponse,
  ValidationResponseWithoutValue,
} from '@chemical-x/forms'
```

Brief notes on the ones consumers touch most:

- **`FlatPath<Form>`** — union of every addressable path for the form.
  Leaves and intermediate containers both included. Dotted strings.
- **`NestedType<Form, Path>`** — the leaf type at `Path`. Strips
  `undefined | null` along the way unless the third type parameter is
  `false`.
- **`ArrayPath<Form>`** — `FlatPath<Form>` filtered to paths whose leaf
  is an array. Used by `append` / `remove` / etc. so non-array paths are
  compile errors.
- **`ArrayItem<Form, Path>`** — the element type of the array at `Path`.
- **`ValidationError`** — `{ path: readonly Segment[]; message: string; formKey: FormKey }`.
- **`FieldState`** — `{ value, errors, isConnected, touched, focused, blurred, updatedAt }`.
- **`ValidationMode`** — `'lax' | 'strict'`. Lax passes raw form values
  through validators; strict expects the data to conform. Most consumers
  stay with `'lax'`.
- **`AbstractSchema`** — the schema contract (see
  `docs/recipes/custom-adapter.md` for a walkthrough).
