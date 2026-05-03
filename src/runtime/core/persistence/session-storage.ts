import { __DEV__ } from '../dev'
import type { FormStorage } from '../../types/types-api'

/**
 * `sessionStorage` adapter — identical shape to the `localStorage`
 * adapter, different backing store. Tab-scoped: closing the tab
 * drops the entry. Useful for multi-step flows where the user
 * shouldn't see last-session state on a fresh open.
 *
 * Same one-shot dev-warn semantic on setItem failure as the
 * localStorage adapter — see that file's header for rationale.
 */
export function createSessionStorageAdapter(): FormStorage {
  const available = typeof sessionStorage !== 'undefined'
  let warnedOnFailure = false
  return {
    getItem(key) {
      if (!available) return Promise.resolve(undefined)
      try {
        const raw = sessionStorage.getItem(key)
        if (raw === null) return Promise.resolve(undefined)
        return Promise.resolve(JSON.parse(raw) as unknown)
      } catch {
        return Promise.resolve(undefined)
      }
    },
    setItem(key, value) {
      if (!available) return Promise.resolve()
      try {
        sessionStorage.setItem(key, JSON.stringify(value))
      } catch (err) {
        if (__DEV__ && !warnedOnFailure) {
          warnedOnFailure = true
          console.warn(
            '[attaform] sessionStorage write failed; subsequent writes will silently no-op for this form. ' +
              'Common causes: quota exceeded, private-mode storage lock.',
            err
          )
        }
      }
      return Promise.resolve()
    },
    removeItem(key) {
      if (!available) return Promise.resolve()
      try {
        sessionStorage.removeItem(key)
      } catch {
        // SecurityError in private mode — swallow.
      }
      return Promise.resolve()
    },
    listKeys(prefix) {
      if (!available) return Promise.resolve([])
      const out: string[] = []
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i)
          if (k !== null && k.startsWith(prefix) === true) out.push(k)
        }
      } catch {
        // SecurityError under private-mode locks.
      }
      return Promise.resolve(out)
    },
  }
}
