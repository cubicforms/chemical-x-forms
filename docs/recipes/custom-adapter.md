# Plug in your own schema library

Chemical X is schema-agnostic. Zod is just one implementation of
the internal `AbstractSchema` contract. If you're on Valibot,
ArkType, Effect-Schema, or a hand-rolled validator, wire yours in
without forking the library.

## The contract

Four methods:

```ts
type AbstractSchema<Form, GetValueFormType = Form> = {
  fingerprint(): string
  getInitialState(config): InitialStateResponse<Form>
  getSchemasAtPath(path: Path): AbstractSchema<unknown, GetValueFormType>[]
  validateAtPath(data: unknown, path: Path | undefined): Promise<ValidationResponse<Form>>
}
```

- **`fingerprint()`** — structural signature of the schema. Two
  schemas with the same shape must return the same string; two
  schemas with different shapes should (best-effort) return
  different strings. Used to detect shared-key mismatches — see
  [Fingerprint implementation](#fingerprint-implementation).
- **`getInitialState({ useDefaultSchemaValues, constraints, validationMode })`**
  — returns `{ data, errors, success, formKey }`. Called at form
  creation and on `reset()`.
- **`getSchemasAtPath(path)`** — returns the list of sub-schemas
  at `path`. `path` is the canonical `Segment[]`, not a dotted
  string. Advanced introspection hook; return `[]` if you don't
  use it.
- **`validateAtPath(data, path?)`** — returns
  `Promise<ValidationResponse>`. `path` is a `Segment[]` or
  `undefined` (whole-form validation).

`validateAtPath` must NOT throw. Return `{ success: false, errors
}` for validation failures; return (or reject with) a synthetic
error only if your parser is genuinely misbehaving.

`fingerprint` must NOT throw either. If it does, the library
catches the exception, logs it via `console.error` in dev, and
skips the shared-key mismatch check for that call. An opaque
stable string (`'custom-adapter:v1'`) is a valid fallback when
your schema library is hard to introspect.

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
    fingerprint() {
      // If your library exposes structural metadata, walk it and
      // hash; the Zod adapters do this. Otherwise, a stable
      // opaque string per schema instance is a valid fallback:
      // it disables cross-instance mismatch detection but never
      // false-positives.
      return schema.signature?.() ?? 'my-lib:v1'
    },

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

## Fingerprint implementation

The library calls `fingerprint()` when a second `useForm({ key:
'x', schema })` call lands on an already-resolved FormStore.
Matching strings → the shared-store semantic is intentional, stay
silent. Differing strings → dev-mode warning that names both
fingerprints; the first caller's schema stays canonical, the
second is silently ignored. Shared-store without a key collision
means one party sees stale shape information — the warning tells
you you probably wanted distinct keys.

Required guarantees:

- **Determinism.** Equal shapes at different memory addresses
  must produce the same string. Most adapters live across module
  boundaries, so reference identity fails ~99% of the time.
- **Key-order insensitivity** for record-like shapes — two
  objects with the same fields in different declaration order
  must match.
- **Membership-order insensitivity for unions** — `a | b` and
  `b | a` must match.

Acceptable compromises:

- Function-valued metadata (`refine(fn)`, `transform(fn)`, lazy
  factory defaults) is not stably hashable. Collapse it to an
  opaque sentinel (`'fn:*'`) — two schemas differing only in
  refinement logic will look identical, which is a documented
  false-negative, not a bug. The warning is a footgun catcher,
  not a soundness guarantee.
- Cycles (lazy / self-referential schemas). Track an ancestor
  set and emit a fixed `'<cyclic>'` sentinel on re-entry.

If your schema library has no introspection surface, returning a
stable per-instance opaque string (`'my-lib:v1'` computed once
per adapter build) is a legal implementation — it disables
cross-instance mismatch detection but never false-positives.

See `src/runtime/adapters/zod-v4/fingerprint.ts` for a full
walker with factory-default idempotence and shared-reference
handling.

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
- `fingerprint()` is stable across calls on the same schema.
- `fingerprint()` matches for two schemas with the same shape but
  different key-declaration order (and different union member
  order, if you support unions).
- `fingerprint()` differs for schemas with different leaf types
  or missing fields.

The v4 adapter's test suite (`test/adapters/zod-v4/`) is the
template. Add a fast-check property test over random forms if your
adapter does non-trivial path walking —
`test/core/diff-apply.property.test.ts` shows the pattern.
