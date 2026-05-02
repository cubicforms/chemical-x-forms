import type {
  AbstractSchema,
  FormStorage,
  FormStorageKind,
  PersistConfig,
  PersistConfigOptions,
  ValidationError,
} from '../../types/types-api'
import { PERSISTENCE_KEY_PREFIX } from '../defaults'
import { __DEV__ } from '../dev'
import { isPlainRecord, setAtPath, getAtPath } from '../path-walker'
import type { Path, PathKey, Segment } from '../paths'

/**
 * Public-ish handle returned by `wirePersistence`. Lives on
 * `state.modules.get('persistence')` so `buildFormApi` can plug
 * `form.persist(path)` and `form.clearPersistedDraft(path?)` into
 * the consumer-facing API. Internal — consumers go through the API.
 */
export type PersistenceModule = {
  /**
   * Read-merge-write a single path's current value. Flushes any pending
   * debounced write first so the imperative checkpoint can't be
   * overwritten by a stale-data write that fires immediately after.
   * No-op if the FormStore is disposed.
   */
  writePathImmediately(path: Path): Promise<void>
  /**
   * Wipe the persisted entry. With `path` provided, removes that
   * subpath only (and any matching error entries) and writes back; the
   * entry is removed entirely if the resulting form value is empty.
   * Without `path`, calls the adapter's `removeItem` directly.
   */
  clearPersistedDraft(path?: Path): Promise<void>
  /**
   * Drains any pending debounced or in-flight write. Resolves once
   * storage has the latest opted-in form value. Called by the registry
   * before evicting a FormStore so the last keystroke isn't lost when
   * a component unmounts mid-debounce.
   *
   * Safe to call after `dispose()` — resolves immediately as a no-op.
   */
  awaitPendingWrites(): Promise<void>
  /** Disposer — called from FormStore.dispose. */
  dispose(): void
}

/**
 * Cache key for `state.modules.get(...)`. Only the persistence layer
 * itself + buildFormApi read this — exporting keeps the literal in one
 * place rather than scattering 'persistence' across files.
 */
export const PERSISTENCE_MODULE_KEY = 'persistence'

/**
 * Resolve a `FormStorage` adapter for the given storage kind. Built-in
 * kinds are dynamically imported so a consumer who picks `'local'`
 * never pulls the IndexedDB adapter code. Rollup's
 * side-effect-free graph tree-shakes the unused adapters cleanly.
 *
 * Passing a custom `FormStorage` object bypasses the dispatch and is
 * returned as-is — no dynamic import happens. This is the escape hatch
 * for encrypted stores, cookie-backed stores, native-mobile bridges.
 */
export async function getStorageAdapter(
  storage: FormStorageKind | FormStorage
): Promise<FormStorage> {
  if (typeof storage === 'object') return storage
  switch (storage) {
    case 'local': {
      const { createLocalStorageAdapter } = await import('./local-storage')
      return createLocalStorageAdapter()
    }
    case 'session': {
      const { createSessionStorageAdapter } = await import('./session-storage')
      return createSessionStorageAdapter()
    }
    case 'indexeddb': {
      const { createIndexedDbAdapter } = await import('./indexeddb')
      return createIndexedDbAdapter()
    }
  }
}

/**
 * Persisted payload envelope.
 *
 * `v` is a CX-INTERNAL storage-format version — bumped only when the
 * library's persisted payload schema itself changes (e.g. adding a new
 * field, restructuring `data`). It is NOT consumer-controlled.
 * Schema-driven invalidation uses the storage key's `:${fingerprint}`
 * suffix instead, so consumers don't need to manage versioning at all.
 *
 * `data` mirrors the SSR `SerializedFormData` shape so one deserialiser
 * handles both.
 *
 * Errors are stored source-segregated (matching FormStore's split):
 *   - `schemaErrors` is validation-owned; cleared by reset / submit-success.
 *   - `userErrors` is consumer-owned (written via setFieldErrors* APIs);
 *     persists across schema revalidation and successful submits.
 */
export type PersistedPayload<Form> = {
  readonly v: number
  readonly data: {
    readonly form: Form
    readonly schemaErrors?: ReadonlyArray<readonly [string, ValidationError[]]>
    readonly userErrors?: ReadonlyArray<readonly [string, ValidationError[]]>
    /**
     * Path keys that were in the form's `blankPaths` set at
     * serialisation time. Optional — older v=2 envelopes don't carry it,
     * and forms with no blank paths skip the field too.
     * Replayed into the reactive Set on the next mount so an accidental
     * refresh preserves the user's "displayed empty" state across
     * sessions. Introduced in envelope v=3.
     */
    readonly blankPaths?: ReadonlyArray<string>
  }
}

