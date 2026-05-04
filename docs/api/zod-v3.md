# `attaform/zod-v3`

Zod v3 adapter. Requires `zod@^3`. New projects should use [`/zod`](/docs/api/zod)
(v4).

```ts
import { useForm, zodAdapter, isZodSchemaType } from 'attaform/zod-v3'
```

Same surface as `/zod` for the functions that apply. Helper types
for v3 introspection (`UnwrapZodObject`, `ZodTypeWithInnerType`,
…) are also exported.
