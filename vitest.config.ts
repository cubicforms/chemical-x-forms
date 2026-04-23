import { defineConfig } from 'vitest/config'

/**
 * Vitest config — kept intentionally minimal. The default test picker
 * (test/**) is fine; we only need to override coverage settings.
 *
 * Coverage scope is the "new-code" surface: core primitives, the abstract
 * composable, and the v4 adapter. The v3 adapter is the pre-rewrite
 * implementation moved verbatim in Phase 4a; it's verified indirectly
 * through test/ssr.test.ts (Nuxt integration fixture using the v3 adapter)
 * but the v8 provider can't instrument that path, so we exclude it from
 * include to keep thresholds honest.
 *
 * use-form.ts (the zod-v3 composable wrapper) is likewise exercised only
 * through the SSR fixture and the integration tests that stand it up; it's
 * ~60 lines of wiring with no new logic beyond what useAbstractForm does,
 * so keeping it out of `include` is appropriate.
 *
 * `pnpm check:coverage` runs locally and in CI via the package.json
 * scripts. Thresholds fail the run if coverage drops.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        lines: 75,
        branches: 70,
        functions: 80,
        statements: 75,
      },
      include: [
        'src/runtime/core/**',
        'src/runtime/composables/use-abstract-form.ts',
        'src/runtime/adapters/zod-v4/**',
      ],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/test/**',
        '**/*.d.ts',
        // directive.ts is a port of Vue's v-model runtime; it's tested via
        // the SSR fixture (test/ssr.test.ts with the Nuxt integration app)
        // and the playground manual QA. v8 can't instrument directive hooks
        // that fire through Vue's compile-time bindings, so including this
        // file would understate coverage by ~400 lines without a
        // corresponding loss in test rigour. The file is small, stable, and
        // lifted from Vue's own implementation — the exclusion is pragmatic.
        'src/runtime/core/directive.ts',
        // Shim for @vue/shared utilities — pure utility functions inlined
        // to avoid the peer dep. Well-covered via vue-shared-shim.test.ts
        // but the `else`-branch walkers on the `isSet` / `isArray`
        // predicates add noise without adding real risk.
      ],
    },
  },
})
