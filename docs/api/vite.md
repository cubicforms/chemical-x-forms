---
title: 'attaform/vite — Vite plugin'
description: "Attaform's Vite plugin: injects the v-register transforms into @vitejs/plugin-vue and rewrites attaform/zod imports to the matching Zod-major adapter at build time so your bundle ships exactly one adapter."
---

# `attaform/vite`

A Vite plugin that does two things:

1. **Injects the `v-register` node transforms** into `@vitejs/plugin-vue` — required under bare Vue + Vite for SSR-correct bindings on `<input>`, `<textarea>`, and `<select>`.
2. **Rewrites `attaform/zod` imports at build time** to either [`attaform/zod-v3`](/docs/api/zod-v3) or [`attaform/zod-v4`](/docs/api/zod-v4) based on the consumer's installed Zod major. The bundle ships exactly one adapter — no manual subpath choice.

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
import { attaform } from 'attaform/vite'

export default defineConfig({
  plugins: [vue(), attaform()],
})
```

Place the call after `vue()` in the plugins array. Nuxt projects don't need this — [`attaform/nuxt`](/docs/api/nuxt) installs it for you.

## Options

### `resolveZodAlias`

```ts
attaform({ resolveZodAlias: true | false })
```

Default `true`. When enabled, the plugin reads the consumer's `zod/package.json` at build time, parses the major version, and registers a `resolveId` hook that rewrites every `attaform/zod` import to the matching subpath:

- `zod@^4` → `attaform/zod-v4`
- `zod@^3` → `attaform/zod-v3`

`attaform/zod-v3`, `attaform/zod-v4`, and the root `attaform` import are NEVER rewritten — power users who want to pin a specific subpath, or who want the runtime-dispatch behavior of `attaform/zod`, still get it.

Pass `resolveZodAlias: false` when:

- your project intentionally has both `zod` and `zod-v3` (or another aliased pair) installed and the schema-shape dispatch is the right behavior;
- your monorepo's Zod resolution is non-standard and the plugin's detection (`import.meta.resolve('zod/package.json')`) lands on the wrong copy;
- you want to rely on the unified entry's runtime dispatch for any other reason.

The opt-out also short-circuits the "zod is not installed" build-time error, so a consumer who hasn't installed Zod yet doesn't see that check fire.

## Build-time errors

When `resolveZodAlias` is on (default):

- **Zod is not installed.** Throws `[attaform/vite] zod is not installed.` at `configResolved`. Install `zod@^3` or `zod@^4`, OR pass `resolveZodAlias: false` to bypass the check (and consume the runtime-dispatch unified entry).
- **Zod's `version` field is unparseable** (corrupt package.json, monorepo edge case). Logs a one-time `console.warn` and falls through to runtime dispatch — the build still succeeds, the consumer just ships both adapters.

## See also

- [`attaform/zod`](/docs/api/zod) — the unified entry the plugin's alias hook rewrites.
- [`attaform/nuxt`](/docs/api/nuxt) — the Nuxt module that installs this plugin and the SSR payload bridge in one step.
- [`attaform/transforms`](/docs/api/transforms) — the bare node transforms, for non-Vite bundlers.
