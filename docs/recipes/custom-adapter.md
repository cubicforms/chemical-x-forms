# Plug in your own schema library

Chemical X is schema-agnostic. Zod is just one implementation of
the internal `AbstractSchema` contract. If you're on Valibot,
ArkType, Effect-Schema, or a hand-rolled validator, wire yours in
without forking the library.

## The contract

Seven methods:

```ts
type AbstractSchema<Form, GetValueFormType = Form> = {
  fingerprint(): string
  getDefaultValues(config): DefaultValuesResponse<Form>
  getDefaultAtPath(path: Path): unknown
  getSchemasAtPath(path: Path): AbstractSchema<unknown, GetValueFormType>[]
  getSlimPrimitiveTypesAtPath(path: Path): Set<SlimPrimitiveKind>
  isRequiredAtPath(path: Path): boolean
  validateAtPath(data: unknown, path: Path | undefined): Promise<ValidationResponse<Form>>
}
```

- **`fingerprint()`** — structural signature of the schema. Two
  schemas with the same shape must return the same string; two
  schemas with different shapes should (best-effort) return
  different strings. Used to detect shared-key mismatches AND to
  key persisted drafts — see
  [Fingerprint implementation](#fingerprint-implementation).
- **`getDefaultValues({ useDefaultSchemaValues, constraints, validationMode })`**
  — returns `{ data, errors, success, formKey }`. Called at form
  creation and on `reset()`.
- **`getDefaultAtPath(path)`** — returns the schema-prescribed
  default at a structured path. The runtime calls this on every
  `setValue` to fill structural gaps. See
  [getDefaultAtPath](#getdefaultatpath) below.
- **`getSchemasAtPath(path)`** — returns the list of sub-schemas
  at `path`. `path` is the canonical `Segment[]`, not a dotted
  string. Advanced introspection hook; return `[]` if you don't
  use it.
- **`getSlimPrimitiveTypesAtPath(path)`** — returns the set of
  primitive `typeof`-style kinds the path's leaf accepts at write
  time (`'string'`, `'number'`, `'boolean'`, `'bigint'`, etc.). The
  runtime calls this to gate the slim-primitive write contract.
  Return `PERMISSIVE` for paths the schema doesn't declare so
  dynamic writes don't get rejected.
- **`isRequiredAtPath(path)`** — returns `true` when the leaf is
  required (no `.optional()` / `.nullable()` / `.default()` /
  `.catch()` wrapper). Used by the transient-empty validation
  augmentation to raise `'No value supplied'` for unfilled required
  fields. Return `false` for any wrapper that admits the empty
  case.
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
your schema library is hard to introspect — note that opaque
fingerprints disable schema-change auto-invalidation for
persisted drafts (the key never changes), so prefer a real
structural hash if your library exposes the metadata.

`getDefaultAtPath` must NOT throw. Return `undefined` for paths
that don't exist in the schema; the runtime treats that as
"don't fill" and falls back to the existing data.

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
  DefaultValuesResponse,
  SlimPrimitiveKind,
  ValidationError,
  ValidationResponse,
} from '@chemical-x/forms'
import type { DeepPartial, GenericForm } from '@chemical-x/forms'

// Permissive fallback used by `getSlimPrimitiveTypesAtPath` when the
// schema doesn't declare a path. Adapter-specific — your library's
// supported primitive kinds may differ.
const PERMISSIVE: ReadonlySet<SlimPrimitiveKind> = new Set<SlimPrimitiveKind>([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'date',
  'undefined',
  'null',
])

export function myLibAdapter<F extends GenericForm>(schema: MyLibSchema<F>): AbstractSchema<F, F> {
  return {
    fingerprint() {
      // If your library exposes structural metadata, walk it and
      // hash; the Zod adapters do this. Otherwise, a stable
      // opaque string per schema instance is a valid fallback:
      // it disables cross-instance mismatch detection but never
      // false-positives.
      return schema.signature?.() ?? 'my-lib:v1'
    },

    getDefaultValues({ constraints }): DefaultValuesResponse<F> {
      const defaults = schema.defaultValues()
      const merged = mergeDeepPartial(defaults, constraints)
      return { data: merged, errors: undefined, success: true, formKey: '' }
    },

    getDefaultAtPath(path) {
      // Walk the schema to `path` and return the default at that
      // node. The runtime uses this to fill structural gaps on
      // every setValue (sparse array writes, partial object writes,
      // path-form callback prev auto-default).
      //
      // Concretely: empty path → whole-form default; object property
      // → property's default; array index → element default; tuple
      // position → position's default; optional/nullable around a
      // structural inner → inner default; optional/nullable around
      // a primitive → undefined / null (preserve the wrapper's
      // semantic); .default(x) wrapper → x. Return undefined for
      // paths that don't exist in the schema.
      return walkSchemaToDefault(schema, path)
    },

    getSchemasAtPath(_path) {
      return []
    },

    getSlimPrimitiveTypesAtPath(path) {
      // Return the set of primitive `typeof`-style kinds the leaf
      // at `path` accepts. Pick a sensible permissive fallback for
      // unknown paths — over-rejecting writes here breaks dynamic
      // / SSR-rehydration flows.
      return walkSchemaToSlimPrimitives(schema, path) ?? PERMISSIVE
    },

    isRequiredAtPath(path) {
      // Return true when the leaf is required. A wrapper around the
      // leaf that admits the empty case (Optional, Nullable, Default,
      // Catch) means the leaf is NOT required — return false.
      const leaf = walkSchemaToLeaf(schema, path)
      return leaf !== undefined && !isOptionalLikeWrapper(leaf)
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
          // Pick a stable scope prefix for your adapter and forward
          // the library's issue code under it. Consumers branch on
          // `error.code` for adapter-agnostic UI logic.
          code: `mylib:${issue.code ?? 'unknown'}`,
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
  defaultValues?: DeepPartial<F>
  validationMode?: 'lax' | 'strict'
}) {
  return useAbstractForm<F>({
    schema: myLibAdapter(options.schema),
    key: options.key,
    defaultValues: options.defaultValues,
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

## getDefaultAtPath

The runtime's structural-completeness invariant — every `setValue`
write leaves the form satisfying the slim schema — depends on this
method returning a sane default at any path. Three concrete
runtime callers:

- **`mergeStructural`**, when a partial value-form write hits a
  schema key the consumer didn't supply. Asks for the default at
  the missing sub-path and fills it in.
- **`setAtPathWithSchemaFill`**, when a sparse array write
  (`setValue('posts.21', cb)` against an empty array) needs to pad
  intermediate indices. Asks for the element default once and reuses
  it.
- **Path-form callback prev auto-default**, when the consumer
  writes `setValue('user', prev => ({ ...prev, name: 'X' }))` and
  the slot was previously empty. The runtime calls
  `getDefaultAtPath(['user'])` and feeds the result to the callback.

### The peeling rule

Wrappers around _structural_ types peel; wrappers around
_primitive_ leaves don't:

```ts
// schema.profile is z.object({...}).optional()
getDefaultAtPath(['profile']) // returns { name: '', age: 0 }  — peel
getDefaultAtPath(['profile', 'name']) // returns ''            — peel + descend

// schema.notes is z.string().optional()
getDefaultAtPath(['notes']) // returns undefined  — DO NOT peel
// (peeling would return '' and break mergeStructural — the wrapper's
// "absent allowed" semantic gets lost when filling sibling keys)

// schema.role is z.string().default('user')
getDefaultAtPath(['role']) // returns 'user'  — explicit default wins
```

If your library exposes wrapper introspection, classify each
wrapper-inner combo: `OptionalString` / `NullableNumber` /
`OptionalBoolean` etc. preserve the wrapper semantic; everything
else peels to the inner default.

### Return values for special positions

| Position                     | Return                                      |
| ---------------------------- | ------------------------------------------- |
| Empty path `[]`              | The whole-form default                      |
| Object property `['user']`   | The property's default                      |
| Array index `['posts', 0]`   | Element schema's default — same for any `N` |
| Tuple position `['xy', 1]`   | Position-specific default                   |
| Tuple past length            | `undefined` (signal: don't pad)             |
| Discriminated union root     | First variant's default                     |
| Discriminated union sub-path | Matching variant's value (or first variant) |
| Path doesn't exist in schema | `undefined`                                 |

### Testing

The Zod adapter test suites
(`test/adapters/zod-v4/get-default-at-path.test.ts` and the v3
mirror) double as a behavioural spec — port the cases to your
adapter's test suite. Minimum coverage:

- Object property path returns property's default.
- `.default(x)` wrapper returns `x`.
- Array index path returns element default for any `N`.
- Nested defaults through array → object → array.
- Tuple position-specific defaults; tuple-past-length →
  `undefined`.
- Optional/Nullable around structural inner peels.
- Optional/Nullable around primitive PRESERVES wrapper semantic
  (`undefined`/`null`).
- Discriminated union returns first variant's default at the union
  root.
- Discriminated union descends into the matching variant for
  variant-specific keys.
- Record returns value-type default for any string key.
- Non-existent paths return `undefined`.

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

- `getDefaultValues` returns schema defaults when no `constraints`.
- `getDefaultValues` merges `constraints` over defaults.
- `getDefaultAtPath` returns the property default for object paths.
- `getDefaultAtPath` returns the element default for array indices.
- `getDefaultAtPath` returns the inner default through structural
  wrappers (peels Optional/Nullable around objects; preserves them
  around primitives).
- `getDefaultAtPath` returns `undefined` for paths not in the
  schema.
- `getSlimPrimitiveTypesAtPath` returns the leaf's primitive kinds
  for known paths, and a permissive fallback for unknown paths.
- `isRequiredAtPath` returns `true` for plain leaves and `false`
  for `Optional` / `Nullable` / `Default` / `Catch` wrappers.
- `validateAtPath` returns `{ success: true }` for valid input.
- `validateAtPath` returns structured `ValidationError[]` for
  invalid input — every entry carries a non-empty `code` under
  your chosen scope prefix.
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
`test/core/diff-apply.property.test.ts` shows the pattern. Pair the
adapter tests with the runtime structural-completeness regressions
at `test/composables/set-value-schema-fill-regression.test.ts` —
those drive `getDefaultAtPath` end-to-end through `setValue`, so a
broken adapter implementation surfaces as a test failure with a
clear "schema didn't fill X" diagnostic.
