---
title: 'attaform/zod — unified Zod entry'
description: 'The unified Zod entry for Attaform. Auto-detects the installed Zod major and routes to the matching adapter — `attaform/zod` for the recommended hello-world path, with build-time alias when the Vite plugin is active and runtime dispatch as a graceful fallback.'
---

# `attaform/zod`

The unified Zod entry. Same import for Zod 3 and Zod 4 projects — the runtime checks the schema's shape and routes to the matching adapter.

```ts
import { useForm, fieldMeta, withMeta } from 'attaform/zod'
import { z } from 'zod'

const form = useForm({ schema: z.object({ email: z.email() }) })
```

This is THE recommended import for new projects. Use it whenever you don't have a specific reason to pin one Zod major.

## How resolution works

Three tiers, picked in order:

1. **Build-time alias (preferred).** When the [`attaform/vite`](/docs/api/vite) plugin is installed, it reads your `zod/package.json` at build time and rewrites every `attaform/zod` import to either [`attaform/zod-v3`](/docs/api/zod-v3) or [`attaform/zod-v4`](/docs/api/zod-v4). Your bundle ships exactly one adapter — same DX, smaller payload. Nuxt projects get this automatically via `attaform/nuxt`.
2. **Runtime dispatch (fallback).** Without the Vite plugin (other bundlers, plain ESM consumption), `useForm` checks `schema.def?.type` (Zod 4) or `schema._def?.typeName` (Zod 3) at call time and routes to the matching adapter. The bundle ships both adapters; the size cost is modest but real.
3. **Explicit subpath (escape hatch).** Import directly from [`attaform/zod-v3`](/docs/api/zod-v3) or [`attaform/zod-v4`](/docs/api/zod-v4) when you want a guaranteed lean bundle on a non-Vite bundler, or when you intentionally run both Zod majors side by side.

The Vite plugin's [`resolveZodAlias: false`](/docs/api/vite#resolvezodalias) opts out of step 1 if you need the dispatch fallback even with Vite.

## What this entry exports

```ts
import {
  useForm,
  injectForm,
  useRegister,
  fieldMeta,
  withMeta,
  unset,
  isUnset,
  AttaformErrorCode,
} from 'attaform/zod'
import type { FieldMetaPayload, Unset } from 'attaform/zod'
```

| Export                                      | What it does                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `useForm`                                   | Runtime-dispatching wrapper. Type signature targets Zod 4. See [usage](#useform).       |
| `injectForm`, `useRegister`                 | Schema-agnostic — identical across the two adapters.                                    |
| `fieldMeta`, `withMeta`, `FieldMetaPayload` | Re-exported from the v4 adapter; see [Caveats](#caveats) for the runtime-dispatch case. |
| `unset`, `isUnset`, `Unset`                 | Sentinel for "displayed empty"; identical across adapters.                              |
| `AttaformErrorCode`                         | Library-emitted error-code enum (`atta:*`).                                             |

For `zodAdapter`, `kindOf`, `assertZodVersion`, `ZodKind`, and `UnsupportedSchemaError` — the surfaces that diverge between v3 and v4 — use the [`attaform/zod-v3`](/docs/api/zod-v3) or [`attaform/zod-v4`](/docs/api/zod-v4) explicit subpath.

## `useForm`

Same surface as the per-major adapters. See [The useForm return value](/docs/api/use-form-return) for the full return shape, and the [`attaform/zod-v4`](/docs/api/zod-v4#useformschemaoptions) page for the option table — the unified entry's signature targets Zod 4.

```ts
const form = useForm({
  schema: z.object({ email: z.email() }),
  key: 'signup',
})
```

When the build-time alias is in play, the consumer's bundled code resolves to the explicit subpath's full-strength types. Without the alias, TypeScript inference comes from the Zod 4 typings — a Zod 3 consumer gets correct runtime behavior but slightly weaker inference.

## Schema-attached metadata

`fieldMeta` and `withMeta` are re-exported from the v4 adapter. Same surface as documented in [`attaform/zod-v4` § Schema-attached metadata](/docs/api/zod-v4#schema-attached-metadata).

## Caveats

- **`fieldMeta` shape on Zod 3 without the Vite plugin.** Without the build-time alias, the unified entry exports the v4 `fieldMeta` registry. The v4 registry's `getFieldMetaList` helper isn't available on Zod 3. If you're on Zod 3 and not using Vite, import `fieldMeta` from [`attaform/zod-v3`](/docs/api/zod-v3) directly.
- **Both Zod versions installed.** Aliasing both `zod` and `zod-v3` (or similar) bypasses the Vite plugin's detection — pass `attaform({ resolveZodAlias: false })` and consume the runtime dispatch, or import the explicit subpath at every call site.
- **TypeScript inference.** The unified entry's `useForm` signature targets Zod 4. With the build-time alias, the consumer's code is rewritten to the explicit subpath, so post-build inference is exact. Without it, Zod 3 consumers should reach for [`attaform/zod-v3`](/docs/api/zod-v3) for the strongest inference.

## See also

- [`attaform/zod-v3`](/docs/api/zod-v3) — explicit Zod 3 subpath. Pin v3, ship a single adapter on any bundler.
- [`attaform/zod-v4`](/docs/api/zod-v4) — explicit Zod 4 subpath. Pin v4, ship a single adapter on any bundler.
- [`attaform/vite`](/docs/api/vite) — the Vite plugin that drives the build-time alias.
