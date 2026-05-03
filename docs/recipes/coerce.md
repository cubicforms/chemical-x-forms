# Schema-driven coercion

cx coerces user-typed DOM values to the schema's slim type at the
directive layer — `'25'` → `25` for a `z.number()` slot, `'true'` →
`true` for a `z.boolean()` slot. The schema is authoritative for
storage shape; consumers stop sprinkling `.number` modifiers across
templates.

Coercion is **on by default** with the built-in `defaultCoercionRules`
(`string→number`, `string→boolean`). Programmatic writes
(`form.setValue`, `setValueWithInternalPath`) are NEVER coerced —
coercion is user-input-only.

## Default in action

```ts
const schema = z.object({
  age: z.number(),
  isAdmin: z.boolean(),
})

const form = useForm({ schema })
```

```vue
<input v-register="form.register('age')" />
<!-- type "25", form.values.age === 25 (a number) -->

<input v-register="form.register('isAdmin')" />
<!-- type "true", form.values.isAdmin === true (a boolean) -->
```

## Disabling

```ts
useForm({ schema, coerce: false })
```

Without coercion the slim-primitive gate rejects type mismatches
with a dev-mode warning; the write doesn't land. Useful when you
want every typed-string write to fail loudly rather than silently
become a number.

## Adding a custom rule

`defineCoercion` narrows the `transform` parameter so you don't
have to cast inside the body. Spread `defaultCoercionRules` to
extend rather than replace:

```ts
import { defineCoercion, defaultCoercionRules } from 'attaform'
import type { CoercionRegistry } from 'attaform'

const stringToBigint = defineCoercion({
  input: 'string',
  output: 'bigint',
  transform: (s) => {
    const trimmed = s.trim()
    if (trimmed === '') return { coerced: false }
    try {
      return { coerced: true, value: BigInt(trimmed) }
    } catch {
      return { coerced: false } // not a valid bigint literal
    }
  },
})

const myRegistry: CoercionRegistry = [...defaultCoercionRules, stringToBigint]

useForm({ schema, coerce: myRegistry })
```

Returning `{ coerced: false }` is the "this rule doesn't apply"
signal — the write passes through untouched. Use it for
empty-input / out-of-range / parse-failure cases; leaving the
write as-is lets the schema's refinement layer surface a
ValidationError instead of synthesising a wrong value.

## Replacing the defaults entirely

Pass a registry without spreading the defaults:

```ts
useForm({ schema, coerce: [stringToBigint] })
// string→number and string→boolean are NOT registered.
```

cx never merges past the array boundary — passing a registry is a
"replace" operation by design.

## App-level default

Set once via the plugin (matches the per-form shape):

```ts
createAttaform({
  defaults: { coerce: [...defaultCoercionRules, stringToBigint] },
})
```

Per-form `useForm({ coerce })` overrides the plugin default per
form (replace, not merge — same semantics as everywhere else in
cx).

## Pipeline ordering

For a single user-typed write, cx applies (in order):

```
DOM event → modifier cast → coerce → transforms[0..n] → assigner
```

Modifier casts (`.number`, `.trim`) come from the directive itself;
they fire before coerce. `transforms` (see
[transforms recipe](./transforms.md)) fire after coerce. The
assigner is the last step before storage.

## What's NOT coerced

- **Programmatic writes** — `form.setValue('age', '25')` does NOT
  coerce. The slim-primitive gate rejects the string write
  (programmatic writes are authoritative; the caller's typing is
  on them).
- **`form.reset()`** / hydration / SSR replay — already
  schema-conformant; running coerce would be redundant.
- **Refinement-failure cases** — coerce only retypes between slim
  primitive kinds. A `string→number` coerce produces a number;
  a `z.number().min(18)` schema then validates, and a typed `'5'`
  becomes `5` and surfaces as a refinement error.

## When the rule's output disagrees with the schema

If the schema accepts BOTH the input and output kinds at a path
(`z.union([z.string(), z.number()])`), coercion is silently
skipped at that path — the schema's union is an explicit
"either is fine" signal, and silent retyping would surprise.
The user-typed string lands as-is, and the schema picks the
matching branch.

If the rule's `transform` returns a value whose runtime kind
doesn't match the declared `output`, the write passes through
untouched and a dev-mode warning surfaces. Post-validation
defends against buggy consumer rules without forcing every
rule body to validate itself.
