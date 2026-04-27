/**
 * Portable dev-mode flag. True when the consumer's bundle / runtime
 * signals a non-production build; false in production.
 *
 * Resolves in this order:
 *   1. `process.env.NODE_ENV` — replaced at build time by Vite,
 *      Webpack, Rollup + `@rollup/plugin-replace`, and read directly
 *      in Node.
 *   2. Falls back to `false` when `process` is undeclared (some
 *      sandboxed runtimes).
 *
 * Using this instead of `import.meta.dev` (Vite / Nuxt-specific)
 * keeps the library portable across bundlers and avoids esbuild's
 * `empty-import-meta` warning in non-ESM contexts.
 *
 * **Trade-off (browser CDN consumers).** When the library is
 * imported directly via a browser-native ESM CDN (esm.sh, Skypack,
 * unpkg) WITHOUT a bundler in front, `process` is undeclared and
 * `__DEV__` permanently resolves to `false` — every dev-only warning
 * is silenced even when the consumer is debugging. The library
 * works correctly; only the diagnostic surface degrades. The fix is
 * to put a bundler (Vite, Webpack, Rollup, esbuild) in the consumer
 * pipeline so `process.env.NODE_ENV` gets replaced. This is the
 * recommended path for any production app; CDN imports are useful
 * for prototyping but lose tree-shaking + dev diagnostics either way.
 *
 * Switching to `import.meta.env.DEV` would resolve correctly under
 * Vite but break Node consumers (no `import.meta.env`) and
 * pre-bundled distributions (esbuild emits an `empty-import-meta`
 * warning when `import.meta` resolves to `{}`). The current
 * `process.env.NODE_ENV` choice is the broadest-compatibility option.
 */
export const __DEV__: boolean =
  typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'production'
