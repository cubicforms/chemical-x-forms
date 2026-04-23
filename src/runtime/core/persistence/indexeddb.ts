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

function runOp<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (db === null) return resolve(undefined)
        let tx: IDBTransaction
        try {
          tx = db.transaction(STORE_NAME, mode)
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

export function createIndexedDbAdapter(): FormStorage {
  return {
    async getItem(key) {
      return await runOp<unknown>('readonly', (store) => store.get(key) as IDBRequest<unknown>)
    },
    async setItem(key, value) {
      await runOp<IDBValidKey>('readwrite', (store) => store.put(value, key))
    },
    async removeItem(key) {
      await runOp<undefined>('readwrite', (store) => store.delete(key) as IDBRequest<undefined>)
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
