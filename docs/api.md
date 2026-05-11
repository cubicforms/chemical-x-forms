---
title: 'API reference'
description: "Attaform's full API reference — useForm, v-register, parseApiErrors, plus the Zod 3, Zod 4, Vite, and Nuxt entry points in one index."
---

# API reference

Every public export of `attaform`, grouped by subpath. Pick the
entry that matches how you import the library; each page lists
signatures, options, and return shapes.

## `attaform/zod`

The recommended entry — Zod v4 adapter. `useForm`, `zodAdapter`,
`fieldMeta`, `withMeta`, `kindOf`, `assertZodVersion`,
`FieldMetaPayload`, `ZodKind`.

→ [Read `attaform/zod`](/docs/api/zod)

**Recipes that use this:** [Quick start](/docs/quickstart) ·
[Live field validation](/docs/recipes/field-level-validation) ·
[Async validation](/docs/recipes/async-validation) ·
[Discriminated unions](/docs/recipes/discriminated-unions) ·
[Schema-driven coercion](/docs/recipes/coerce) ·
[Blank inputs](/docs/recipes/blank-inputs)

## `attaform/zod-v3`

Zod v3 adapter for projects still on v3. New projects should use `attaform/zod`.

→ [Read `attaform/zod-v3`](/docs/api/zod-v3)

**Recipes that use this:** every Zod 4 recipe applies one-for-one;
the surfaces match. Start at [Quick start](/docs/quickstart).

## `attaform`

Framework-agnostic core. The plugin (`createAttaform`), the
schema-agnostic `useForm`, `injectForm`, the `v-register`
directive and its modifier / transform / custom-assigner surfaces,
SSR helpers, `parseApiErrors`, error codes, the `unset` sentinel.

→ [Read `attaform`](/docs/api/core)

**Recipes that use this:** [Custom schema adapters](/docs/recipes/custom-adapter) ·
[Form context](/docs/recipes/form-context) ·
[Server errors](/docs/recipes/server-errors) ·
[Global defaults](/docs/recipes/app-defaults) ·
[Vue DevTools](/docs/recipes/devtools)

## `attaform/nuxt`

The Nuxt module. Auto-registers everything; `useForm` becomes a
global auto-import.

→ [Read `attaform/nuxt`](/docs/api/nuxt)

**Recipes that use this:** [SSR hydration](/docs/recipes/ssr-hydration) ·
[Global defaults](/docs/recipes/app-defaults) ·
[Persistence](/docs/recipes/persistence)

## `attaform/vite`

The Vite plugin. Required under bare Vue + Vite for SSR-correct
`v-register` bindings.

→ [Read `attaform/vite`](/docs/api/vite)

**Recipes that use this:** [SSR hydration](/docs/recipes/ssr-hydration)
(bare Vue path) · [Custom schema adapters](/docs/recipes/custom-adapter)

## `attaform/transforms`

Raw Vue compiler-core node transforms. Use only when wiring a
custom bundler pipeline.

→ [Read `attaform/transforms`](/docs/api/transforms)

**Recipes that use this:** [Register transforms](/docs/recipes/transforms)

## The useForm return value

The reactive object returned by every `useForm()` call —
`values`, `errors`, `fields`, `setValue`, `register`, `validate*`,
`handleSubmit`, `meta`, `history` (undo/redo), `reset`, field-array
helpers, imperative persistence.

→ [Read the useForm return value](/docs/api/use-form-return)

**Recipes that use this:** [Quick start](/docs/quickstart) ·
[Dynamic field arrays](/docs/recipes/dynamic-field-arrays) ·
[Undo / redo](/docs/recipes/undo-redo) ·
[Focus on error](/docs/recipes/focus-on-error) ·
[Persistence](/docs/recipes/persistence)

## Types

The exported type surface — `FlatPath`, `NestedReadType`,
`FieldState`, `FieldMetaPayload`, `ValidationError`, `FormStorage`,
and the rest.

→ [Read shared types](/docs/api/shared-types)
