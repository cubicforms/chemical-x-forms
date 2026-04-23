# Writing a custom adapter (AbstractSchema walkthrough)

The core of `@chemical-x/forms` is schema-agnostic. Zod is just one
implementation of an internal contract called `AbstractSchema`. If
you're on Valibot, ArkType, Effect-Schema, or a hand-rolled validator,
you can plug it in without forking the library.

This recipe walks through building a minimal adapter against an
imaginary schema library. Use it as a template — the real work is
translating between your library's type-introspection primitives and
the three methods below.

## The contract

```ts
type AbstractSchema<Form, GetValueFormType = Form> = {
  getInitialState(config): InitialStateResponse<Form>
  getSchemasAtPath(path: string | Path): readonly unknown[]
  validateAtPath(data: unknown, path: string | undefined): ValidationResponse<Form>
}
```

Three methods, all synchronous:

1. `getInitialState({ useDefaultSchemaValues, constraints, validationMode })`
   — returns `{ data, errors, success, formKey }`. Called at form
   creation and on every `reset()`. `constraints` is the caller's
   `initialState` / `reset(x)` argument; your adapter decides how to
   merge it over the schema's defaults.

2. `getSchemasAtPath(path)` — returns the list of sub-schemas that live
   at `path`. Mostly an introspection hook for advanced recipes;
   returning `[]` is fine if you don't need it.

3. `validateAtPath(data, path?)` — returns `{ data, errors, success,
   formKey }`. When `path` is `undefined`, validate the whole form.

## A minimal Valibot-like adapter

Assume our imaginary library exposes:

- `schema.defaultValues()` returning the schema's typed defaults.
- `schema.parse(data)` returning `{ success: true, data }` or
  `{ success: false, issues: { path: string[]; message: string }[] }`.

```ts
// adapter.ts
import type {
  AbstractSchema,
  InitialStateResponse,
  ValidationError,
  ValidationResponse,
} from '@chemical-x/forms'
import type { DeepPartial, GenericForm } from '@chemical-x/forms'

export function myLibAdapter<F extends GenericForm>(
  schema: MyLibSchema<F>
): AbstractSchema<F, F> {
  return {
    getInitialState({ constraints }): InitialStateResponse<F> {
      const defaults = schema.defaultValues()
      const merged = mergeDeepPartial(defaults, constraints)
      return {
        data: merged,
        errors: undefined,
        success: true,
        formKey: '',
      }
    },

    getSchemasAtPath(_path) {
      return []
    },

    validateAtPath(data, _path): ValidationResponse<F> {
      const result = schema.parse(data)
      if (result.success) {
        return {
          data: result.data as F,
          errors: undefined,
          success: true,
          formKey: '',
        }
      }
      return {
        data: undefined,
        errors: result.issues.map<ValidationError>((issue) => ({
          path: issue.path, // readonly (string | number)[]
          message: issue.message,
          formKey: '',
        })),
        success: false,
        formKey: '',
      }
    },
  }
}

function mergeDeepPartial<T>(base: T, override?: DeepPartial<T>): T {
  // …same shape as any immutable deep-merge; see test/utils/fake-schema.ts
  // for a dependency-free implementation.
}
```

The `formKey` field on every response stays empty — the composable
stamps the real key in after validation. This is an implementation
quirk of how the schema can't know which form it's attached to.

## Wiring to useForm

```ts
// useForm.ts
import { useForm as useAbstractForm } from '@chemical-x/forms'
import { myLibAdapter } from './adapter'

export function useForm<F extends GenericForm>(options: {
  schema: MyLibSchema<F>
  key: string
  initialState?: DeepPartial<F>
  validationMode?: 'lax' | 'strict'
}) {
  return useAbstractForm<F>({
    schema: myLibAdapter(options.schema),
    key: options.key,
    initialState: options.initialState,
    validationMode: options.validationMode,
  })
}
```

That's the whole integration. Consumers call `useForm({ schema,
key })` exactly like they would with the Zod subpath; the typing flows
from your library's schema shape through `AbstractSchema` into the
composable's public surface.

## Validating a single path

`validateAtPath(data, path)` is called with a dotted-string `path` when
the form is asking "is this one field valid right now?". If your
library only exposes full-object parse, you have two options:

1. Run the full parse, filter `issues` by `path`, return only the
   matching issues. This is what the Zod v3 adapter does in some
   places. Simple, correct, but does more work than necessary.

2. Walk your schema tree to find the sub-schema at `path`, then
   validate only the sub-value. This matches what the Zod v4 adapter
   does via `getSchemasAtPath`. Faster but requires knowing your
   library's shape.

Start with option 1 — correctness over speed — and upgrade if
profiling shows it matters.

## Types-only vs runtime constraints

The abstract `useForm` accepts any `AbstractSchema<Form, Form>` — the
type parameter is free. Your adapter is what narrows `Form` to whatever
your schema produces at runtime:

```ts
// Zod v4's zodAdapter uses z.output<Schema>:
type Form = z.output<typeof schema>
// Valibot would be:
type Form = v.InferOutput<typeof schema>
// Hand-rolled:
type Form = { email: string; password: string } // declared explicitly
```

Because the core is schema-agnostic, `useForm`'s return type
(`UseAbstractFormReturnType<Form>`) carries no schema-library-specific
types. The whole surface works identically regardless of which adapter
produced the `AbstractSchema`.

## Testing your adapter

The v4 adapter's test suite (`test/adapters/zod-v4/`) is the template.
Minimum coverage:

- `getInitialState` returns schema defaults when `constraints` is
  absent.
- `getInitialState` merges `constraints` over defaults.
- `validateAtPath` returns `{ success: true }` for valid input.
- `validateAtPath` returns structured `ValidationError[]` for invalid
  input.
- `validateAtPath(undefined)` validates the whole form.

A property test over random forms is useful if your adapter does
non-trivial path walking — `test/core/diff-apply.property.test.ts`
shows the pattern with `@fast-check/vitest`.
