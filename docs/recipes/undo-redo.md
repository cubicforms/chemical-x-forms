# Undo / redo

Enable a bounded undo/redo stack per form by passing the `history`
option to `useForm`:

```ts
const form = useForm({
  schema,
  key: 'signup',
  history: true,     // default max of 50 snapshots
})
```

or tune the depth:

```ts
useForm({ schema, key: 'signup', history: { max: 200 } })
```

## API

| Member          | Type                                       | What it does                                                     |
| --------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `undo()`        | `() => boolean`                            | Revert to the prior snapshot. Returns `true` on success, `false` at baseline. |
| `redo()`        | `() => boolean`                            | Replay a previously-undone snapshot. Returns `true` on success, `false` when nothing to redo. |
| `canUndo`       | `Readonly<ComputedRef<boolean>>`           | `true` when a prior snapshot exists.                              |
| `canRedo`       | `Readonly<ComputedRef<boolean>>`           | `true` when a prior `undo()` has pending replays.                 |
| `historySize`   | `Readonly<ComputedRef<number>>`            | Total snapshots across both stacks. Debug UIs only; gate UI on `canUndo` / `canRedo` instead. |

When `history` is not configured on `useForm`, these members are
still present but inert — `undo()` / `redo()` always return
`false`, `canUndo` / `canRedo` always read `false`, `historySize` is
`0`. The consistent shape means templates don't need to branch.

## Template usage

```vue
<script setup lang="ts">
const { undo, redo, canUndo, canRedo, handleSubmit } = useForm({
  schema, key: 'editor', history: true,
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
    <button :disabled="!canUndo" @click="undo">Undo</button>
    <button :disabled="!canRedo" @click="redo">Redo</button>
    <!-- ...form fields... -->
  </div>
</template>
```

## What gets snapshotted

Each snapshot captures:
- The whole form value (reference — the ref is replaced wholesale
  on every mutation, so the captured reference is immutable).
- The error map at the moment of the snapshot (shallow-cloned).

What is NOT snapshotted:
- **Field records** (touched / focused / blurred / isConnected).
  These represent UI interaction history — a field that was
  touched stays touched across undos.
- **Submission lifecycle** (submitCount, isSubmitting, submitError).
- **Validation in-flight state**.

## When snapshots are pushed

A snapshot is pushed on every `applyFormReplacement`, which is the
single mutation funnel for:
- `setValue(path, value)` / `setValue(whole)`.
- Every field-array helper: `append` / `prepend` / `insert` /
  `remove` / `swap` / `move` / `replace`.
- Register-backed input bindings (v-register).

Calling `setFieldErrors` / `setFieldErrorsFromApi` / `clearFieldErrors`
does NOT push a snapshot — those touch the error map directly. The
NEXT form mutation's snapshot carries whatever error state is live
at that point.

## Interaction with other features

- **`reset()`** clears both stacks entirely and re-seeds with the
  reset state. A reset is a conceptual "new session".
- **Field-level validation** (`fieldValidation`). Undo / redo
  restores through `applyFormReplacement`, which fires the field-
  validation scheduler. The restored state validates like any
  other — stale errors on the restored form will clear on the next
  run.
- **Persistence** (`persist`). Every undo / redo schedules a
  debounced write of the restored state. That's correct: the
  persisted payload should always reflect the current form, which
  an undo did just change.

## Memory

Snapshots share structural references to the form value — Vue's
form ref is replaced wholesale on every mutation, so old snapshots
keep their references stable. The error map is shallow-cloned per
snapshot. Memory cost is dominated by the size of the errors array
(usually small) + constant overhead per snapshot.

Default `max: 50` means at most 50 past snapshots and 50 redo
snapshots are kept. Bump `max` for editors with long undo
histories; drop it for mobile with memory pressure.

## Keyboard shortcuts

Not wired by default — Chemical X is framework-agnostic and
doesn't assume a keyboard model. Wire `@keydown` on the form
container to `event.metaKey + 'z'` (macOS) or `event.ctrlKey + 'z'`
(Windows / Linux), with `shiftKey` for redo as shown above.

## Caveats

- **Snapshots capture the form after each applyFormReplacement.**
  Batched mutations from the field-array helpers' `move` /
  `swap` / `replace` land as single snapshots (one reassignment of
  the whole array), which is what a user expects. But two
  consecutive `setValue` calls produce two snapshots — undo steps
  through them one at a time.
- **No snapshot for "pure error" mutations.** Calling
  `setFieldErrors` alone doesn't create an entry; there's nothing
  to undo at the form level, and spending stack depth on error-only
  states doesn't match typical undo intuition.
- **Pre-mount hydration** (SSR / persistence-restore) counts as
  the baseline — the restored-form IS the initial snapshot, so
  undo from first mount bottoms out there.