/**
 * Current CX-internal envelope version. Bumped only when the library
 * changes the persisted payload's structural shape — readers reject
 * envelopes with a different `v`. Schema-content invalidation is
 * handled at the storage key level (the `:${fingerprint}` suffix), so
 * consumers shouldn't see this number.
 *
 * v=3: adds `data.blankPaths` for round-tripping the
 * blank UI state across persistence + SSR. v=2 envelopes
 * are dropped with a one-time dev-warn (commit 6 of the unset feature).
 *
 * v=4: `ValidationError` gained a required `code` field. Persisted
 * `schemaErrors` / `userErrors` now include `code`; v=3 payloads are
 * dropped with a one-time dev-warn.
 */
export const PERSISTED_ENVELOPE_VERSION = 4

/**
 * `value` is expected to be a raw `PersistedPayload` (parsed JSON or
 * structured-cloned object). Returns `null` if the shape doesn't match
 * — the caller falls back to schema defaults.
 *
 * The cx-internal envelope `v` must match `PERSISTED_ENVELOPE_VERSION`;
 * mismatches (older library versions' payloads) are dropped. Schema
 * change detection lives at the storage-key level via the fingerprint
 * suffix.
 */
export function readPersistedPayload<Form>(value: unknown): PersistedPayload<Form> | null {
  if (value === null || value === undefined || typeof value !== 'object') return null
  const envelope = value as Partial<PersistedPayload<Form>>
  if (typeof envelope.v !== 'number') return null
  if (envelope.v !== PERSISTED_ENVELOPE_VERSION) {
    warnVersionMismatch(envelope.v)
    return null
  }
  if (envelope.data === undefined || typeof envelope.data !== 'object') return null
  return envelope as PersistedPayload<Form>
}

/**
 * Tracks envelope versions we've already warned about during this
 * session. The reader hits this for every form mount that finds
 * stale persisted state, so a page with N saved drafts at an old
 * version would otherwise produce N warnings of the same content.
 * Module-scoped Set survives the test-suite hot-reload cycle but
 * resets on each fresh page load — exactly the dedup window we want.
 *
 * `null` in production so the Set allocation tree-shakes out.
 */
const warnedVersions: Set<number> | null = __DEV__ ? new Set<number>() : null

function warnVersionMismatch(observedVersion: number): void {
  if (warnedVersions === null) return
  if (warnedVersions.has(observedVersion)) return
  warnedVersions.add(observedVersion)
  console.warn(
    `[@chemical-x/forms] Dropping persisted draft — envelope v=${observedVersion}, ` +
      `but this version of the library expects v=${PERSISTED_ENVELOPE_VERSION}. ` +
      `The persisted shape changed across releases; older drafts can't be restored. ` +
      `New drafts saved this session will use the current envelope.`
  )
}

export function buildPersistedPayload<Form>(
  form: Form,
  include: 'form' | 'form+errors',
  schemaErrors: ReadonlyMap<string, ValidationError[]>,
  userErrors: ReadonlyMap<string, ValidationError[]>,
  blankPaths?: ReadonlySet<string>
): PersistedPayload<Form> {
  // The blank list is part of the form's restorable UI
  // state — its visibility doesn't depend on the `include` mode
  // (which only governs whether errors come along for the ride).
  // Skip the field when the set is empty so v=3 round-trips with
  // unchanged minimal payload size for forms that never go empty.
  const transientList: ReadonlyArray<string> | undefined =
    blankPaths !== undefined && blankPaths.size > 0 ? [...blankPaths] : undefined

  if (include === 'form') {
    if (transientList === undefined) return { v: PERSISTED_ENVELOPE_VERSION, data: { form } }
    return {
      v: PERSISTED_ENVELOPE_VERSION,
      data: { form, blankPaths: transientList },
    }
  }
  return {
    v: PERSISTED_ENVELOPE_VERSION,
    data: {
      form,
      schemaErrors: [...schemaErrors.entries()].map(([k, v]) => [k, [...v]] as const),
      userErrors: [...userErrors.entries()].map(([k, v]) => [k, [...v]] as const),
      ...(transientList !== undefined ? { blankPaths: transientList } : {}),
    },
  }
}

