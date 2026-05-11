/**
 * Portable SSR detection. The plugin captures this value at install time and
 * exposes it via the registry so every runtime branch reads a single source
 * of truth instead of sniffing `import.meta.*` (bundler-specific) at each
 * call site.
 *
 * Consumers can override the heuristic explicitly via
 * `createAttaform({ ssr: true })`; the default handles the common
 * Node-vs-browser split without relying on any bundler-injected flag.
 */

export interface SSRDetectOptions {
  /**
   * Force SSR-vs-client mode, bypassing the `typeof window` heuristic.
   * `true` activates the SSR code paths (no devtools, no persistence
   * wiring, payload serialisation enabled); `false` forces client mode.
   * The Nuxt plugin sets this from `import.meta.server` so SSR detection
   * never depends on whether `window` is polyfilled. Tests that need to
   * exercise the SSR code paths under jsdom pass `ssr: true`.
   */
  ssr?: boolean
}

/**
 * Returns true when running in a server-rendering context (no `window` / no
 * `document`). Explicit `ssr` flag always wins.
 *
 * Note: JSDOM-based test environments define `window`, so tests that need to
 * exercise SSR code paths must pass `{ ssr: true }` explicitly.
 */
export function detectSSR(options: SSRDetectOptions = {}): boolean {
  if (options.ssr !== undefined) return options.ssr
  return typeof window === 'undefined' && typeof document === 'undefined'
}
