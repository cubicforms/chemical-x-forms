# Plug in your own schema library

Chemical X is schema-agnostic. Zod is just one implementation of
the internal `AbstractSchema` contract. If you're on Valibot,
ArkType, Effect-Schema, or a hand-rolled validator, wire yours in
without forking the library.

## The contract

Three methods:

```ts
type AbstractSchema<Form, GetValueFormType = Form> = {
  getInitialState(config): InitialStateResponse<Form>
  getSchemasAtPath(path: string | Path): readonly unknown[]
  validateAtPath(data: unknown, path: string | undefined): Promise<ValidationResponse<Form>>
}
```

- **`getInitialState({ useDefaultSchemaValues, constraints, validationMode })`**
  — returns `{ data, errors, success, formKey }`. Called at form
  creation and on `reset()`.
- **`getSchemasAtPath(path)`** — returns the list of sub-schemas
  at `path`. Advanced introspection hook; return `[]` if you don't
  use it.
- **`validateAtPath(data, path?)`** — returns
  `Promise<ValidationResponse>`. When `path` is `undefined`,
  validate the whole form.

`validateAtPath` must NOT throw. Return `{ success: false, errors
}` for validation failures; return (or reject with) a synthetic
error only if your parser is genuinely misbehaving.

## A minimal Valibot-ish adapter

Assume your library exposes:

- `schema.defaultValues()` returning the schema's typed defaults.
- `schema.parse(data)` returning
  `{ success: true, data }` or
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
  schema: MyLibSchema<F>,
): AbstractSchema<F, F> {
  return {
    getInitialState({ constraints }): InitialStateResponse<F> {
      const defaults = schema.defaultValues()
      const merged = mergeDeepPartial(defaults, constraints)
      return { data: merged, errors: undefined, success: true, formKey: '' }
    },

    getSchemasAtPath(_path) {
      return []
    },

    async validateAtPath(data, _path): Promise<ValidationResponse<F>> {
      const result = schema.parse(data)
      if (result.success) {
        return { data: result.data as F, errors: undefined, success: true, formKey: '' }
      }
      return {
        data: undefined,
        errors: result.issues.map<ValidationError>((issue) => ({
          path: issue.path,
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
  // Dependency-free deep merge; see test/utils/fake-schema.ts for a
  // reference implementation.
}
```

Leave `formKey` as `''` — the composable stamps the real key in.

`validateAtPath` is declared `async` so the return type is
automatically Promise-wrapped. Sync-under-the-hood parsers pay one
microtask and the caller's code works identically.

## Wire it to useForm

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

Consumers call your `useForm({ schema, key })` exactly like the Zod
one. The typing flows from your schema shape through
`AbstractSchema` into the public API.

## Validating a single path

When the library needs to re-check just one field, it passes a
dotted `path`. Two implementation strategies:

1. **Full parse + filter issues** — run the whole parse, return
   only the issues that match. Simpler; extra work per call.
2. **Walk to the sub-schema, validate only that** — matches the
   Zod v4 adapter's approach. Faster; needs your library's
   introspection.

Start with (1). Upgrade if profiling shows it matters.

## Type inference

The abstract `useForm` accepts any `AbstractSchema<Form, Form>`.
Your adapter is what pins `Form` to whatever your schema produces:

```ts
// Zod v4:
type Form = z.output<typeof schema>
// Valibot:
type Form = v.InferOutput<typeof schema>
// Hand-rolled:
type Form = { email: string; password: string }
```

`useForm`'s return type (`UseAbstractFormReturnType<Form>`)
carries no schema-library-specific types — the public surface is
identical regardless of adapter.

## Testing your adapter

Minimum coverage:

- `getInitialState` returns schema defaults when no `constraints`.
- `getInitialState` merges `constraints` over defaults.
- `validateAtPath` returns `{ success: true }` for valid input.
- `validateAtPath` returns structured `ValidationError[]` for invalid input.
- `validateAtPath(undefined)` validates the whole form.

The v4 adapter's test suite (`test/adapters/zod-v4/`) is the
template. Add a fast-check property test over random forms if your
adapter does non-trivial path walking —
`test/core/diff-apply.property.test.ts` shows the pattern.