/**
 * Tiny debounce utility. Returns a `{ schedule, flush, cancel }`
 * triple — `schedule` delays a single pending write, `flush` runs it
 * immediately, `cancel` drops it. Unlike a library `debounce`, this
 * one awaits the underlying async write inside `flush` so callers
 * can await full completion on consumer teardown.
 */
export function createDebouncedWriter(
  write: () => Promise<void>,
  debounceMs: number
): {
  schedule(): void
  flush(): Promise<void>
  cancel(): void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Promise<void> | null = null

  function schedule(): void {
    if (timer !== null) clearTimeout(timer)
    // `debounceMs: 0` is the off switch — fire the write synchronously
    // rather than punting through `setTimeout(fn, 0)` (which queues a
    // macrotask and the browser clamps to ~4 ms anyway).
    if (debounceMs === 0) {
      pending = write().finally(() => {
        pending = null
      })
      return
    }
    timer = setTimeout(() => {
      timer = null
      pending = write().finally(() => {
        pending = null
      })
    }, debounceMs)
  }

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
      pending = write().finally(() => {
        pending = null
      })
    }
    if (pending !== null) await pending
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return { schedule, flush, cancel }
}

/**
 * Resolve the per-form storage KEY BASE. Default is
 * `chemical-x-forms:${formKey}` — consumers who want a different
 * namespace (multi-tenant app, per-user prefix) pass `persist.key`.
 *
 * The full storage key is `${base}:${fingerprint}` (see
 * `resolveStorageKey`). The base is exposed separately so the
 * orphan-cleanup pass can `listKeys(base)` and prune any entry under
 * an old fingerprint.
 */
export function resolveStorageKeyBase(config: PersistConfigOptions, formKey: string): string {
  return config.key ?? `${PERSISTENCE_KEY_PREFIX}${formKey}`
}

/**
 * Resolve the full per-form storage key, composed of the base and the
 * schema's structural fingerprint. The fingerprint suffix gives free
 * automatic invalidation: any structural schema change produces a new
 * fingerprint, so the new mount looks up a fresh key and the old
 * draft becomes an orphan (cleaned up on the same mount via
 * `cleanupOrphanKeys`).
 */
export function resolveStorageKey(
  config: PersistConfigOptions,
  formKey: string,
  fingerprint: string
): string {
  return `${resolveStorageKeyBase(config, formKey)}:${fingerprint}`
}

/**
 * Delete every cx-managed key under `base` that's not the current
 * fingerprint key. Includes:
 *   - Pre-fingerprint legacy keys (no `:` suffix at all) — left
 *     behind by older library versions.
 *   - New-format keys whose fingerprint suffix doesn't match the
 *     current schema.
 *
 * Exact-or-`:`-prefix match prevents collision with sibling forms
 * whose `config.key` shares a string prefix (e.g. `'my-form'` vs
 * `'my-form-2'`).
 *
 * Fire-and-forget; never throws. SSR-guarded by the caller (cleanup
 * runs inside `wirePersistence`, which is itself client-only).
 */
export async function cleanupOrphanKeys(
  adapter: FormStorage,
  base: string,
  currentKey: string
): Promise<void> {
  let keys: string[]
  try {
    keys = await adapter.listKeys(base)
  } catch {
    return
  }
  for (const key of keys) {
    if (key === currentKey) continue
    // Match either the exact base (legacy pre-fingerprint key) or
    // an explicit `:` continuation (new-format with stale fingerprint).
    if (key === base || key.startsWith(`${base}:`)) {
      void adapter.removeItem(key).catch(() => undefined)
    }
  }
}

/**
 * The canonical list of built-in backends. Used by the cross-store
 * cleanup sweep — any standard backend not matching the configured
 * one gets a `removeItem(key)` at mount.
 */
export const STANDARD_STORAGE_KINDS = ['local', 'session', 'indexeddb'] as const

/**
 * Coerce the consumer-facing `PersistConfig` (which accepts shorthand
 * forms — a string backend name, or a custom `FormStorage` adapter) into
 * the resolved options bag the rest of the persistence layer expects.
 *
 * Discrimination rules (in order):
 *
 *   1. `typeof input === 'string'` — `FormStorageKind` shorthand.
 *   2. `'storage' in input`         — already the full options bag.
 *   3. otherwise                    — custom `FormStorage` adapter.
 *
 * Step 3 trusts the caller's type: a `FormStorage` is a duck-typed
 * `{ getItem, setItem, removeItem }` object, and we don't validate
 * the shape — TypeScript already covers that path on the call site.
 *
 * Returning `PersistConfigOptions` (not `PersistConfig`) means the
 * normalized form is referentially distinct from the input — callers
 * can be confident `result.storage` is always present.
 */
