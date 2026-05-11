import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { applyPatchesForward, diffAndApply, structuralSnapshot, type Patch } from './diff-apply'
import { canonicalizePath, type Path, type PathKey, type Segment } from './paths'

/**
 * Cross-tab form-state synchronisation over a `BroadcastChannel`.
 *
 * **Identity model.** Two `useForm({ key, schema })` callsites in
 * same-origin tabs join the same channel by deriving its name from the
 * consumer-supplied `formKey` + the schema fingerprint. Tabs auto-pair
 * without an opt-in flag; the only switch is `multiTab: false` to
 * disable. Anonymous (auto-keyed) forms skip the module entirely (no
 * shared identity → no channel to join).
 *
 * **Handshake.** A joining tab posts `{kind: 'hello'}`. Every
 * established tab responds with `{kind: 'announce', senderId}` (UUID
 * only — cheap). The joining tab waits a short collection window
 * (~50ms), picks the lowest-sorted `senderId` as leader, and posts
 * `{kind: 'requestSnapshot', targetId: leaderId}`. Only the leader
 * replies with `{kind: 'snapshot', form, blankPaths}`. Bandwidth on
 * N-tab join is N tiny announces + 1 snapshot — vs. the naive
 * "everyone responds with a full snapshot" which would be O(N) full
 * snapshots.
 *
 * **Steady state.** Every local mutation fires an `onFormChange`
 * listener that diffs against a per-module prior snapshot and posts
 * `{kind: 'patches', formPatches, blankPathsAdded, blankPathsRemoved}`
 * over the channel. Receivers apply via `applyPatchesForward` +
 * `state.applyFormReplacement(merged, { crossTab: true, persist: false })`.
 *
 * **Defenses (see the recipe's Security section for the threat model).**
 * 1. **`senderId` echo drop.** Per-module UUID stamped on every
 *    outbound message; receivers drop messages whose `senderId` ===
 *    own. Handles intra-tab self-loops (two `useForm({key:'x'})` in
 *    one tab) and any UA echo behaviour.
 * 2. **Protocol versioning.** Every message carries `v: 1`; receivers
 *    drop unknown versions silently. Lets us evolve the wire format
 *    without silently corrupting older tabs running stale bundles.
 * 3. **Sensitive-path filtering.** Outbound strips patches at paths
 *    matching `options.isSensitivePath`; inbound REJECTS the same
 *    paths (defense in depth — the wire is never trusted, even though
 *    the originating tab "should have" stripped them).
 * 4. **Path-segment safety.** Inbound rejects patches containing
 *    `__proto__` / `constructor` / `prototype` — prototype-pollution
 *    defense before `applyPatchesForward` touches the form.
 * 5. **Post-apply schema validate + rollback.** After applying
 *    surviving patches, the caller's `validateForm` callback runs; on
 *    throw the entire message is dropped and the form state stays
 *    where it was.
 * 6. **Per-register opt-out (`noSyncPaths`).** Paths the consumer
 *    marked `register('x', { multiTab: false })` are stripped on
 *    outbound AND rejected on inbound — symmetric tab-local
 *    behaviour for selected fields.
 *
 * **History stays local.** Inbound applies set `meta.crossTab: true`;
 * the history listener updates its diff anchor but does NOT push a
 * delta. `undo()` walks the local user's intent, not a sibling tab's.
 */

export type MultiTabSyncModule = {
  /** Tear down the channel + outbound listener. */
  dispose(): void
  /**
   * Lifecycle observable for tests. `'joining'` during the
   * mount-time handshake collection window; `'established'` once a
   * snapshot has arrived (or the join timed out into solo-tab mode).
   */
  readonly lifecycle: () => 'joining' | 'established'
  /**
   * The module's UUID. Stamped on every outbound message; receivers
   * drop messages with their own `senderId`. Exposed for tests that
   * need to verify echo-drop or fabricate hostile messages.
   */
  readonly senderId: string
  /** The channel name this module is bound to. Exposed for tests. */
  readonly channelName: string
}

