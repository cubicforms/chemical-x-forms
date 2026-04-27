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
 */

const DB_NAME = 'chemical-x-forms'
const STORE_NAME = 'kv'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase | null> | null = null

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
      console.warn('[@chemical-x/forms] IndexedDB open failed; persistence disabled', request.error)
      resolve(null)
    }
    request.onblocked = () => resolve(null)
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
        tx.onabort = () => resolve()
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
}
