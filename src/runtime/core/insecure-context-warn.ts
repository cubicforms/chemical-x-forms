import { __DEV__ } from './dev'

/**
 * Feature identifiers for one-shot secure-context dev warnings. Each
 * unique key emits at most one warning per app-load — the multi-tab
 * sync module and the built-in persistence storage adapters use this
 * to surface "this feature noop'd because you're on plain HTTP"
 * without spamming the console once per form mount.
 *
 * See the multi-tab-sync recipe's Security section for the rationale
 * — the gate matches `window.isSecureContext`, which is `true` for
 * HTTPS in production AND localhost in development. Plain HTTP on a
 * real hostname noops with this warning.
 */
export type InsecureContextFeature = 'multiTab' | 'persist:local' | 'persist:session'

const warned = new Set<InsecureContextFeature>()

/**
 * Emit a one-shot console warning when a security-gated feature
 * would have instantiated but `window.isSecureContext === false`.
 * No-op in production builds.
 */
export function warnOnceInsecureContext(feature: InsecureContextFeature): void {
  if (!__DEV__) return
  if (warned.has(feature)) return
  warned.add(feature)
  const message = featureMessage(feature)
  console.warn(`[attaform] ${message}`)
}

function featureMessage(feature: InsecureContextFeature): string {
  switch (feature) {
    case 'multiTab':
      return (
        'Multi-tab sync requires a secure context (HTTPS or localhost). ' +
        'Plain HTTP on a real hostname is interceptable by network observers, ' +
        'so the sync module is disabled. Serve over HTTPS in production ' +
        '(or develop on `localhost`) to enable cross-tab synchronisation. ' +
        'Use `multiTab: false` on `useForm` to silence this warning.'
      )
    case 'persist:local':
      return (
        "Built-in `persist: 'local'` storage requires a secure context " +
        '(HTTPS or localhost). Plain HTTP on a real hostname is ' +
        'MITM-interceptable, so the persistence layer is disabled. ' +
        'Serve over HTTPS to enable localStorage persistence, or pass a ' +
        'custom storage adapter to opt out of the secure-context gate.'
      )
    case 'persist:session':
      return (
        "Built-in `persist: 'session'` storage requires a secure context " +
        '(HTTPS or localhost). Plain HTTP on a real hostname is ' +
        'MITM-interceptable, so the persistence layer is disabled. ' +
        'Serve over HTTPS to enable sessionStorage persistence, or pass a ' +
        'custom storage adapter to opt out of the secure-context gate.'
      )
  }
}

/**
 * Test-only helper: reset the one-shot dedup so subsequent
 * `warnOnceInsecureContext` calls fire fresh. Probes that assert
 * "warning fires exactly once across many mounts" need to drain
 * state between scenarios.
 */
export function resetInsecureContextWarnDedup(): void {
  warned.clear()
}

/**
 * Cross-runtime `isSecureContext` probe. Returns `true` when the
 * runtime supports secure-context detection AND the page is in one
 * (HTTPS or localhost). Returns `false` otherwise. SSR (where
 * `window` is undefined) returns `false` — multi-tab sync and
 * built-in persistence are client-only by design.
 */
export function isSecureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true
}
