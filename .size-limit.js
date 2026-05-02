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

/**
 * For Node-side tooling entries (Nuxt module, Vite plugin, compiler
 * transforms): tell esbuild the bundle is for Node so `node:*`
 * builtins resolve as externals instead of failing with
 * `Could not resolve "node:path"`.
 */
/** @param {import('esbuild').BuildOptions} config */
const asEsmNode = (config) => ({ ...config, format: 'esm', platform: 'node' })

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
    //
    // Raised 16 → 17 KB on the structural-completeness +
    // fingerprint-persistence branch: mergeStructural +
    // setAtPathWithSchemaFill in path-walker, schema.getDefaultAtPath
    // plumbing, cleanupOrphanKeys + sweepNonConfiguredStandardStores-
    // ForOrphans + sweepAllOrphansAcrossStandardStores, FormStorage
    // listKeys across three backends, fingerprint-suffixed key
    // composition.
    //
    // Raised 17 → 18 KB on the deep-QA cleanup branch:
    //   - DevTools redaction walker (redactSensitiveLeaves +
    //     expanded SENSITIVE_NAME_PATTERNS) for the timeline + inspector
    //   - one-shot adapter dev warnings (localStorage / sessionStorage /
    //     IDB) on quota / open / abort failures
    //   - createChemicalXForms idempotent install dev-warn
    //   - v-register unsupported-element dev-warn (vRegisterDynamic)
    //   - validate() outside-effect-scope dev-warn (process-form)
    //   - schema-error gen-check on the submit success/failure paths
    //   - parseApiErrors maxTotalSegments cap
    //   - registerDrain + awaitPendingWrites on FormStore + Registry
    //     (drain-on-evict + Registry.shutdown)
    //   - <option> static-text fallback in the select transform
    //
    // Raised 18 → 19 KB on the useRegister branch: useRegister
    // composable + WeakSet sentinel (registerOwners), directive
    // tri-state guard with binding.instance.subTree.component lookup,
    // setAssignFunction undefined-no-op + pre-installed-assigner
    // respect, select-transform idempotency marker + kebab-case
    // extension (NATIVE_FORM_TAGS + hasHyphen gate). Measured at
    // 18.23 KB; 0.77 KB headroom for the docs/test follow-up commit.
    //
    // Raised 19 → 24 KB on the slim-primitive write-contract branch:
    // AbstractSchema.getSlimPrimitiveTypesAtPath + zod-v4 walker
    // (slim-primitives.ts), runtime gate (slim-primitive-gate.ts)
    // with one-shot dev-warn dedupe, boolean threading through every
    // setValueAtPath caller (register-api / build-form-api /
    // field-arrays / directive default assigner), vRegisterSelect
    // _assigning write-conditional, default-values issue-classifier
    // (slimPrimitivesOf + slimKindOf at issue path) replacing the
    // refinement-strip behaviour in zod-v4/v3 adapters. Measured at
    // 19.01 KB; the 5 KB ceiling gives runway for upcoming work
    // without per-PR bumps.
    //
    // Raised 24 → 28 KB on the 0.14 surface-refactor branch:
    //   - schema-driven coercion (schema-coerce.ts:
    //     defaultCoercionRules, defineCoercion, resolveCoercionIndex,
    //     buildCoerceFn / buildElementCoerceFn) wired through every
    //     register() + plugin defaults
    //   - register transforms pipeline (RegisterTransform threading
    //     through the directive assigner across all four v-register
    //     variants)
    //   - discriminated-union variant memory (per-variant subtree
    //     snapshot / restore on discriminator change, reset /
    //     resetField interactions)
    //   - useForm return surface rewrite — drillable callable proxies
    //     (errors-proxy.ts, surface-proxy.ts, leaf-aware FieldStateMap)
    //     + meta.errors flat aggregate + meta.instanceId
    //   - parseApiErrors bare-string entry shape
    //   - DOM force-sync after default assigner (4 v-register variants)
    //   - debounceMs: 0 sync-fire path in createDebouncedWriter +
    //     field-validation scheduler
    // Measured at 26.39 KB; 1.61 KB headroom for the follow-up docs /
    // test commit.
    limit: '28 KB',
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
    //
    // Raised 16 → 17 KB tracking index.mjs's structural-completeness +
    // fingerprint-persistence bump.
    //
    // Raised 17 → 18 KB tracking index.mjs's deep-QA cleanup bump
    // (same shared core chunk: DevTools redaction, dev-warns,
    // gen-checks, registry drain).
    //
    // Raised 18 → 19 KB tracking index.mjs's useRegister bump (same
    // shared core chunk: useRegister + sentinel + directive tri-state
    // + setAssignFunction undefined-no-op + select-transform
    // idempotency / kebab-case extension).
    //
    // Raised 19 → 24 KB tracking index.mjs's slim-primitive
    // write-contract bump (same shared core chunk + zod-v4
    // slim-primitives walker).
    //
    // Raised 24 → 28 KB tracking index.mjs's 0.14 surface-refactor
    // bump (same shared core chunk: coerce + transforms + DU memory
    // + meta-surface rewrite + DOM force-sync + sync-debounce).
    // Measured at 25.71 KB.
    limit: '28 KB',
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
    //
    // Raised 16 → 17 KB tracking index.mjs's structural-completeness +
    // fingerprint-persistence bump.
    //
    // Raised 17 → 18 KB on the deep-QA cleanup branch (same shared
    // core chunk as index.mjs PLUS v3-specific work: bounded
    // wrapper-peel recursion, ZodPipeline / ZodReadonly / ZodBranded /
    // ZodCatch handling, Symbol path-segment coercion).
    //
    // Raised 18 → 19 KB tracking index.mjs's useRegister bump (same
    // shared core chunk).
    //
    // Raised 19 → 24 KB tracking index.mjs's slim-primitive
    // write-contract bump (same shared core chunk + v3-inline
    // slimPrimitivesV3 walker on the v3 adapter).
    //
    // Raised 24 → 28 KB tracking index.mjs's 0.14 surface-refactor
    // bump (same shared core chunk + UseFormConfigurationWithZod
    // adding coerce / rememberVariants fields + getUnionDiscriminator
    // plumbing in the v3 adapter). Measured at 25.68 KB.
    limit: '28 KB',
    gzip: true,
    ignore: ['zod', 'lodash-es'],
    modifyEsbuildConfig: asEsm,
  },
  {
    path: 'dist/nuxt.mjs',
    limit: '6 KB',
    gzip: true,
    ignore: ['@nuxt/kit', 'nuxt/app'],
    modifyEsbuildConfig: asEsmNode,
  },
  {
    path: 'dist/vite.mjs',
    limit: '4 KB',
    gzip: true,
    ignore: ['vite'],
    modifyEsbuildConfig: asEsmNode,
  },
  {
    path: 'dist/transforms.mjs',
    limit: '6 KB',
    gzip: true,
    ignore: ['@vue/compiler-core'],
    modifyEsbuildConfig: asEsmNode,
  },
]
