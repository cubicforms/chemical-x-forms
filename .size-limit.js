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
    // + fingerprint warning landed in the shared core chunk.
    //
    // Raised 12.5 → 14.7 KB on the quiet-ambient-warnings branch
    // (PR #132): lazy ambient-collision walker in useFormContext +
    // source-frame normalization in useAbstractForm.
    //
    // Raised 14.7 → 16 KB on the per-element-persistence-opt-in
    // branch: opt-in registry, sensitive-name regex set + heuristic,
    // SensitivePersistFieldError, deleteAtPath copy-on-write,
    // writePathImmediately + clearPersistedDraft + isEmptyContainer
    // in the persistence layer, form.persist + form.clearPersistedDraft
    // in build-form-api, syncPersistOptIn lifecycle in directive,
    // PersistenceModule + PERSISTENCE_MODULE_KEY plumbing. Measured
    // at 15.08 KB; ~1 KB headroom for the docs/test follow-up commit.
    limit: '16 KB',
    gzip: true,
    modifyEsbuildConfig: asEsm,
  },
  {
    path: 'dist/zod.mjs',
    // Raised from 12 KB → 14.7 KB to accommodate the v4 fingerprint
    // walker (src/runtime/adapters/zod-v4/fingerprint.ts, ~360 LOC of
    // structural-equivalence code that backs the shared-key mismatch
    // warning). Landed in 9bc2b5a / 590a03b / 7b89e64.
    //
    // Raised 14.7 → 16 KB on per-element-persistence-opt-in (mirrors
    // index.mjs — same shared core chunk). Measured at 15.03 KB.
    limit: '16 KB',
    gzip: true,
    ignore: ['zod'],
    modifyEsbuildConfig: asEsm,
  },
  {
    path: 'dist/zod-v3.mjs',
    // Raised 12 → 12.5 → 14.7 KB tracking index.mjs — the shared
    // core chunk carries anonymous-forms + fingerprint warning +
    // (now) lazy ambient-collision walker + source-frame
    // normalization, all inherited by the v3 adapter entry.
    //
    // Raised 14.7 → 16 KB on per-element-persistence-opt-in (mirrors
    // index.mjs). Measured at 14.71 KB.
    limit: '16 KB',
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
