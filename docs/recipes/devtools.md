# Vue DevTools

Every registered form shows up in the Vue DevTools sidebar with an
editable tree, an error view, and a timeline for submit / reset /
mutation events.

## Setup

Install the peer dep:

```bash
npm install -D @vue/devtools-api
```

That's it — the plugin auto-wires when the dep is present:

```ts
// main.ts
createApp(App)
  .use(createAttaform()) // devtools: true by default
  .mount('#app')
```

Supports DevTools v6 and v7 (`@vue/devtools-api` v6.6+).

## Disabling

Skip the wiring in production, keep it in dev:

```ts
import.meta.env.PROD ? createAttaform({ devtools: false }) : createAttaform()
```

If the peer dep isn't installed at runtime, nothing breaks — the
plugin silently skips setup.

## What you see

### Inspector

`Attaform` shows up alongside "Pinia", "Router", etc.
Expand it to see one node per registered form (keyed by the form's
`key`). Select a form to view:

- **Form value** — the current form as a JSON tree. Editable from
  the DevTools UI; your edit flows through `setValue` and drives
  the whole reactive pipeline (validation, persistence, history).
- **Errors** — the error map keyed by path.
- **Aggregates** — the `state` bundle (`isDirty`, `isValid`,
  `isSubmitting`, `isValidating`, `submitCount`, `submitError`,
  `canUndo`, `canRedo`, `historySize`).

### Timeline

A "Attaform" timeline layer logs:

| Event            | Fires on                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| `form.change`    | Every mutation — register inputs, `setValue`, array helpers, undo / redo. |
| `submit.success` | A submit handler's `onSubmit` resolves.                                   |
| `reset`          | `reset()` completes.                                                      |

Hover a timeline event to see the form state at that moment.

## Keeping production bundles clean

The DevTools module is code-split — bundlers emit it as a separate
chunk, and the dynamic `import()` only fires when `devtools: true`.
For a zero-overhead production build:

1. Pass `{ devtools: false }`.
2. Keep `@vue/devtools-api` in `devDependencies`, not `dependencies`.

## Not included (yet)

- **Field flags** (touched / focused / blurred). The inspector
  shows values + errors; UI interaction state is omitted.
- **History stack visualisation.** Undo / redo snapshots show on
  the timeline via `form.change` entries, but the stack itself
  isn't a separate node. Open an issue if your editor workflow
  needs it.
- **Persisted payload preview.** Inspect the live form state in
  the inspector; for the serialised payload on disk, open
  Application → Storage in the browser devtools.

## Caveats

- **DevTools edits bypass your component bindings.** Fine for
  poking at state during debugging; don't rely on the path
  mirroring production interaction exactly.
- **Multi-app setups.** Each Vue app registers its own inspector
  entry.