export type MultiTabSyncOptions<F> = {
  /**
   * Sensitive-path predicate threaded from the FormStore. Patches at
   * matching paths are stripped from outbound AND rejected on inbound
   * — defense in depth.
   */
  readonly isSensitivePath: (path: Path | PathKey | string) => boolean
  /**
   * Per-register opt-out registry — paths the consumer marked
   * `{ multiTab: false }` are tab-local in BOTH directions. Empty by
   * default; populated by Phase 7's register hook.
   */
  readonly noSyncPaths: ReadonlySet<PathKey>
  /**
   * Post-apply schema validation. Called by the inbound handler on
   * the candidate form value AFTER patches apply but BEFORE the
   * candidate replaces live state. MUST throw on validation failure;
   * the inbound handler catches and rolls back.
   *
   * Adapter implementations should call
   * `state.schema.validateAtPath(form, undefined, { sync: true })` and
   * throw on any non-success-sync result (or skip validation entirely
   * for async-only schemas — see the recipe for rationale).
   */
  readonly validateForm: (form: F) => void
}

/** Wire-format version. Bumps require coordinated deploys. */
const PROTOCOL_VERSION = 1 as const

/** Collection window for `announce` messages during the join flow. */
const JOIN_COLLECTION_WINDOW_MS = 50
/** Timeout per `requestSnapshot` attempt before falling back to next-lowest leader. */
const SNAPSHOT_TIMEOUT_MS = 200
/** Max retries for leader-election before giving up and proceeding solo. */
const MAX_LEADER_ATTEMPTS = 3

type SyncMessage<F> =
  | { readonly v: 1; readonly kind: 'hello'; readonly senderId: string }
  | { readonly v: 1; readonly kind: 'announce'; readonly senderId: string }
  | {
      readonly v: 1
      readonly kind: 'requestSnapshot'
      readonly senderId: string
      readonly targetId: string
    }
  | {
      readonly v: 1
      readonly kind: 'snapshot'
      readonly senderId: string
      readonly form: F
      readonly blankPaths: readonly PathKey[]
    }
  | {
      readonly v: 1
      readonly kind: 'patches'
      readonly senderId: string
      readonly formPatches: readonly Patch[]
      readonly blankPathsAdded: readonly PathKey[]
      readonly blankPathsRemoved: readonly PathKey[]
    }

type Lifecycle = 'joining' | 'established'

type SnapshotState<F> = {
  readonly form: F
  readonly blankPathsSnapshot: ReadonlyArray<PathKey>
}

function isDangerousSegment(s: Segment): boolean {
  return s === '__proto__' || s === 'constructor' || s === 'prototype'
}

function pathContainsDangerousSegment(path: Path): boolean {
  for (let i = 0; i < path.length; i++) {
    if (isDangerousSegment(path[i] as Segment)) return true
  }
  return false
}

function diffBlankPaths(
  prev: ReadonlyArray<PathKey>,
  curr: ReadonlySet<PathKey>
): { added: PathKey[]; removed: PathKey[] } {
  const added: PathKey[] = []
  const removed: PathKey[] = []
  const prevSet = new Set<PathKey>(prev)
  for (const k of curr) if (!prevSet.has(k)) added.push(k)
  for (const k of prev) if (!curr.has(k)) removed.push(k)
  return { added, removed }
}

function snapshotForm<F>(form: F): F {
  // Reuse the same structural snapshot helper history uses. Walks
  // plain object + array spine, leaves non-descendable values
  // (BigInt, Date, Map, Set, class instances) by reference. This
  // is fine for the diff anchor — the immutable values are
  // reference-stable, and the in-place merge inside
  // `applyFormReplacement` mutates the spine, not the leaves.
  // BroadcastChannel's own `postMessage` uses `structuredClone` to
  // serialise the message, which natively handles BigInt / Date /
  // Map / Set, so sending the diff'd `Patch[]` over the wire works.
  return structuralSnapshot(form)
}

/**
 * Deep-clone `value` while substituting any leaf whose enclosing path
 * matches `isSensitivePath` with `undefined`. Used to scrub
 * snapshots before posting them — even on the originating tab, a
 * snapshot in response to `hello` should not carry sensitive values
 * to fresh-mount siblings.
 */
function stripSensitivePathsDeep(
  value: unknown,
  pathSoFar: Path,
  isSensitivePath: (p: Path) => boolean
): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item, i) => stripSensitivePathsDeep(item, [...pathSoFar, i], isSensitivePath))
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const out: Record<string, unknown> = {}
  const src = value as Record<string, unknown>
  for (const key of Object.keys(src)) {
    const childPath = [...pathSoFar, key]
    if (isSensitivePath(childPath)) {
      out[key] = undefined
      continue
    }
    out[key] = stripSensitivePathsDeep(src[key], childPath, isSensitivePath)
  }
  return out
}

