import { __DEV__ } from '../dev'
import type { FormStorage } from '../../types/types-api'

/**
 * `localStorage` adapter for `FormStorage`. Wraps the sync Web Storage
 * API in `async` functions — the extra microtask is negligible and the
 * uniform Promise contract means every caller handles backends the same
 * way.
 *
 * Serialises payloads with `JSON.stringify`. Callers pass plain data;
 * non-JSON values (`Date` / `Map` / `Set` / typed arrays) round-trip as
 * strings / objects. Switch to the `indexeddb` backend if you need
 * structured-clone fidelity.
 *
 * Missing / unavailable `localStorage` (Node, Safari private mode in
 * older versions, disabled by the user) is handled by a `typeof` gate;
 * every method becomes a no-op so the form stays usable.
 *
 * On the FIRST `setItem` failure (quota exceeded, security error in
 * private mode), the adapter logs a one-shot dev warning so the
 * developer notices instead of silently losing data. Subsequent
 * failures stay silent — bouncing a warning per keystroke would be
 * worse than the original silent-fail behavior.
 */
export function createLocalStorageAdapter(): FormStorage {
  const available = typeof localStorage !== 'undefined'
  // Per-adapter flag: trips on the first setItem failure and stays
  // tripped for the lifetime of the adapter instance.
  let warnedOnFailure = false
  return {
    getItem(key) {
      if (!available) return Promise.resolve(undefined)
      try {
        const raw = localStorage.getItem(key)
        if (raw === null) return Promise.resolve(undefined)
        return Promise.resolve(JSON.parse(raw) as unknown)
      } catch {
        // JSON.parse failure or SecurityError — drop the stale entry so
        // the next write can replace it. Caller handles undefined as
        // "no persisted state".
        return Promise.resolve(undefined)
      }
    },
    setItem(key, value) {
      if (!available) return Promise.resolve()
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (err) {
        // Quota-exceeded or SecurityError — swallow at runtime. In dev,
        // surface the first failure so the developer knows persistence
        // has degraded. Silent on subsequent failures (debounced writes
        // would otherwise spam the console once per keystroke).
        if (__DEV__ && !warnedOnFailure) {
          warnedOnFailure = true
          console.warn(
            '[attaform] localStorage write failed; subsequent writes will silently no-op for this form. ' +
              'Common causes: quota exceeded, private-mode storage lock. ' +
              'Switch to `persist: "indexeddb"` for larger payloads.',
            err
          )
        }
      }
      return Promise.resolve()
    },
    removeItem(key) {
      if (!available) return Promise.resolve()
      try {
        localStorage.removeItem(key)
      } catch {
        // Private-mode write guards occasionally throw here too.
      }
      return Promise.resolve()
    },
    listKeys(prefix) {
      if (!available) return Promise.resolve([])
      const out: string[] = []
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k !== null && k.startsWith(prefix) === true) out.push(k)
        }
      } catch {
        // SecurityError under private-mode locks.
      }
      return Promise.resolve(out)
    },
  }
}
