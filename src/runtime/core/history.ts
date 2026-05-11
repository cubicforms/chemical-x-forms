import { computed, shallowRef, type ComputedRef } from 'vue'
import type { HistoryConfig, ValidationError, WriteMeta } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { DEFAULT_HISTORY_MAX_SNAPSHOTS, normalizeNumericOption } from './defaults'
import {
  applyPatchesForward,
  applyPatchesInverse,
  diffAndApply,
  structuralSnapshot,
  type Patch,
} from './diff-apply'
import type { PathKey } from './paths'

/**
 * Bounded undo/redo history for a FormStore, stored as one base
 * snapshot plus a linear chain of forward deltas. Subscribes to
 * `onFormChange` to record a `Delta` between the prior state and the
 * post-mutation state on every form change; `undo` walks the chain
 * backward by applying each delta in inverse, `redo` walks forward
 * by re-applying.
 *
 * Storage shape:
 *  - `base` — full `HistorySnapshot<F>` at the oldest reachable
 *    position. Initially the form's mount-time state. Advanced
 *    forward when the chain exceeds the capacity cap (the oldest
 *    delta is folded into `base` and dropped).
 *  - `undoDeltas` — forward deltas from `base` up to the current
 *    state. `undo()` consumes the tail; new mutations append.
 *  - `redoDeltas` — forward deltas from the current state up to
 *    redoable states. Populated by `undo()`; cleared by any fresh
 *    mutation.
 *  - `currentSnapshot` — materialised state at the current position.
 *    Acts as the diff anchor for the next mutation (we diff against
 *    this, not the live `state.form.value` ref, because the live
 *    ref mutates in-place during `applyFormReplacement`).
 *
 * Each `Delta` carries:
 *  - `formPatches` — `Patch[]` from `diffAndApply`. Each `changed`
 *    patch holds BOTH `oldValue` and `newValue`, making the patch
 *    list self-invertible — no separate inverse-diff storage needed.
 *  - `blankPathsAdded` / `blankPathsRemoved` — symmetric set diff.
 *    Forward applies removed-then-added; inverse swaps them.
 *  - `schemaErrors` / `userErrors` — present only when the errors
 *    changed between snapshots. Each carries before+after entry
 *    snapshots so undo/redo can restore either side without
 *    walking back through the chain.
 *
 * `reset()` is treated as an ordinary mutation: `applyFormReplacement`
 * fires `onFormChange`, the resulting delta lands on `undoDeltas`,
 * and the pre-reset state stays one undo away. Persistence hydration
 * (`meta.hydration === true`) is the floor — both delta arrays wipe
 * and `base` re-seeds from the post-hydration snapshot, so `undo()`
 * can't reach back into a pre-hydration default the consumer never
 * saw.
 *
 * Field record state (touched / focused / blurred / connected) is
 * deliberately NOT snapshotted. Those flags represent UI interaction
 * history and shouldn't rewind when the user hits undo — a field that
 * was touched stays touched.
 */

export type HistorySnapshot<F> = {
  readonly form: F
  readonly blankPaths: ReadonlyArray<PathKey>
  readonly schemaErrors: ReadonlyArray<readonly [PathKey, ValidationError[]]>
  readonly userErrors: ReadonlyArray<readonly [PathKey, ValidationError[]]>
}

export type HistoryModule = {
  undo(): boolean
  redo(): boolean
  /**
   * Wipe both delta arrays and reseed `base` from the current state.
   * The form value, errors, and blankPaths all stay where they are —
   * only the undo/redo chain resets. After `clear()`: `canUndo = false`,
   * `canRedo = false`, `historySize = 1`. Semantically equivalent to
   * the internal hydration-floor behaviour, exposed for consumers who
   * want a hard wipe after a "save successful" milestone or similar.
   */
  clear(): void
  canUndo: Readonly<ComputedRef<boolean>>
  canRedo: Readonly<ComputedRef<boolean>>
  historySize: Readonly<ComputedRef<number>>
  dispose(): void
}