/**
 * Type-guard for incoming messages. Validates the structural shape
 * before dispatch so a hostile sender can't crash the listener with
 * garbage. Rejects messages missing `v` / `kind` / `senderId`.
 */
function isValidSyncMessage(data: unknown): data is SyncMessage<unknown> {
  if (data === null || typeof data !== 'object') return false
  const m = data as Record<string, unknown>
  if (m['v'] !== PROTOCOL_VERSION) return false
  if (typeof m['senderId'] !== 'string') return false
  if (typeof m['kind'] !== 'string') return false
  switch (m['kind']) {
    case 'hello':
    case 'announce':
      return true
    case 'requestSnapshot':
      return typeof m['targetId'] === 'string'
    case 'snapshot':
      return Array.isArray(m['blankPaths']) && 'form' in m
    case 'patches':
      return (
        Array.isArray(m['formPatches']) &&
        Array.isArray(m['blankPathsAdded']) &&
        Array.isArray(m['blankPathsRemoved'])
      )
    default:
      return false
  }
}

function generateSenderId(): string {
  try {
    // Available in evergreen browsers and Node 19+. Library code calls
    // it elsewhere (e.g. instanceId allocation), so the dependency is
    // already on the runtime surface.
    return globalThis.crypto.randomUUID()
  } catch {
    // Pathological fallback for ancient environments — collision
    // resistance is reduced but the module still functions; same-tab
    // dedup is the only consumer of senderId equality and intra-tab
    // collisions are vanishingly unlikely.
    return `atta-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  }
}

/**
 * Construct a cross-tab sync module bound to `channelName`. Returns a
 * stub no-op module if `BroadcastChannel` is unavailable in the
 * runtime — callers should already have gated on availability +
 * `window.isSecureContext`, but the guard makes the module safe to
 * instantiate from any environment.
 */
export function createMultiTabSyncModule<F extends GenericForm>(
  state: FormStore<F, GenericForm>,
  channelName: string,
  options: MultiTabSyncOptions<F>
): MultiTabSyncModule {
  if (typeof BroadcastChannel === 'undefined') {
    return {
      dispose: () => undefined,
      lifecycle: () => 'established',
      senderId: '',
      channelName,
    }
  }

  let channel: BroadcastChannel
  try {
    channel = new BroadcastChannel(channelName)
  } catch {
    return {
      dispose: () => undefined,
      lifecycle: () => 'established',
      senderId: '',
      channelName,
    }
  }

  const senderId = generateSenderId()
  let lifecycle: Lifecycle = 'joining'
  let disposed = false

  // Ephemeral roster for the join flow. Populated by `announce`
  // messages during the collection window; consumed by the leader
  // election. Cleared once the joining tab transitions to
  // `'established'` (no further use case for the set).
  const peerIds = new Set<string>()
  let joinCollectionTimer: ReturnType<typeof setTimeout> | null = null
  let snapshotTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  let leaderAttempts = 0

  // Per-module prior anchor for outbound diffs. Refreshed after every
  // posted `patches` message AND after every accepted inbound apply
  // (so the next local diff is against post-apply state, not the
  // stale pre-apply form).
  let prior: SnapshotState<F> = {
    form: snapshotForm(state.form.value),
    blankPathsSnapshot: [...state.blankPaths],
  }

  function safePost(msg: SyncMessage<F>): void {
    if (disposed) return
    try {
      channel.postMessage(msg)
    } catch {
      // Channel closed under our feet (e.g., tab navigating away
      // while a postMessage queues). Drop silently.
    }
  }

  function refreshPrior(): void {
    prior = {
      form: snapshotForm(state.form.value),
      blankPathsSnapshot: [...state.blankPaths],
    }
  }

  function isPathLocallySuppressed(path: Path): boolean {
    if (pathContainsDangerousSegment(path)) return true
    if (options.isSensitivePath(path)) return true
    const { key } = canonicalizePath([...path])
    if (options.noSyncPaths.has(key)) return true
    return false
  }

  function postPatches(): void {
    if (lifecycle !== 'established') return
    const next = snapshotForm(state.form.value)
    const rawPatches: Patch[] = []
    diffAndApply(prior.form, next, [], (p) => rawPatches.push(p))
    const safePatches: Patch[] = []
    for (const p of rawPatches) {
      if (isPathLocallySuppressed(p.path)) continue
      safePatches.push(p)
    }
    const { added, removed } = diffBlankPaths(prior.blankPathsSnapshot, state.blankPaths)
    // Suppress noisy zero-delta posts (e.g., the form changed only at
    // a sensitive path — after filtering, nothing remains).
    if (safePatches.length === 0 && added.length === 0 && removed.length === 0) {
      prior = { form: next, blankPathsSnapshot: [...state.blankPaths] }
      return
    }
    safePost({
      v: PROTOCOL_VERSION,
      kind: 'patches',
      senderId,
      formPatches: safePatches,
      blankPathsAdded: added,
      blankPathsRemoved: removed,
    })
    prior = { form: next, blankPathsSnapshot: [...state.blankPaths] }
  }

  // Outbound: every local non-crossTab non-hydration mutation diffs
  // against `prior` and posts the resulting patches. Joining tabs
  // suppress their own outbound traffic until they're established —
  // otherwise they'd broadcast pre-handshake noise.
  const unsubscribeChange = state.onFormChange((_next, meta) => {
    if (disposed) return
    if (lifecycle !== 'established') return
    if (meta?.crossTab === true) return
    if (meta?.hydration === true) {
      // Hydration realigned local state; refresh the diff anchor
      // without posting. Siblings hydrate independently to the same
      // value, so channel traffic would be wasted.
      refreshPrior()
      return
    }
    postPatches()
  })

  function applyIncomingForm(form: F, blankPaths: ReadonlyArray<PathKey>): void {
    // Sync blank-paths set BEFORE applying the form value so the
    // resulting `onFormChange` emission sees a coherent (form,
    // blankPaths) pair. Listeners that read both during a single
    // microtick (history, persistence, devtools) wouldn't observe
    // mid-update divergence.
    state.blankPaths.clear()
    for (const k of blankPaths) state.blankPaths.add(k)
    state.applyFormReplacement(form, { crossTab: true, persist: false })
    refreshPrior()
  }

  function handlePatches(msg: SyncMessage<F> & { kind: 'patches' }): void {
    if (lifecycle !== 'established') return
    const safePatches: Patch[] = []
    for (const p of msg.formPatches) {
      if (!Array.isArray(p.path)) continue
      if (isPathLocallySuppressed(p.path)) continue
      safePatches.push(p)
    }
    // Filter blank-path deltas with the same predicate. A sensitive
    // blank-path key shouldn't leak via the membership signal either.
    const safeBlankAdded: PathKey[] = []
    for (const k of msg.blankPathsAdded) {
      const segs = canonicalizePath(k).segments
      if (isPathLocallySuppressed(segs)) continue
      safeBlankAdded.push(k)
    }
    const safeBlankRemoved: PathKey[] = []
    for (const k of msg.blankPathsRemoved) {
      const segs = canonicalizePath(k).segments
      if (isPathLocallySuppressed(segs)) continue
      safeBlankRemoved.push(k)
    }
    if (safePatches.length === 0 && safeBlankAdded.length === 0 && safeBlankRemoved.length === 0) {
      return
    }
    const candidate = applyPatchesForward(state.form.value, safePatches) as F
    // Post-apply schema validation runs ONLY if the pre-apply form
    // was already valid — otherwise a form that mounts in an
    // intentionally-invalid state (empty defaults that violate
    // refinements, mid-edit field-array seeds) would reject every
    // remote update. The local `validateOn` cycle surfaces any
    // resulting errors on the receiver normally.
    try {
      options.validateForm(state.form.value)
      try {
        options.validateForm(candidate)
      } catch {
        // Patches would have invalidated a previously-valid form —
        // rollback. The originating tab's mutation is dropped on
        // this receiver; last-writer-wins re-converges on the next
        // valid mutation.
        return
      }
    } catch {
      // Pre-apply form was already invalid; skip post-validation
      // (no new attack surface — the form was already in an invalid
      // state from the user's POV, the local validate cycle
      // surfaces errors regardless of where the data came from).
    }
    const nextBlankPaths = new Set(state.blankPaths)
    for (const k of safeBlankRemoved) nextBlankPaths.delete(k)
    for (const k of safeBlankAdded) nextBlankPaths.add(k)
    applyIncomingForm(candidate, [...nextBlankPaths])
  }

  function handleSnapshot(msg: SyncMessage<F> & { kind: 'snapshot' }): void {
    if (lifecycle !== 'joining') return
    try {
      options.validateForm(msg.form)
    } catch {
      // Leader sent a snapshot we can't accept; remain in 'joining'
      // and let the retry/timeout flow elect a different leader.
      return
    }
    if (snapshotTimeoutTimer !== null) {
      clearTimeout(snapshotTimeoutTimer)
      snapshotTimeoutTimer = null
    }
    if (joinCollectionTimer !== null) {
      clearTimeout(joinCollectionTimer)
      joinCollectionTimer = null
    }
    applyIncomingForm(msg.form, msg.blankPaths)
    lifecycle = 'established'
    peerIds.clear()
  }

  function respondToHello(): void {
    safePost({ v: PROTOCOL_VERSION, kind: 'announce', senderId })
  }

  function respondToSnapshotRequest(): void {
    const scrubbedForm = stripSensitivePathsDeep(state.form.value, [], options.isSensitivePath) as F
    safePost({
      v: PROTOCOL_VERSION,
      kind: 'snapshot',
      senderId,
      form: scrubbedForm,
      blankPaths: [...state.blankPaths],
    })
  }

  channel.onmessage = (event: MessageEvent): void => {
    if (disposed) return
    const data = event.data
    if (!isValidSyncMessage(data)) return
    const msg = data as SyncMessage<F>
    // Echo drop — own messages NEVER apply (intra-tab self-loop +
    // any UA echo behaviour).
    if (msg.senderId === senderId) return
    switch (msg.kind) {
      case 'hello':
        if (lifecycle !== 'established') return
        respondToHello()
        break
      case 'announce':
        if (lifecycle === 'joining') peerIds.add(msg.senderId)
        break
      case 'requestSnapshot':
        if (lifecycle !== 'established') return
        if (msg.targetId !== senderId) return
        respondToSnapshotRequest()
        break
      case 'snapshot':
        handleSnapshot(msg)
        break
      case 'patches':
        handlePatches(msg)
        break
    }
  }

  function electLeaderAndRequest(): void {
    if (disposed) return
    if (peerIds.size === 0) {
      // No siblings answered — proceed solo. Local hydration/defaults
      // become this tab's baseline.
      lifecycle = 'established'
      refreshPrior()
      return
    }
    const sorted = [...peerIds].sort()
    const leaderId = sorted[0] as string
    peerIds.delete(leaderId)
    leaderAttempts++
    safePost({
      v: PROTOCOL_VERSION,
      kind: 'requestSnapshot',
      senderId,
      targetId: leaderId,
    })
    snapshotTimeoutTimer = setTimeout(() => {
      snapshotTimeoutTimer = null
      if (disposed) return
      if (lifecycle === 'established') return
      if (leaderAttempts >= MAX_LEADER_ATTEMPTS || peerIds.size === 0) {
        // Out of retries / out of candidates — fall back to solo.
        lifecycle = 'established'
        refreshPrior()
        return
      }
      electLeaderAndRequest()
    }, SNAPSHOT_TIMEOUT_MS)
  }

  function joinFlow(): void {
    safePost({ v: PROTOCOL_VERSION, kind: 'hello', senderId })
    joinCollectionTimer = setTimeout(() => {
      joinCollectionTimer = null
      if (disposed) return
      if (lifecycle === 'established') return
      electLeaderAndRequest()
    }, JOIN_COLLECTION_WINDOW_MS)
  }

  joinFlow()

  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      if (joinCollectionTimer !== null) {
        clearTimeout(joinCollectionTimer)
        joinCollectionTimer = null
      }
      if (snapshotTimeoutTimer !== null) {
        clearTimeout(snapshotTimeoutTimer)
        snapshotTimeoutTimer = null
      }
      unsubscribeChange()
      try {
        channel.close()
      } catch {
        // No-op — close failures are non-recoverable.
      }
    },
    lifecycle: () => lifecycle,
    senderId,
    channelName,
  }
}

/** Shared module-cache key used by `state.modules.set/get`. */
export const MULTI_TAB_SYNC_MODULE_KEY = 'multiTabSync'
