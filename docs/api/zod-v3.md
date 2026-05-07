# `attaform/zod-v3`

Zod v3 adapter. Requires `zod@^3`. New projects should use [`/zod`](/docs/api/zod)
(v4).

```ts
import { useForm, zodAdapter, isZodSchemaType, fieldMeta, withMeta } from 'attaform/zod-v3'
import type { FieldMetaPayload } from 'attaform/zod-v3'
```

Same surface as `/zod` for the functions that apply. Helper types
for v3 introspection (`UnwrapZodObject`, `ZodTypeWithInnerType`,
…) are also exported.

## Schema-attached metadata

Use `withMeta(schema, payload)` to attach labels, descriptions, and
placeholders. Read them off `form.fields(path).label` / `.description` /
`.placeholder` / `.meta`:

```ts
import { z } from 'zod'
import { withMeta } from 'attaform/zod-v3'

const schema = z.object({
  email: withMeta(z.string().email(), {
    label: 'Email',
    placeholder: 'you@example.com',
  }),
})
```

Zod 3 has no native registry, so `withMeta` is the only write API on
this adapter (the v4 `schema.register(fieldMeta, ...)` chain doesn't
exist). The shim is a `WeakMap<ZodTypeAny, FieldMetaPayload>` under
the hood; the read surface (`fieldMeta`) is shaped identically to v4
so consumer code that reads `form.fields(p).label` is portable across
both adapters.

Resolution order, `.describe()` interaction, and module-augmentation
extensibility match the v4 adapter — see
[Schema-attached metadata](/docs/api/zod#schema-attached-metadata) for
the precedence table and augmentation pattern.