type ErrorEntries = ReadonlyArray<readonly [PathKey, ValidationError[]]>

type Delta = {
  readonly formPatches: ReadonlyArray<Patch>
  readonly blankPathsAdded: ReadonlyArray<PathKey>
  readonly blankPathsRemoved: ReadonlyArray<PathKey>
  readonly schemaErrors?: { readonly before: ErrorEntries; readonly after: ErrorEntries }
  readonly userErrors?: { readonly before: ErrorEntries; readonly after: ErrorEntries }
}

function captureErrorEntries(map: Map<PathKey, ValidationError[]>): ErrorEntries {
  const out: Array<readonly [PathKey, ValidationError[]]> = []
  for (const [k, v] of map) out.push([k, [...v]] as const)
  return out
}

function errorsEqual(a: ErrorEntries, b: ErrorEntries): boolean {
  if (a.length !== b.length) return false
  const bMap = new Map<PathKey, ValidationError[]>()
  for (const [k, v] of b) bMap.set(k, v)
  for (const [k, v] of a) {
    const bv = bMap.get(k)
    if (bv === undefined) return false
    if (v.length !== bv.length) return false
    for (let i = 0; i < v.length; i++) {
      const av = v[i] as ValidationError
      const bvi = bv[i] as ValidationError
      // Identity-equal: ValidationError objects pass by reference through
      // the snapshot chain (not cloned), so most comparisons short-circuit
      // here. Fall back to field-by-field compare only on identity miss.
      if (av === bvi) continue
      if (av.message !== bvi.message) return false
      if (av.code !== bvi.code) return false
      if (av.formKey !== bvi.formKey) return false
      if (av.path !== bvi.path) {
        if (av.path.length !== bvi.path.length) return false
        for (let j = 0; j < av.path.length; j++) {
          if (av.path[j] !== bvi.path[j]) return false
        }
      }
    }
  }
  return true
}

function diffBlankPaths(
  prev: ReadonlySet<PathKey>,
  curr: ReadonlySet<PathKey>
): { added: PathKey[]; removed: PathKey[] } {
  const added: PathKey[] = []
  const removed: PathKey[] = []
  for (const k of curr) if (!prev.has(k)) added.push(k)
  for (const k of prev) if (!curr.has(k)) removed.push(k)
  return { added, removed }
}

function applyDeltaForward<F>(snap: HistorySnapshot<F>, d: Delta): HistorySnapshot<F> {
  const nextForm = applyPatchesForward(snap.form, d.formPatches) as F
  const nextBlank = new Set(snap.blankPaths)
  for (const k of d.blankPathsRemoved) nextBlank.delete(k)
  for (const k of d.blankPathsAdded) nextBlank.add(k)
  return {
    form: nextForm,
    blankPaths: [...nextBlank],
    schemaErrors: d.schemaErrors !== undefined ? d.schemaErrors.after : snap.schemaErrors,
    userErrors: d.userErrors !== undefined ? d.userErrors.after : snap.userErrors,
  }
}

function applyDeltaInverse<F>(snap: HistorySnapshot<F>, d: Delta): HistorySnapshot<F> {
  const prevForm = applyPatchesInverse(snap.form, d.formPatches) as F
  const prevBlank = new Set(snap.blankPaths)
  for (const k of d.blankPathsAdded) prevBlank.delete(k)
  for (const k of d.blankPathsRemoved) prevBlank.add(k)
  return {
    form: prevForm,
    blankPaths: [...prevBlank],
    schemaErrors: d.schemaErrors !== undefined ? d.schemaErrors.before : snap.schemaErrors,
    userErrors: d.userErrors !== undefined ? d.userErrors.before : snap.userErrors,
  }
}

