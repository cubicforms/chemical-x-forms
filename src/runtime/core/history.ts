import { computed, shallowRef, type ComputedRef } from 'vue'
import type { HistoryConfig, ValidationError } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { DEFAULT_HISTORY_MAX_SNAPSHOTS } from './defaults'
import type { PathKey } from './paths'

/**
 * Bounded undo/redo snapshot stack for a FormStore. Subscribes to
 * `onFormChange` to push a snapshot on every mutation; `undo` /
 * `redo` restore via `applyFormReplacement` plus the schema + user
 * error writers. `onReset` clears both stacks and seeds a fresh baseline.
 *
 * Snapshots include:
 *  - `form` — the whole form value, captured by reference. Vue's
 *    form ref is replaced wholesale on every mutation, so the
 *    snapshot reference is stable: old references don't mutate.
 *  - `schemaErrors` + `userErrors` — shallow-cloned Map entries from
 *    each source-segregated store. Captured separately so undo
 *    preserves the lifecycle distinction (schema errors are validation
 *    output; user errors are consumer-owned).
 *
 * Field record state (touched / focused / blurred / isConnected) is
 * deliberately NOT snapshotted. Those flags represent UI
 * interaction history and shouldn't rewind when the user hits
 * undo — a field that was touched stays touched.
 */

export type HistorySnapshot<F> = {
  readonly form: F
  readonly schemaErrors: ReadonlyArray<readonly [PathKey, ValidationError[]]>
  readonly userErrors: ReadonlyArray<readonly [PathKey, ValidationError[]]>
}

export type HistoryModule = {
  undo(): boolean
  redo(): boolean
  canUndo: Readonly<ComputedRef<boolean>>
  canRedo: Readonly<ComputedRef<boolean>>
  historySize: Readonly<ComputedRef<number>>
  dispose(): void
}

export function createHistoryModule<F extends GenericForm>(
  state: FormStore<F>,
  config: HistoryConfig
): HistoryModule {
  const max =
    typeof config === 'object'
      ? (config.max ?? DEFAULT_HISTORY_MAX_SNAPSHOTS)
      : DEFAULT_HISTORY_MAX_SNAPSHOTS

  // undoStack[-1] is the CURRENT state. undo() pops that onto redo
  // and restores undoStack[-2]. redoStack[-1] is the next-available
  // redo target. This layout keeps `canUndo = undoStack.length > 1`
  // and `canRedo = redoStack.length > 0` trivially.
  // shallowRef avoids Vue's UnwrapRef recursion: the stacks are
  // replaced wholesale on every mutation (spread into a new array),
  // so deep reactivity would only add overhead and produce weird
  // typing around `HistorySnapshot<F>` (UnwrapRef<F> !== F for
  // generic constraints).
  const undoStack = shallowRef<HistorySnapshot<F>[]>([])
  const redoStack = shallowRef<HistorySnapshot<F>[]>([])

  // When `undo()` / `redo()` calls `applyFormReplacement`, the
  // resulting `onFormChange` must NOT push a new snapshot (that
  // would duplicate the restored state and break the stack
  // ordering). This flag suppresses the next change event.
  let suppressNext = false

  function captureSnapshot(): HistorySnapshot<F> {
    // Vue's Ref<F> unwraps via UnwrapRef<F>; at runtime this is just F
    // for all plain object shapes, but the compile-time types differ.
    // Cast through unknown to reassure TS the snapshot shape matches
    // the generic parameter the caller bound.
    return {
      form: state.form.value as unknown as F,
      schemaErrors: [...state.schemaErrors.entries()].map(([k, v]) => [k, [...v]] as const),
      userErrors: [...state.userErrors.entries()].map(([k, v]) => [k, [...v]] as const),
    }
  }

  function pushSnapshot(snap: HistorySnapshot<F>): void {
    const next = [...undoStack.value, snap]
    // Trim FIFO so the OLDEST snapshot is evicted when the stack
    // exceeds max. The user's most recent history is the one worth
    // keeping.
    undoStack.value = next.length > max ? next.slice(-max) : next
    redoStack.value = []
  }

  // Seed with the initial state so `undoStack[-1]` always equals
  // the current form. The first user mutation pushes a second
  // entry, enabling `undo()`.
  pushSnapshot(captureSnapshot())

  const unsubscribeChange = state.onFormChange(() => {
    if (suppressNext) {
      suppressNext = false
      return
    }
    pushSnapshot(captureSnapshot())
  })

  const unsubscribeReset = state.onReset(() => {
    // reset() fires onFormChange first (applyFormReplacement
    // emits it), then onReset. By the time we land here, a
    // snapshot for the reset state has already been pushed.
    // Clear both stacks and re-seed so the reset state becomes
    // the new baseline.
    undoStack.value = []
    redoStack.value = []
    pushSnapshot(captureSnapshot())
  })

  function restore(snap: HistorySnapshot<F>): void {
    suppressNext = true
    // Undo / redo replays a whole-form snapshot, so the persist decision
    // can't be made per-path. Rule: if the form has any opted-in path
    // at all, the rewind reaches the persistence layer (so the durable
    // record matches what the user just rolled back to). If nothing is
    // opted in, no write — matches the per-element default.
    state.applyFormReplacement(snap.form, {
      persist: !state.persistOptIns.isEmpty(),
    })
    // Rebuild both error stores from the snapshot. Each writer clears +
    // repopulates its own Map; the two sources stay isolated. Order is
    // arbitrary because the writers touch separate Maps with no
    // cross-dependency, but writing schema first keeps the per-key
    // insertion order matching the schema-first iteration invariant.
    const schemaFlat = snap.schemaErrors.flatMap(([, errs]) => errs)
    const userFlat = snap.userErrors.flatMap(([, errs]) => errs)
    state.setAllSchemaErrors(schemaFlat)
    state.setAllUserErrors(userFlat)
  }

  function undo(): boolean {
    if (undoStack.value.length <= 1) return false
    const current = undoStack.value[undoStack.value.length - 1]
    const prev = undoStack.value[undoStack.value.length - 2]
    if (current === undefined || prev === undefined) return false
    redoStack.value = [...redoStack.value, current]
    undoStack.value = undoStack.value.slice(0, -1)
    restore(prev)
    return true
  }

  function redo(): boolean {
    if (redoStack.value.length === 0) return false
    const next = redoStack.value[redoStack.value.length - 1]
    if (next === undefined) return false
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [...undoStack.value, next]
    restore(next)
    return true
  }

  const canUndo = computed(() => undoStack.value.length > 1)
  const canRedo = computed(() => redoStack.value.length > 0)
  const historySize = computed(() => undoStack.value.length + redoStack.value.length)

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    historySize,
    dispose() {
      unsubscribeChange()
      unsubscribeReset()
      undoStack.value = []
      redoStack.value = []
    },
  }
}
