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

## `attaform/zod-v3`

Zod v3 adapter for projects still on v3. New projects should use `attaform/zod`.

→ [Read `attaform/zod-v3`](/docs/api/zod-v3)

## `attaform`

Framework-agnostic core. The plugin (`createAttaform`), the
schema-agnostic `useForm`, `injectForm`, the `v-register`
directive and its modifier / transform / custom-assigner surfaces,
SSR helpers, `parseApiErrors`, error codes, the `unset` sentinel.

→ [Read `attaform`](/docs/api/core)

## `attaform/nuxt`

The Nuxt module. Auto-registers everything; `useForm` becomes a
global auto-import.

→ [Read `attaform/nuxt`](/docs/api/nuxt)

## `attaform/vite`

The Vite plugin. Required under bare Vue + Vite for SSR-correct
`v-register` bindings.

→ [Read `attaform/vite`](/docs/api/vite)

## `attaform/transforms`

Raw Vue compiler-core node transforms. Use only when wiring a
custom bundler pipeline.

→ [Read `attaform/transforms`](/docs/api/transforms)

## The useForm return value

The reactive object returned by every `useForm()` call —
`values`, `errors`, `fields`, `setValue`, `register`, `validate*`,
`handleSubmit`, `meta`, `reset`, undo/redo, field-array helpers,
imperative persistence.

→ [Read the useForm return value](/docs/api/use-form-return)

## Types

The exported type surface — `FlatPath`, `NestedReadType`,
`FieldState`, `FieldMetaPayload`, `ValidationError`, `FormStorage`,
and the rest.

→ [Read shared types](/docs/api/shared-types)