export function normalizePersistConfig(input: PersistConfig): PersistConfigOptions {
  if (typeof input === 'string') return { storage: input }
  if ('storage' in input) return input
  return { storage: input }
}

/**
 * Wipe every cx-managed key under `base` from every standard backend.
 * Fire-and-forget. Used when no `persist:` is configured on the form:
 * a previous deployment may have written entries under this base
 * (any fingerprint), and the dev removing persistence should mean the
 * on-disk artifact is gone too — for every fingerprint that ever ran.
 *
 * Includes pre-fingerprint legacy keys (no `:` suffix) and
 * fingerprint-suffixed keys equally. Errors per backend are swallowed.
 */
export async function sweepAllOrphansAcrossStandardStores(base: string): Promise<void> {
  for (const kind of STANDARD_STORAGE_KINDS) {
    try {
      const adapter = await getStorageAdapter(kind)
      const keys = await adapter.listKeys(base)
      for (const key of keys) {
        if (key === base || key.startsWith(`${base}:`)) {
          void adapter.removeItem(key).catch(() => undefined)
        }
      }
    } catch {
      // Backend unavailable (Node, Safari private mode, IDB blocked).
    }
  }
}

/**
 * Cross-store cleanup. Calls `removeItem(key)` on every standard
 * backend that's NOT the configured one — fire-and-forget. Runs once
 * at form mount.
 *
 * Why this matters: if a form was persisting to `'local'` and the dev
 * later switches to `'session'` (or a custom encrypted adapter), the
 * stale entry in `'local'` would otherwise sit there indefinitely,
 * potentially holding sensitive data the dev thought they had moved
 * to a safer store. The configured `storage` option is the source of
 * truth for "where the draft lives now"; everything else is hysteresis
 * from past app states and should be wiped.
 *
 * Implementation note: deletion is inlined per-backend rather than going
 * through `getStorageAdapter`. Inlining avoids dynamic-importing the
 * adapter chunks the consumer specifically chose NOT to use — a form
 * configured for `'local'` shouldn't pull the IndexedDB chunk just to
 * sweep it.
 *
 * If `configured` is a custom `FormStorage` adapter, all three standard
 * backends are swept (we don't know which built-in the dev migrated
 * away from, and we can't reach custom adapters by enumeration).
 *
 * Errors are swallowed — cleanup is best-effort. Backend unavailable
 * (Node, Safari private mode, IDB blocked) is also a silent skip.
 */
/**
 * Cross-store orphan cleanup: wipe every cx-managed key under `base`
 * from each standard backend that's NOT the configured one. Symmetric
 * with `cleanupOrphanKeys` on the configured store: ensures stale
 * drafts don't survive in stores the dev migrated AWAY from. Includes
 * legacy pre-fingerprint keys and stale-fingerprint keys equally.
 *
 * If `configured` is a custom `FormStorage` adapter, all three
 * standard backends are swept (we don't know which built-in the dev
 * migrated away from, and we can't reach custom adapters by
 * enumeration).
 *
 * Fire-and-forget. Per-backend errors swallowed.
 */
export async function sweepNonConfiguredStandardStoresForOrphans(
  configured: FormStorageKind | FormStorage,
  base: string
): Promise<void> {
  const configuredKind = typeof configured === 'string' ? configured : null
  for (const kind of STANDARD_STORAGE_KINDS) {
    if (kind === configuredKind) continue
    try {
      const adapter = await getStorageAdapter(kind)
      const keys = await adapter.listKeys(base)
      for (const key of keys) {
        if (key === base || key.startsWith(`${base}:`)) {
          void adapter.removeItem(key).catch(() => undefined)
        }
      }
    } catch {
      // Backend unavailable.
    }
  }
}

/**
 * Build a sparse object containing only the values at `pathKeys` from
 * `form`. Each PathKey is the canonical JSON-array form
 * (`'["profile","name"]'`) emitted by `canonicalizePath`. Paths whose
 * value is `undefined` in the source (e.g. an optional schema field
 * the user never touched) are skipped — the caller's
 * `mergeSparseHydration` re-fills from schema defaults on read.
 *
 * The returned object structurally-shares with the source: a path that
 * names a container (e.g. `'contacts'` resolving to a whole array) is
 * copied by reference into the sparse output. Per-leaf opt-ins
 * (`'contacts.0.name'`) construct intermediate containers via
 * `setAtPath`.
 */
