---
title: 'attaform/zod-v3 — Zod 3 adapter'
description: 'Use Attaform with Zod 3 schemas: full API parity with the Zod 4 adapter, no rewrites needed for existing Vue or Nuxt projects on Zod 3.'
---

# `attaform/zod-v3`

Explicit Zod v3 adapter subpath. Use this when you want to pin v3 regardless of what your bundler resolves — handy for non-Vite bundlers (webpack, esbuild standalone, Rollup) where you'd otherwise pay for both adapters via the unified [`attaform/zod`](/docs/api/zod) entry's runtime fallback.

Most Vite consumers should import from `attaform/zod` instead — the [`attaform/vite`](/docs/api/vite) plugin rewrites that import to this subpath at build time when `zod@^3` is detected, so the same lean bundle ships with less ceremony.

Requires `zod@^3`.

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
