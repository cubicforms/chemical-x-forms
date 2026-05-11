---
description: 'Time-travel through Attaform form edits: undo and redo across every write, configurable history depth, integrates cleanly with persistence and SSR.'
---

# Undo / redo

```ts
const form = useForm({
  schema,
  key: 'signup',
  history: true, // default: 128-snapshot bounded stack
})
```

Tune the depth:

```ts
useForm({ schema, key: 'signup', history: { max: 200 } })
```

## API

| Member             | Type            | What it does                                                            |
| ------------------ | --------------- | ----------------------------------------------------------------------- |
| `undo()`           | `() => boolean` | Step back to the previous state. `false` at baseline (nothing to undo). |
| `redo()`           | `() => boolean` | Replay the next state after an undo. `false` when nothing's queued.     |
| `meta.canUndo`     | `boolean`       | Gate an "Undo" button on this.                                          |
| `meta.canRedo`     | `boolean`       | Gate a "Redo" button on this.                                           |
| `meta.historySize` | `number`        | Reachable positions across the chain — useful for debug overlays.       |

`undo()` and `redo()` are top-level methods; the three flags live
on the `meta` reactive bundle alongside the rest of the form-level
aggregates. When `history` isn't configured, all five members are
still present but inert: methods return `false`, flags read `false`
/ `0`. Templates don't need conditional logic.

## Keyboard shortcuts

Not wired by default — do it in a line:

```vue
<script setup lang="ts">
  const { undo, redo, meta } = useForm({
    schema,
    key: 'editor',
    history: true,
  })

  function onKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
      event.preventDefault()
      event.shiftKey ? redo() : undo()
    }
  }
</script>

<template>
  <div @keydown="onKeydown">
    <button :disabled="!meta.canUndo" @click="undo">Undo</button>
    <button :disabled="!meta.canRedo" @click="redo">Redo</button>
    <!-- …form fields… -->
  </div>
</template>
```

## What gets snapshotted

- Every form value (via `setValue`, register inputs, array helpers).
- The error map at the time of the snapshot.

What's NOT snapshotted:

- **Field records** (touched / focused / blurred / connected) —
  UI interaction history, it shouldn't rewind. A field that was
  touched stays touched.
- **Submission lifecycle** (`meta.submitCount`, `meta.submitError`).
- **Validation in-flight state**.

## What pushes a snapshot

Every form mutation: `setValue`, `register`-backed input edits, any
array helper (`append`, `prepend`, `insert`, `remove`, `swap`,
`move`, `replace`), or a programmatic write.

Calling `setFieldErrors` / `addFieldErrors` / `clearFieldErrors`
does NOT push — those only touch the error map.
Whatever errors are live when the next mutation lands go into that
mutation's snapshot.

## Interactions

- **`reset()`** is itself a mutation — the pre-reset state stays
  one undo away. Consumers who want a hard wipe can pop a
  confirmation dialog in their UI before calling `reset()`.
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