export function createHistoryModule<F extends GenericForm>(
  state: FormStore<F, GenericForm>,
  config: HistoryConfig
): HistoryModule {
  // Sanitise the capacity cap. `NaN` would make `total > max` always
  // false (unbounded memory growth); `Infinity` likewise; negatives
  // and non-integers produce confusing slice behaviour. Falls back to
  // the library default on garbage. `max: 0` is preserved — equivalent
  // in effect to disabling history (no undo/redo positions retained),
  // but consumers may set it explicitly.
  const max = normalizeNumericOption({
    value:
      typeof config === 'object'
        ? (config.max ?? DEFAULT_HISTORY_MAX_SNAPSHOTS)
        : DEFAULT_HISTORY_MAX_SNAPSHOTS,
    source: 'useForm.history.max',
    allowInfinity: false,
    min: 0,
    defaultValue: DEFAULT_HISTORY_MAX_SNAPSHOTS,
  })

  function captureSnapshot(): HistorySnapshot<F> {
    return {
      form: structuralSnapshot(state.form.value) as unknown as F,
      blankPaths: [...state.blankPaths],
      schemaErrors: captureErrorEntries(state.schemaErrors),
      userErrors: captureErrorEntries(state.userErrors),
    }
  }

  // shallowRef avoids Vue's UnwrapRef recursion: the snapshots / delta
  // arrays are replaced wholesale on every mutation (spread into a new
  // array), so deep reactivity would only add overhead and produce
  // weird typing around `HistorySnapshot<F>` (UnwrapRef<F> !== F for
  // generic constraints).
  const initial = captureSnapshot()
  const base = shallowRef<HistorySnapshot<F>>(initial)
  const currentSnapshot = shallowRef<HistorySnapshot<F>>(initial)
  const undoDeltas = shallowRef<Delta[]>([])
  const redoDeltas = shallowRef<Delta[]>([])

  // When `undo()` / `redo()` calls `applyFormReplacement`, the
  // resulting `onFormChange` must NOT record a new delta (that would
  // duplicate the restored state and break the chain ordering). This
  // flag suppresses the next change event.
  let suppressNext = false

  function appendDelta(delta: Delta, newCurrent: HistorySnapshot<F>): void {
    // max: 0 — no positions retained beyond `base`. Advance base
    // forward in lockstep with the mutation; never grow the undo chain.
    // canUndo / canRedo stay false. Equivalent in effect to history
    // disabled, but a legitimate explicit override.
    if (max === 0) {
      base.value = newCurrent
      currentSnapshot.value = newCurrent
      redoDeltas.value = []
      return
    }
    undoDeltas.value = [...undoDeltas.value, delta]
    redoDeltas.value = []
    currentSnapshot.value = newCurrent
    // Cap on TOTAL reachable positions (= 1 + undoDeltas + redoDeltas).
    // After a fresh push, redoDeltas is empty, so the cap is enforced
    // by folding the oldest undo delta into `base`. This matches the
    // FIFO-eviction semantics of the prior stack model (oldest position
    // dropped when capacity is exceeded).
    while (1 + undoDeltas.value.length > max && undoDeltas.value.length > 0) {
      const oldest = undoDeltas.value[0] as Delta
      base.value = applyDeltaForward(base.value, oldest)
      undoDeltas.value = undoDeltas.value.slice(1)
    }
  }

  const unsubscribeChange = state.onFormChange((_next, meta?: WriteMeta) => {
    if (suppressNext) {
      suppressNext = false
      return
    }
    // Persistence hydration is the floor: the transient pre-hydration
    // default (briefly held between mount and hydrate-apply) is library
    // plumbing, not state the user ever saw. Re-seed `base` from the
    // post-hydration snapshot and wipe both delta arrays so `undo()`
    // can't reach back into a state the consumer never produced. Any
    // in-flight mutations that landed in the race window between mount
    // and hydration are also dropped — pre-hydration writes were
    // operating against stale defaults anyway.
    if (meta?.hydration === true) {
      clear()
      return
    }

    const newSnap = captureSnapshot()
    const prevSnap = currentSnapshot.value

    const formPatches: Patch[] = []
    diffAndApply(prevSnap.form, newSnap.form, [], (p) => formPatches.push(p))

    const prevBlankSet = new Set(prevSnap.blankPaths)
    const currBlankSet = new Set(newSnap.blankPaths)
    const blankDiff = diffBlankPaths(prevBlankSet, currBlankSet)

    const delta: Delta = {
      formPatches,
      blankPathsAdded: blankDiff.added,
      blankPathsRemoved: blankDiff.removed,
      ...(errorsEqual(prevSnap.schemaErrors, newSnap.schemaErrors)
        ? {}
        : { schemaErrors: { before: prevSnap.schemaErrors, after: newSnap.schemaErrors } }),
      ...(errorsEqual(prevSnap.userErrors, newSnap.userErrors)
        ? {}
        : { userErrors: { before: prevSnap.userErrors, after: newSnap.userErrors } }),
    }

    appendDelta(delta, newSnap)
  })

  function restoreCurrent(snap: HistorySnapshot<F>): void {
    suppressNext = true
    // Re-seed `blankPaths` BEFORE the form replacement fires. Listeners
    // on `onFormChange` (persistence's onFormChange tap, devtools, the
    // user's own subscriptions) read the form alongside `blankPaths`
    // when deciding what to persist or surface; updating both before
    // the listener loop runs keeps the pair consistent. If blankPaths
    // landed AFTER applyFormReplacement, the listeners would see new
    // form + stale blank set for one tick.
    state.blankPaths.clear()
    for (const key of snap.blankPaths) state.blankPaths.add(key)
    // Undo / redo replays a whole-form snapshot, so the persist decision
    // can't be made per-path. Rule: if the form has any opted-in path
    // at all, the rewind reaches the persistence layer (so the durable
    // record matches what the user just rolled back to). If nothing is
    // opted in, no write — matches the per-element default.
    state.applyFormReplacement(snap.form, {
      persist: !state.persistOptIns.isEmpty(),
    })
    // Rebuild both error stores from the snapshot. Each writer clears +
    // repopulates its own Map; the two sources stay isolated.
    const schemaFlat = snap.schemaErrors.flatMap(([, errs]) => errs)
    const userFlat = snap.userErrors.flatMap(([, errs]) => errs)
    state.setAllSchemaErrors(schemaFlat)
    state.setAllUserErrors(userFlat)
  }

  function undo(): boolean {
    if (undoDeltas.value.length === 0) return false
    const d = undoDeltas.value[undoDeltas.value.length - 1] as Delta
    const restored = applyDeltaInverse(currentSnapshot.value, d)
    redoDeltas.value = [...redoDeltas.value, d]
    undoDeltas.value = undoDeltas.value.slice(0, -1)
    currentSnapshot.value = restored
    restoreCurrent(restored)
    return true
  }

  function redo(): boolean {
    if (redoDeltas.value.length === 0) return false
    const d = redoDeltas.value[redoDeltas.value.length - 1] as Delta
    const next = applyDeltaForward(currentSnapshot.value, d)
    undoDeltas.value = [...undoDeltas.value, d]
    redoDeltas.value = redoDeltas.value.slice(0, -1)
    currentSnapshot.value = next
    restoreCurrent(next)
    return true
  }

  function clear(): void {
    const fresh = captureSnapshot()
    base.value = fresh
    currentSnapshot.value = fresh
    undoDeltas.value = []
    redoDeltas.value = []
  }

  const canUndo = computed(() => undoDeltas.value.length > 0)
  const canRedo = computed(() => redoDeltas.value.length > 0)
  const historySize = computed(() => 1 + undoDeltas.value.length + redoDeltas.value.length)

  return {
    undo,
    redo,
    clear,
    canUndo,
    canRedo,
    historySize,
    dispose() {
      unsubscribeChange()
      undoDeltas.value = []
      redoDeltas.value = []
    },
  }
}
