/**
 * Portable SSR detection. The plugin captures this value at install time and
 * exposes it via the registry so every runtime branch reads a single source
 * of truth instead of sniffing `import.meta.*` (bundler-specific) at each
 * call site.
 *
 * Consumers can override explicitly via `createChemicalXForms({ ssr: true })`;
 * the default heuristic handles the common Node-vs-browser split without
 * relying on any bundler-injected flag.
 */

export interface SSRDetectOptions {
  override?: boolean
}

/**
 * Returns true when running in a server-rendering context (no `window` / no
 * `document`). Explicit override always wins.
 *
 * Note: JSDOM-based test environments define `window`, so tests that need to
 * exercise SSR code paths must pass `{ override: true }` explicitly.
 */
export function detectSSR(options: SSRDetectOptions = {}): boolean {
  if (options.override !== undefined) return options.override
  return typeof window === 'undefined' && typeof document === 'undefined'
}
