# Undo / redo

```ts
const form = useForm({
  schema,
  key: 'signup',
  history: true, // default: 50-snapshot bounded stack
})
```

Tune the depth:

```ts
useForm({ schema, key: 'signup', history: { max: 200 } })
```

## API

| Member             | Type            | What it does                                                            |
| ------------------ | --------------- | ----------------------------------------------------------------------- |
| `undo()`           | `() => boolean` | Revert to the previous snapshot. `false` at baseline (nothing to undo). |
| `redo()`           | `() => boolean` | Replay a previously-undone snapshot. `false` when nothing's queued.     |
| `meta.canUndo`     | `boolean`       | Gate an "Undo" button on this.                                          |
| `meta.canRedo`     | `boolean`       | Gate a "Redo" button on this.                                           |
| `meta.historySize` | `number`        | Total snapshots across both stacks — useful for debug overlays.         |

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

- **Field records** (touched / focused / blurred / isConnected) —
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

- **`reset()`** clears both stacks and uses the reset state as the
  new baseline. A reset is a "new session".
- **Live field validation** still runs on undo / redo — the
  restored state validates like any other.
- **Persistence** picks up each undo / redo as a normal mutation
  and writes the restored state to your chosen backend.

## Memory

Default `max: 50` keeps at most 50 past + 50 redo snapshots. Bump
it for editors with long histories; drop it for memory-constrained
targets. Each snapshot holds a reference to the form value (not a
deep copy) plus a shallow copy of the error map — cost scales
linearly, not quadratically.
