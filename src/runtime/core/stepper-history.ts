/**
 * Browser-history primitive for `useStepper`. Encapsulates the only
 * DOM-touching surface in the stepper module so the composable can
 * stay framework-agnostic — no `useRoute()`, no vue-router, no Nuxt
 * coupling.
 *
 * The handle exposes four operations:
 *   - `push(key)` — pushState that records `key` in `?<param>=<key>`
 *     while preserving any other search params already on the URL.
 *   - `replace(key)` — same write, but via replaceState so the
 *     history stack doesn't grow (used for the initial entry and for
 *     `goTo({ replace: true })`).
 *   - `read()` — read the current step key from the URL, or
 *     `undefined` if the param is absent.
 *   - `subscribe(cb)` — register a popstate listener; the callback
 *     receives the key parsed off the new URL (or `undefined`).
 *   - `dispose()` — tear down. Idempotent.
 *
 * SSR safety: when `typeof window === 'undefined'`, the factory
 * returns a no-op handle. Consumers don't have to gate calls — the
 * primitive is the gate.
 */

export type StepperHistoryHandle = {
  push(key: string): void
  replace(key: string): void
  read(): string | undefined
  subscribe(callback: (key: string | undefined) => void): void
  dispose(): void
}

/**
 * No-op handle. Returned by `createStepperHistory` on SSR (no
 * `window`) and assigned directly when the consumer passes
 * `history: false`. Every method is a safe call-site shim.
 */
export const NOOP_STEPPER_HISTORY: StepperHistoryHandle = {
  push() {},
  replace() {},
  read() {
    return undefined
  },
  subscribe() {},
  dispose() {},
}

export function createStepperHistory(param: string): StepperHistoryHandle {
  if (typeof window === 'undefined') return NOOP_STEPPER_HISTORY

  const subscribers: Array<(key: string | undefined) => void> = []
  let disposed = false

  function buildUrl(key: string): string {
    const url = new URL(window.location.href)
    url.searchParams.set(param, key)
    return url.toString()
  }

  function handlePopstate(): void {
    if (disposed) return
    const url = new URL(window.location.href)
    const value = url.searchParams.get(param) ?? undefined
    for (const subscriber of subscribers) subscriber(value)
  }

  window.addEventListener('popstate', handlePopstate)

  return {
    push(key) {
      if (disposed) return
      window.history.pushState({}, '', buildUrl(key))
    },
    replace(key) {
      if (disposed) return
      window.history.replaceState({}, '', buildUrl(key))
    },
    read() {
      const url = new URL(window.location.href)
      return url.searchParams.get(param) ?? undefined
    },
    subscribe(callback) {
      if (disposed) return
      subscribers.push(callback)
    },
    dispose() {
      if (disposed) return
      disposed = true
      subscribers.length = 0
      window.removeEventListener('popstate', handlePopstate)
    },
  }
}
