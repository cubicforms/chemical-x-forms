import type {
  FormStorage,
  FormStorageKind,
  PersistConfig,
  ValidationError,
} from '../../types/types-api'
import { PERSISTENCE_KEY_PREFIX } from '../defaults'

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
export function resolveStorageKey(config: PersistConfig, formKey: string): string {
  return config.key ?? `${PERSISTENCE_KEY_PREFIX}${formKey}`
}
