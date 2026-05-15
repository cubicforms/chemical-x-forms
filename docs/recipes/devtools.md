---
description: 'Inspect Attaform forms at runtime through the Nuxt DevTools overlay or Vue DevTools extension: form state, errors, history, persistence drafts, and per-field meta in real time.'
---

# DevTools

Every registered form shows up in your browser DevTools — values,
errors, aggregates, and a timeline of every change — through one of two
surfaces, depending on what the project uses.

| Surface                      | Where it lives                         | Install                                                   |
| ---------------------------- | -------------------------------------- | --------------------------------------------------------- |
| **Nuxt DevTools overlay**    | Bottom of the dev page                 | Nothing — wired by `attaform/nuxt`.                       |
| **Vue DevTools (extension)** | Chrome / Edge / Firefox devtools panel | [Install from the web store](https://devtools.vuejs.org). |

Both surfaces render the same data: the four sections below, plus a
timeline of `form.change` / `submit.success` / `reset` events.

## Nuxt DevTools — first-class native panel

For Nuxt apps, the integration is automatic — installing `attaform/nuxt`
adds an **Attaform** tab to the Nuxt DevTools sidebar (alongside
Pages / Components / Modules). No peer dep to add, no extension to
install, no Vite plugin to configure.

```ts
// nuxt.config.ts — no devtools-specific config needed
export default defineNuxtConfig({
  modules: ['attaform/nuxt'],
  devtools: { enabled: true },
})
```

Open the overlay with `Shift + Option + D` (or click the Nuxt logo in
the bottom corner) and select **Attaform** in the sidebar. The tab is
dev-only — production builds skip the route injection and the
`@nuxt/devtools-kit` import entirely.

## Vue DevTools (Chrome extension)

For Vite / bare-Vue projects (or as an alternative on Nuxt), install
the optional peer dep:

```bash
npm install -D @vue/devtools-api
```

The library auto-wires the inspector + timeline when the dep is
present:

```ts
// main.ts
createApp(App)
  .use(createAttaform()) // devtools: true by default
  .mount('#app')
```

If the peer dep isn't installed at runtime, nothing breaks — the
inspector simply doesn't register, the form library works as usual.

For production builds, gate the wiring off:

```ts
import.meta.env.PROD ? createAttaform({ devtools: false }) : createAttaform()
```

## What you see

### Form list

One entry per registered form, keyed by the form's `key`. Click a form
to inspect it.

### Form value

The current form as an interactive JSON tree. **Editable from the
panel** — your edit flows through `setValueAtPath` and drives the
whole reactive pipeline (validation, persistence opt-in, history).

Values render verbatim. DevTools is dev-only, so the panel doesn't
mask passwords / tokens / secrets — debugging a credential flow
typically needs the actual value. The sensitive-name heuristic still
applies elsewhere in the library (persistence writes, multi-tab
broadcasts), it's just not applied to the dev surface. Close the
panel before a screen share if a value would be sensitive on camera,
same hygiene as the browser's own DevTools console.

### Schema Errors / User Errors

The error map keyed by path, split by source:

- **Schema Errors** — what the validator (Zod adapter) produced.
  Cleared by `reset()` / `handleSubmit` success.
- **User Errors** — what you wrote via `setFieldErrors*` / the
  `parseApiErrors` server-error pipeline. Persists across revalidation
  and successful submits.

Splitting them tells you instantly whether validation or your
application code emitted each error.

### Aggregates

The reactive bundle:

- `submitting`
- `submitCount`
- `submitError`
- `activeValidations`

Useful for confirming your loading-state wiring is reading the right
reactive thing.

### Timeline

A scrollable log of recent events. Each entry shows a timestamp, an
event type, and the form key, with the form value at the moment of
fire (redacted) available on click.

| Event            | Fires on                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| `form.change`    | Every mutation — register inputs, `setValue`, array helpers, undo / redo. |
| `submit.success` | A submit handler's `onSubmit` resolves.                                   |
| `reset`          | `reset()` completes.                                                      |

Capacity is capped at 200 events per session — older entries fall off
the back. Hit **clear** to wipe the log mid-debug.

## Keeping production bundles clean

The Nuxt overlay tab is dev-gated at the module level — production
builds skip the route injection and never import `@nuxt/devtools-kit`.
The Vue DevTools wire-up is dev-gated at the `createAttaform({ devtools })`
boundary and code-split so the chunk isn't pulled in when `devtools:
false`.

For a zero-overhead production build:

1. Pass `{ devtools: false }` to `createAttaform` for bare-Vue setups
   (Nuxt apps don't need this — the module already gates dev-only).
2. Keep `@vue/devtools-api` in `devDependencies`, not `dependencies`.

## Coming soon

- **Field flags** (touched / focused / blurred) in the inspector —
  values + errors are surfaced today, UI interaction state isn't.
- **History stack visualisation.** Undo / redo snapshots show on the
  timeline via `form.change` entries; the stack itself isn't a
  separate node yet. Open an issue if your editor workflow needs it.
- **Persisted payload preview.** Inspect live form state in the
  inspector; for the serialised payload on disk, open Application →
  Storage in the browser devtools.

## Caveats

- **Panel edits bypass your component bindings.** Fine for poking at
  state during debugging; don't rely on the path mirroring production
  interaction exactly.
- **Multi-app setups.** Each Vue app registers its own inspector
  entry in the extension. The Nuxt overlay panel reads from the most
  recent `createAttaform()` install — micro-frontend setups with
  parallel apps will only see one app's forms.
- **Screen-share hygiene.** Since the panel renders raw values,
  passwords / tokens / API keys are visible while it's open. Close
  the panel before screen-sharing, the same way you'd close the
  browser DevTools console.
