# Vue DevTools integration

`@chemical-x/forms` ships a DevTools plugin that surfaces your
forms inside the Vue DevTools panel — one inspector node per
registered form, plus a timeline layer that logs submit / reset
events.

## Setup

The plugin is wired automatically when `@vue/devtools-api` is
installed as a peer dependency. Nothing to import or call:

```ts
// main.ts
import { createApp } from 'vue'
import { createChemicalXForms } from '@chemical-x/forms'
import App from './App.vue'

createApp(App)
  .use(createChemicalXForms()) // devtools: true by default
  .mount('#app')
```

Install the peer dep:

```bash
pnpm add -D @vue/devtools-api
```

Supports both DevTools v6 and v7 (`@vue/devtools-api` v6.6+).

## Disabling

Pass `{ devtools: false }` to skip the lazy import entirely — the
form runtime works without DevTools, and there's no benefit to
loading the plugin in production if you've kept the peer dep
installed in prod deps by mistake:

```ts
import.meta.env.PROD
  ? createChemicalXForms({ devtools: false })
  : createChemicalXForms()
```

If the peer dep isn't installed, the lazy import fails silently —
no warnings, no overhead beyond the one failed module fetch.

## What you see

### Inspector tree

`Chemical X Forms` appears in the DevTools sidebar alongside
"Pinia", "Router", etc. Expand it to see one node per registered
form, keyed by the form's `key`. Select a form to view:

- **Form value** — the current `form.value` as a JSON tree.
  Editable from DevTools UI; changes push through
  `state.setValueAtPath`, firing `onFormChange` and the rest of
  the reactive pipeline.
- **Errors** — the error map (keyed by path).
- **Aggregates** — `isSubmitting`, `submitCount`, `submitError`,
  `activeValidations`.

### Timeline

A dedicated "Chemical X Forms" timeline layer logs events:

| Event            | Fires on                                                        |
| ---------------- | --------------------------------------------------------------- |
| `form.change`    | Every `applyFormReplacement` — every mutation through `setValue` / field arrays / register-backed inputs / undo+redo. |
| `submit.success` | After a submit handler's `onSubmit` resolves.                    |
| `reset`          | After `reset()` completes.                                       |

Hover a timeline event to see the form state at the moment it
fired.

## Production bundle

The DevTools module is loaded via `import('./devtools')` inside
the plugin install — bundlers emit it as a separate chunk. If
`options.devtools === false`, the dynamic import never fires at
runtime. If the peer dep isn't installed, the import throws and
the catch suppresses it.

The chunk itself is ~2 KB gzip (under the main entry's 12 KB
budget). For a zero-overhead production bundle, combine
`{ devtools: false }` with NOT installing `@vue/devtools-api` in
your `dependencies` list — keep it in `devDependencies` only.

## Not supported (yet)

- **Per-field field-record state** (touched / focused / blurred).
  The inspector shows the value + errors; UI-interaction history
  is omitted for clarity.
- **History stack visualization.** If `history` is enabled, the
  timeline's `form.change` entries reflect each snapshot, but the
  stack itself isn't a separate inspector node. Bump the feature
  request if your undo UX needs this.
- **Persisted payload preview.** Persistence writes on a timer;
  inspecting the current in-flight state works, but the
  serialized payload isn't surfaced. Read localStorage /
  sessionStorage / IndexedDB directly in Application > Storage
  for that.

## Caveats

- **The DevTools surface is best-effort.** Mutating form values
  through the inspector bypasses whatever UI binding the
  component usually drives — fine for debugging, but don't rely
  on the DevTools path mirroring production behaviour exactly.
- **Multi-app setups.** The plugin registers one inspector per
  Vue app. If you have multiple apps with their own registries,
  you'll see separate inspector entries.
