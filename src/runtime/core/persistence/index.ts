import type {
  FormStorage,
  FormStorageKind,
  PersistConfig,
  PersistConfigOptions,
  ValidationError,
} from '../../types/types-api'
import { PERSISTENCE_KEY_PREFIX } from '../defaults'
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
 * Versioned payload shape. A consumer who bumps `persist.version`
 * invalidates every existing entry — the reader drops entries whose
 * `v` doesn't match. `data` mirrors the SSR `SerializedFormData`
 * shape so one deserialiser handles both.
 *
 * Errors are stored source-segregated (matching FormStore's split):
 *   - `schemaErrors` is validation-owned; cleared by reset / submit-success.
 *   - `userErrors` is consumer-owned (written via setFieldErrors* APIs);
 *     persists across schema revalidation and successful submits.
 *
 * The two are surfaced separately on the persisted payload so the
 * lifecycle distinction round-trips through reload. Default
 * `PersistConfig.version` bumped to 2 for the 0.12 release — older v1
 * payloads (single flat `errors` field) are dropped silently on read.
 */
export type PersistedPayload<Form> = {
  readonly v: number
  readonly data: {
    readonly form: Form
    readonly schemaErrors?: ReadonlyArray<readonly [string, ValidationError[]]>
    readonly userErrors?: ReadonlyArray<readonly [string, ValidationError[]]>
  }
}

/**
 * `value` is expected to be a raw `PersistedPayload` (parsed JSON or
 * structured-cloned object). Returns `null` if the shape doesn't match
 * — the caller falls back to schema defaults.
 */
export function readPersistedPayload<Form>(
  value: unknown,
  expectedVersion: number
): PersistedPayload<Form> | null {
  if (value === null || value === undefined || typeof value !== 'object') return null
  const envelope = value as Partial<PersistedPayload<Form>>
  if (typeof envelope.v !== 'number' || envelope.v !== expectedVersion) return null
  if (envelope.data === undefined || typeof envelope.data !== 'object') return null
  return envelope as PersistedPayload<Form>
}

export function buildPersistedPayload<Form>(
  form: Form,
  include: 'form' | 'form+errors',
  schemaErrors: ReadonlyMap<string, ValidationError[]>,
  userErrors: ReadonlyMap<string, ValidationError[]>,
  version: number
): PersistedPayload<Form> {
  if (include === 'form') return { v: version, data: { form } }
  return {
    v: version,
    data: {
      form,
      schemaErrors: [...schemaErrors.entries()].map(([k, v]) => [k, [...v]] as const),
      userErrors: [...userErrors.entries()].map(([k, v]) => [k, [...v]] as const),
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
 * Resolve the per-form storage key. Default is
 * `chemical-x-forms:${formKey}` — consumers who want a different
 * namespace (multi-tenant app, per-user prefix) pass `persist.key`.
 */
export function resolveStorageKey(config: PersistConfigOptions, formKey: string): string {
  return config.key ?? `${PERSISTENCE_KEY_PREFIX}${formKey}`
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
 * Calls `removeItem(key)` on every standard backend (`'local'` /
 * `'session'` / `'indexeddb'`) — fire-and-forget. Used when no
 * `persist:` is configured on the form: a previous deployment may
 * have written an entry under this key, and the dev removing
 * persistence should mean the on-disk artifact is gone too. Same
 * fire-and-forget posture as `sweepNonConfiguredStandardStores`;
 * errors are swallowed.
 */
export function sweepAllStandardStores(key: string): void {
  for (const kind of STANDARD_STORAGE_KINDS) {
    void removeFromStandardBackend(kind, key).catch(() => undefined)
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
export function sweepNonConfiguredStandardStores(
  configured: FormStorageKind | FormStorage,
  key: string
): void {
  const configuredKind = typeof configured === 'string' ? configured : null
  for (const kind of STANDARD_STORAGE_KINDS) {
    if (kind === configuredKind) continue
    void removeFromStandardBackend(kind, key).catch(() => undefined)
  }
}

async function removeFromStandardBackend(kind: FormStorageKind, key: string): Promise<void> {
  if (kind === 'local') {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.removeItem(key)
    } catch {
      // Private-mode write guards / SecurityError — swallow.
    }
    return
  }
  if (kind === 'session') {
    if (typeof sessionStorage === 'undefined') return
    try {
      sessionStorage.removeItem(key)
    } catch {
      // Same guards as localStorage.
    }
    return
  }
  // kind === 'indexeddb'
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>((resolve) => {
    let request: IDBOpenDBRequest
    try {
      // Same DB / store / version as the full IDB adapter
      // (see `./indexeddb.ts`). Opening at the same version skips the
      // upgrade path entirely; if the DB doesn't yet exist (no
      // persistence ever wrote here), `onupgradeneeded` creates the
      // store and the subsequent `delete(key)` is a no-op — cheap.
      request = indexedDB.open('chemical-x-forms', 1)
    } catch {
      return resolve()
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
    }
    request.onsuccess = () => {
      const db = request.result
      try {
        const tx = db.transaction('kv', 'readwrite')
        tx.objectStore('kv').delete(key)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onabort = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => {
          db.close()
          resolve()
        }
      } catch {
        db.close()
        resolve()
      }
    }
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
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
 */
export function mergeSparseHydration<F>(schemaDefaults: F, sparse: unknown): F {
  return mergeDeep(schemaDefaults, sparse) as F
}

function mergeDeep(target: unknown, source: unknown): unknown {
  if (source === undefined) return target
  if (source === null || typeof source !== 'object') return source
  if (Array.isArray(source)) return source
  if (!isPlainRecord(source)) return source
  const out: Record<string, unknown> = isPlainRecord(target) ? { ...target } : {}
  for (const key of Object.keys(source)) {
    out[key] = mergeDeep(out[key], (source as Record<string, unknown>)[key])
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
