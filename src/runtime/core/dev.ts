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
 */
export const __DEV__: boolean =
  typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'production'
