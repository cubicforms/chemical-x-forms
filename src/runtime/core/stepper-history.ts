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

  // Some embedded contexts can't accept a same-document URL rewrite —
  // most commonly `about:srcdoc` iframes (e.g. Vue REPL previews),
  // sandboxed iframes, and data: URLs. In those, `buildUrl(key)`
  // resolves to a URL whose origin doesn't match the document's
  // (the document inherits the parent's origin, but the synthesized
  // URL keeps the scheme), and `history.pushState` / `replaceState`
  // throw `SecurityError`. The user-visible step state still works
  // — `current` / `goTo()` drive the form via the in-memory stepper
  // — they just won't appear in the URL bar. Silently swallowing
  // keeps the preview functional without coupling the library to
  // embed-detection logic.
  function safeWriteState(key: string, op: 'push' | 'replace'): void {
    try {
      const fn = op === 'push' ? window.history.pushState : window.history.replaceState
      fn.call(window.history, {}, '', buildUrl(key))
    } catch {
      // SecurityError or similar — origin mismatch, sandboxed history,
      // or a host that's locked down the History API. No remediation
      // possible here; the in-memory stepper state remains the source
      // of truth.
    }
  }

  return {
    push(key) {
      if (disposed) return
      safeWriteState(key, 'push')
    },
    replace(key) {
      if (disposed) return
      safeWriteState(key, 'replace')
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