export function pluckPaths(form: unknown, pathKeys: Iterable<PathKey>): unknown {
  let sparse: unknown = undefined
  for (const pathKey of pathKeys) {
    const segments = parsePathKey(pathKey)
    if (segments === null) continue
    const value = getAtPath(form, segments)
    if (value === undefined) continue
    sparse = setAtPath(sparse ?? {}, segments, value)
  }
  return sparse ?? {}
}

/**
 * Restrict a `(PathKey → ValidationError[])` map to entries whose key
 * appears in `pathKeys`. Used by the persistence writer to drop errors
 * on non-opted-in paths from the persisted envelope — a persisted
 * error without a persisted value would dangle on rehydration (the
 * form would resurrect with no value but a complaint about it).
 */
export function filterErrorsByPaths(
  errors: ReadonlyMap<string, ValidationError[]>,
  pathKeys: ReadonlySet<PathKey>
): Map<string, ValidationError[]> {
  const out = new Map<string, ValidationError[]>()
  for (const [key, value] of errors) {
    if (pathKeys.has(key as PathKey)) out.set(key, value)
  }
  return out
}

/**
 * Merge a sparse persisted form over schema defaults. Returns a new
 * object — neither input is mutated. Used by hydration replay when
 * the persisted payload only contains opted-in paths.
 *
 * Object keys are merged recursively (sparse keys override defaults).
 * Arrays are REPLACED wholesale: if a path resolves to an array in the
 * sparse persisted form, it overrides the schema's array entirely. This
 * is the simpler rule for the common cases (whole-array opt-in via
 * `'contacts'` works; per-leaf opt-in implicitly accepts that schema
 * defaults for sibling leaves at the same array index won't be filled).
 *
 * Primitives in the sparse form override defaults. `null` and explicit
 * primitive values pass through (a persisted `null` is meaningful).
 *
 * **Discriminated unions:** when a path resolves to a DU in the
 * schema AND the sparse value's discriminator differs from the
 * defaults' discriminator (i.e. the persisted draft was written
 * against a different active variant than the schema's first-variant
 * default), the merge REBASES on the matching variant's slim default
 * rather than deep-merging across variants. Without this, deep merge
 * would produce an inconsistent shape carrying BOTH variants' keys
 * (e.g. `{channel: 'sms', number: '...', address: ''}`) — violates
 * the DU's per-variant shape contract and surfaces ghost fields in
 * `form.values`.
 */
export function mergeSparseHydration<F>(
  schemaDefaults: F,
  sparse: unknown,
  schema?: AbstractSchema<unknown, unknown>
): F {
  return mergeDeep(schemaDefaults, sparse, [], schema) as F
}

function mergeDeep(
  target: unknown,
  source: unknown,
  path: readonly Segment[],
  schema: AbstractSchema<unknown, unknown> | undefined
): unknown {
  if (source === undefined) return target
  if (source === null || typeof source !== 'object') return source
  if (Array.isArray(source)) return source
  if (!isPlainRecord(source)) return source
  // DU rebase: if this path is a discriminated union AND target/
  // source describe different variants, rebase target onto the
  // matching variant's slim default before merging. Skips when no
  // schema is provided (legacy callers / tests) or when the DU
  // info isn't available at this path.
  let mergeTarget = target
  if (schema !== undefined) {
    const du = schema.getUnionDiscriminatorAtPath(path as Segment[])
    if (du !== undefined) {
      const sourceDisc = (source as Record<string, unknown>)[du.discriminatorKey]
      const targetDisc = isPlainRecord(target)
        ? (target as Record<string, unknown>)[du.discriminatorKey]
        : undefined
      if (sourceDisc !== undefined && !Object.is(sourceDisc, targetDisc)) {
        const variantDefault = du.getVariantDefault(sourceDisc)
        if (isPlainRecord(variantDefault)) {
          mergeTarget = variantDefault
        }
      }
    }
  }
  const out: Record<string, unknown> = isPlainRecord(mergeTarget) ? { ...mergeTarget } : {}
  for (const key of Object.keys(source)) {
    out[key] = mergeDeep(out[key], (source as Record<string, unknown>)[key], [...path, key], schema)
  }
  return out
}

function parsePathKey(pathKey: PathKey): readonly Segment[] | null {
  try {
    const parsed = JSON.parse(pathKey) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed as readonly Segment[]
  } catch {
    return null
  }
}
