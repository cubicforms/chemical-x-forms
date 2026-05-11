---
description: 'Time-travel through Attaform form edits: undo and redo across every write, configurable history depth, integrates cleanly with persistence and SSR.'
---

# Undo / redo

```ts
const form = useForm({
  schema,
  key: 'signup',
  history: true, // default: 128-position bounded chain
})
```

Tune the depth:

```ts
useForm({ schema, key: 'signup', history: { max: 200 } })
```

## API

All undo/redo surface lives under `form.history`. Methods and reactive
flags are co-located on one namespace.

| Member                 | Type            | What it does                                                            |
| ---------------------- | --------------- | ----------------------------------------------------------------------- |
| `form.history.undo()`  | `() => boolean` | Step back to the previous state. `false` at baseline (nothing to undo). |
| `form.history.redo()`  | `() => boolean` | Replay the next state after an undo. `false` when nothing's queued.     |
| `form.history.clear()` | `() => void`    | Wipe the undo/redo branches; reseed the chain with the current state.   |
| `form.history.canUndo` | `boolean`       | Gate an "Undo" button on this.                                          |
| `form.history.canRedo` | `boolean`       | Gate a "Redo" button on this.                                           |
| `form.history.size`    | `number`        | Reachable positions across the chain — useful for debug overlays.       |

`form.history` is always present, whether or not `history` was
configured. When it's off, methods are inert no-ops and flags read
`false` / `0`. Templates don't need conditional logic.

## Keyboard shortcuts

Not wired by default — do it in a line:

```vue
<script setup lang="ts">
  const form = useForm({
    schema,
    key: 'editor',
    history: true,
  })

  function onKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
      event.preventDefault()
      event.shiftKey ? form.history.redo() : form.history.undo()
    }
  }
</script>

<template>
  <div @keydown="onKeydown">
    <button :disabled="!form.history.canUndo" @click="form.history.undo">Undo</button>
    <button :disabled="!form.history.canRedo" @click="form.history.redo">Redo</button>
    <!-- …form fields… -->
  </div>
</template>
```

## What gets captured

- Every form value (via `setValue`, register inputs, array helpers).
- The error map at the time of the captured position.
- The blank-paths set (so cleared-but-defaulted numeric fields keep
  showing as empty after an undo, instead of resurrecting their slim
  default).

What's NOT captured:

- **Field records** (touched / focused / blurred / connected) —
  UI interaction history, it shouldn't rewind. A field that was
  touched stays touched.
- **Submission lifecycle** (`meta.submitCount`, `meta.submitError`).
- **Validation in-flight state**.

## What records a position

Every form mutation: `setValue`, `register`-backed input edits, any
array helper (`append`, `prepend`, `insert`, `remove`, `swap`,
`move`, `replace`), or a programmatic write.

Calling `setFieldErrors` / `addFieldErrors` / `clearFieldErrors`
does NOT record — those only touch the error map. Whatever errors
are live when the next mutation lands go into that mutation's
delta.

## clear()

Wipes the undo and redo branches; reseeds the chain with the current
form value as the new baseline. The form state itself (values,
errors, blank paths) stays exactly where it is — only the past and
future history reset.

Useful after a "save successful" milestone, after applying a server-
side fixture, or any point where you want consumers to lose access
to the prior chain without disturbing the rendered form.

```ts
async function onSaveSuccess() {
  await api.commit(form.values())
  // The user can keep editing from here, but they can't undo back
  // through what they typed before hitting Save.
  form.history.clear()
}
```

After `clear()`: `canUndo === false`, `canRedo === false`, `size === 1`
(the current position is still reachable; just nothing on either side
of it).

## Interactions

- **`reset()`** is itself a mutation — the pre-reset state stays
  one undo away. Consumers who want a hard wipe can call
  `form.history.clear()` after `reset()`, or pop a confirmation
  dialog in their UI before calling `reset()`.
- **Live field validation** still runs on undo / redo — the
  restored state validates like any other.
- **Persistence** picks up each undo / redo as a normal mutation
  and writes the restored state to your chosen backend.
- **Persistence hydration** is the floor: once the hydrated value
  applies, the chain reseeds and `undo()` can't reach back into
  the transient pre-hydration default.

## Memory

Default `max: 128` keeps at most 128 reachable positions across the
undo + redo halves combined. Bump it for editors with long
histories; drop it for memory-constrained targets. Internally
history stores one base snapshot plus a chain of forward deltas
(per-mutation `Patch[]` from the diff machinery), so each
additional position costs `O(changed-leaf-count)` — typing one
character into one field allocates a single patch, not a clone of
the whole form.
