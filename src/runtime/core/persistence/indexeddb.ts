import { __DEV__ } from '../dev'
import type { FormStorage } from '../../types/types-api'

/**
 * Zero-dependency IndexedDB adapter. A single shared DB
 * (`chemical-x-forms`) with a single object store (`kv`). Entries are
 * structured-cloned on write, so `Date` / `Map` / `Set` / typed
 * arrays / nested arrays round-trip without JSON flattening.
 *
 * Size budget: ≤1 KB gzip (verified via size-limit). Consumers who
 * want richer IDB features (indexes, cursors, transactions) should
 * roll their own `FormStorage`.
 *
 * Open failures (private mode, blocked DB, unsupported environment)
 * resolve `dbPromise` to `null`; subsequent reads/writes silently
 * no-op so the form stays usable. A one-shot dev warning surfaces
 * the degradation so the developer notices.
 */

const DB_NAME = 'chemical-x-forms'
const STORE_NAME = 'kv'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase | null> | null = null
// One-shot dev-warn flags for adapter-level failures. Module-scoped
// so the warning only fires once per process — re-opening the DB
// after `__resetIndexedDbForTests` clears `dbPromise` but leaves
// these flags alone (tests that want a fresh warn-state should
// reset them via the test hook below).
let warnedOnOpenFailure = false
let warnedOnWriteFailure = false

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise !== null) return dbPromise
  if (typeof indexedDB === 'undefined') {
    dbPromise = Promise.resolve(null)
    return dbPromise
  }
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      // Drop to null so subsequent calls don't retry a broken open —
      // the form just runs without persistence.
      if (__DEV__ && !warnedOnOpenFailure) {
        warnedOnOpenFailure = true
        console.warn(
          '[@chemical-x/forms] IndexedDB open failed; persistence disabled. ' +
            'Common causes: private-mode disabled IDB, browser quota policy.',
          request.error
        )
      }
      resolve(null)
    }
    request.onblocked = () => {
      if (__DEV__ && !warnedOnOpenFailure) {
        warnedOnOpenFailure = true
        console.warn(
          '[@chemical-x/forms] IndexedDB open blocked (another tab holds an older version); persistence disabled until the conflict resolves.'
        )
      }
      // `onblocked` is transient — the holding tab can close at any
      // moment. Clear the cache so the next persistence call retries
      // the open instead of permanently no-opping.
      dbPromise = null
      resolve(null)
    }
  })
  return dbPromise
}

/**
 * Read path: resolve on `request.onsuccess` with the fetched value.
 * `readonly` transactions are atomic by nature — there's no commit
 * phase to worry about, so waiting for the transaction's
 * `oncomplete` would be redundant.
 */
function runReadOp<T>(fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (db === null) return resolve(undefined)
        let tx: IDBTransaction
        try {
          tx = db.transaction(STORE_NAME, 'readonly')
        } catch {
          return resolve(undefined)
        }
        const store = tx.objectStore(STORE_NAME)
        const request = fn(store)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(undefined)
        tx.onerror = () => resolve(undefined)
      })
  )
}

/**
 * Write path: resolve on `tx.oncomplete` (the spec-defined commit
 * signal), NOT on `request.onsuccess` (which fires per-request,
 * before the transaction commits).
 *
 * Resolving on `onsuccess` means a tab close, power loss, or
 * browser crash between the request succeeding and the transaction
 * committing silently loses the write — the Promise already
 * resolved successfully. Aborts (quota exceeded, version change,
 * constraint violation) likewise roll back after `onsuccess` fired.
 *
 * Resolving on `oncomplete` makes durability a precondition for
 * the Promise settlement; `onabort` catches the failure cases so
 * the Promise resolves to `undefined` instead of hanging.
 */
function runWriteOp(fn: (store: IDBObjectStore) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (db === null) return resolve()
        let tx: IDBTransaction
        try {
          tx = db.transaction(STORE_NAME, 'readwrite')
        } catch {
          return resolve()
        }
        fn(tx.objectStore(STORE_NAME))
        tx.oncomplete = () => resolve()
        tx.onabort = () => {
          // QuotaExceededError, version-change, constraint violation
          // — all surface as a transaction abort. One-shot dev warn so
          // the developer notices instead of silently losing writes.
          if (__DEV__ && !warnedOnWriteFailure) {
            warnedOnWriteFailure = true
            console.warn(
              '[@chemical-x/forms] IndexedDB transaction aborted; subsequent writes will silently no-op. ' +
                'Common cause: storage quota exceeded.',
              tx.error
            )
          }
          resolve()
        }
        tx.onerror = () => resolve()
      })
  )
}

export function createIndexedDbAdapter(): FormStorage {
  return {
    async getItem(key) {
      return await runReadOp<unknown>((store) => store.get(key) as IDBRequest<unknown>)
    },
    async setItem(key, value) {
      await runWriteOp((store) => void store.put(value, key))
    },
    async removeItem(key) {
      await runWriteOp((store) => void store.delete(key))
    },
    async listKeys(prefix) {
      // `IDBKeyRange.bound(prefix, prefix + '￿')` would skip cx
      // keys that contain the U+FFFF code unit; safer to fetch all
      // keys and filter in-process. The cx-managed key namespace is
      // tiny in practice, so the cost is negligible.
      const all = await runReadOp<IDBValidKey[]>(
        (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>
      )
      if (all === undefined) return []
      const out: string[] = []
      for (const k of all) {
        if (typeof k === 'string' && k.startsWith(prefix)) out.push(k)
      }
      return out
    },
  }
}

/**
 * Test hook: reset the cached DB promise so a subsequent call re-
 * opens the database. Production code should never call this —
 * exposed for `fake-indexeddb`-backed tests that tear down the
 * in-memory DB between cases.
 */
export function __resetIndexedDbForTests(): void {
  dbPromise = null
  warnedOnOpenFailure = false
  warnedOnWriteFailure = false
}
