/**
 * Size-limit configuration. Moved out of package.json so each entry
 * can override esbuild's bundle format — measuring in ESM avoids the
 * `empty-import-meta` warning that fires when esbuild's default IIFE
 * format bundles a module using `import.meta.url` (Nuxt module) or
 * `import.meta.server` (Nuxt plugin). The gzipped size measurement
 * is the same either way; IIFE vs ESM only affects the wrapper.
 */

/** @param {import('esbuild').BuildOptions} config */
const asEsm = (config) => ({ ...config, format: 'esm' })

export default [
  {
    path: 'dist/index.mjs',
    // Raised 12 → 12.5 KB after the anonymous-forms work (PR #117)
    // + fingerprint warning landed in the shared core chunk. Text-
    // shortening took this as low as 11.91 KB on its own; the
    // shared-chunk footprint from both features pushes it back to
    // 12.11 KB post-merge. 12.5 KB reflects the honest cost with
    // ~400 B headroom.
    limit: '12.5 KB',
    gzip: true,
    modifyEsbuildConfig: asEsm,
  },
  {
    path: 'dist/zod.mjs',
    // Raised from 12 KB → 14.7 KB to accommodate the v4 fingerprint
    // walker (src/runtime/adapters/zod-v4/fingerprint.ts, ~360 LOC of
    // structural-equivalence code that backs the shared-key mismatch
    // warning). Landed in 9bc2b5a / 590a03b / 7b89e64.
    limit: '14.7 KB',
    gzip: true,
    ignore: ['zod'],
    modifyEsbuildConfig: asEsm,
  },
  {
    path: 'dist/zod-v3.mjs',
    // Raised 12 → 12.5 KB for the same reason as index.mjs — the
    // shared core chunk now carries anonymous-forms + fingerprint
    // warning code, and zod-v3.mjs inherits that cost. Adapter-
    // specific trims already applied; ~400 B headroom under the
    // new cap.
    limit: '12.5 KB',
    gzip: true,
    ignore: ['zod', 'lodash-es'],
    modifyEsbuildConfig: asEsm,
  },
  {
    path: 'dist/nuxt.mjs',
    limit: '6 KB',
    gzip: true,
    ignore: ['@nuxt/kit', 'nuxt/app'],
    modifyEsbuildConfig: asEsm,
  },
  {
    path: 'dist/vite.mjs',
    limit: '4 KB',
    gzip: true,
    ignore: ['vite'],
    modifyEsbuildConfig: asEsm,
  },
  {
    path: 'dist/transforms.mjs',
    limit: '6 KB',
    gzip: true,
    ignore: ['@vue/compiler-core'],
    modifyEsbuildConfig: asEsm,
  },
]
