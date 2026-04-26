# Changelog

## Unreleased

**Validation refactor: errors as a pure function of `(value, schema) +
injected user errors`.** The data layer (errors as state) is now fully
separable from the rendering layer (when to show them). Schema-driven
errors and consumer-injected errors live in distinct internal stores;
each has its own lifecycle, and the merged read view stays unchanged
for consumers. See the [migration guide](./docs/migration/0.11-to-0.12.md)
for the full set of changes.

- **Breaking — live validation by default.** `fieldValidation.on`
  defaulted to `'none'` in 0.11; it now defaults to `'change'`.
  Errors track the live `(value, schema)` instead of going stale
  until the next submit. `'none'` remains as the explicit opt-out
  for "submit-only" workflows. Migration: pass
  `fieldValidation: { on: 'none' }` to keep the old behaviour.
- **Breaking — errors split by source.** `setFieldErrors` /
  `addFieldErrors` / `setFieldErrorsFromApi` write to a separate
  user-error store internally; their entries now SURVIVE schema
  revalidation AND successful submits (only `clearFieldErrors` /
  `reset` / `resetField` remove them). Public surfaces (`fieldErrors`,
  `state.isValid`, `getFieldState(path).errors`) merge schema +
  user transparently — schema first, user second.
  `clearFieldErrors(path?)` deliberately clears both stores at the
  given path (pragmatic "make these errors go away" semantic).
- **Breaking — persistence payload v2.** `PersistConfig.version`
  defaults to `2` (was `1`). On-disk shape: `data.errors` is gone,
  replaced by `data.schemaErrors` + `data.userErrors`. Old v1
  payloads are dropped silently on read; users see one fresh-defaults
  render after upgrading.
- **Breaking — SSR / hydration payload split.** `SerializedFormData`
  and `FormStoreHydration` types now carry `schemaErrors` +
  `userErrors` separately. Nuxt + bare-Vue serialize/hydrate
  bridges handle this transparently; only consumers reading the
  payload struct directly need to update.
- **Breaking — legacy `state.errors` writers removed.** The `errors`
  Map alias and `setErrorsForPath` / `setAllErrors` / `addErrors` /
  `clearErrors` methods on `FormStore` are gone. Replacements:
  `state.schemaErrors` + `state.userErrors` for direct access;
  `state.setSchemaErrorsForPath` + `state.setAllSchemaErrors` /
  `state.setAllUserErrors` / `state.addUserErrors` /
  `state.clearSchemaErrors` / `state.clearUserErrors` for writes.
  Most consumers never touched these — the public
  `setFieldErrors*` + `clearFieldErrors` surfaces still cover the
  standard use cases.
- **New — construction-time schema-error seed.** Strict-mode forms
  whose default values fail schema validation now report errors
  immediately at construction (no user mutation or `validateAsync`
  call required). Lax-mode forms still skip the seed; hydration
  takes precedence over the seed when present. Mostly a quality-of-
  life win for SSR — `<pre>{{ form.fieldErrors }}</pre>` now
  matches the client's first frame.

## v0.11.1
**Dev-mode ergonomics for the ambient `useFormContext` warning.**

- **Lazy warning, not eager.** `useForm()` no longer prints the
  duplicate-ambient-provide warning at every call site. Components
  that intentionally pile multiple `useForm()` calls into one setup
  (spike pages, exercise harnesses) stay silent unless a descendant
  actually consumes the ambient slot. The warning fires once, at the
  consume site (`useFormContext<F>()` with no key), and lists each
  offending `useForm()` call by source frame for click-through in
  DevTools.
- **Keyed forms bypass the ambient slot.** `useForm({ schema, key })`
  no longer fills the ambient `provide`/`inject` slot — keyed forms
  are addressable explicitly via `useFormContext<F>(key)`, and the
  ambient slot is reserved for anonymous siblings. This cleanly
  separates the two resolution modes and stops keyed forms from
  silently winning the ambient slot over a sibling anonymous form.

  **Behaviour change** (technically a breaking dev-time semantic, no
  type-system surface change): a descendant of a keyed-only parent
  that calls `useFormContext<F>()` with no key now throws "no ambient
  form context" instead of resolving to the keyed form. The throw is
  the right error: the form has a name; address it.

## v0.11.0
**What's new at a glance**

- **`state` — the form-level reactive bundle.** Nine form-level
  scalars (`isDirty`, `isValid`, `isSubmitting`, `isValidating`,
  `submitCount`, `submitError`, `canUndo`, `canRedo`, `historySize`)
  previously lived as top-level `Readonly<ComputedRef<X>>` fields on
  `useForm()`'s return. They're now collated on a single `state`
  object (`reactive()` + `readonly()` under the hood). Templates
  bind to primitives directly — `:disabled="form.state.isSubmitting"`
  just works — and scripts read without `.value`.
- **`fieldErrors` is a Proxy view.** The ComputedRef wrapper is gone.
  Templates and scripts both dot-access through
  `form.fieldErrors.email` without `.value`. Still readonly (compile
  time via the type + runtime via Proxy traps that warn + reject).

**Breaking changes**

Three migrations since 0.10, all shaped by the same Vue template-
auto-unwrap limitation — refs nested inside API *objects* don't
unwrap, and our API was making consumers pay for it.

- **`fieldErrors.value` is gone.** Drop `.value` everywhere. Watchers
  must use the getter form: `watch(() => api.fieldErrors.email, …)`
  rather than `watch(api.fieldErrors, …)`.
- **9 top-level scalars moved to `state`.**

  ```diff
  - form.isDirty.value
  - form.isSubmitting.value
  - form.canUndo.value
  + form.state.isDirty
  + form.state.isSubmitting
  + form.state.canUndo
  ```

  …for all 9 fields listed above. `undo()` and `redo()` stay at the
  top level — they're methods, not state.
- **Internal `FormState` type renamed to `FormStore`.** The name was
  freed for the new public `FormState` interface (the shape of
  `useForm().state`). Only breaks consumers who imported the
  internal type directly — unlikely but possible.
- **`initialState` config key renamed to `defaultValues`.** Same
  motivation: with `state` reserved for the form-level flag bundle,
  `useForm({ initialState: {…} })` read ambiguously. The new name
  matches RHF's vocabulary. Custom-adapter authors also need to
  rename `AbstractSchema.getInitialState` → `getDefaultValues` (and
  the matching `InitialStateResponse` / `GetInitialStateConfig`
  types). The `runtime/adapters/zod-v4/initial-state` module file
  is now `default-values`.

See [`docs/migration/0.10-to-0.11.md`](docs/migration/0.10-to-0.11.md)
for a full migration snippet with `sed` one-liners covering all four
breakages.

## v0.10.0
_No unreleased changes yet._

## v0.9.0
_No unreleased changes yet._

## v0.8.3
_No unreleased changes yet._

## v0.8.2
_No unreleased changes yet._

## v0.8.1
_No unreleased changes yet._

## v0.8.0
**What's new at a glance**

- **Full rewrite of the core.** The pre-rewrite `useState` composables
  are collapsed into a single `FormState` closure per form. Registry-
  backed, framework-agnostic — works under Nuxt 3/4, bare Vue 3, and
  bare Vue 3 + `@vue/server-renderer`.
- **Zod v4 adapter** at `@chemical-x/forms/zod`. The v3 adapter stays
  at `@chemical-x/forms/zod-v3` for existing consumers; the two are
  physically isolated and pick the zod major the consumer installs.
- **Type-inference improvements.** `register` / `getValue` / `setValue`
  / `getFieldState` narrow down to the exact leaf type for any
  `FlatPath<Form>`. New `ArrayPath<Form>` / `ArrayItem<Form, Path>`
  helper types drive the typed array helpers.
- **New surface:** `isDirty`, `isValid`, `isSubmitting`, `submitCount`,
  `submitError`, `reset()`, `resetField(path)`, and the typed array
  helpers (`append` / `prepend` / `insert` / `remove` / `swap` /
  `move` / `replace`).
- **Memory-leak fix.** `FormState` is evicted from the registry on
  the last consumer's scope dispose — prevents accumulation in
  long-lived SPAs.
- **Performance.** The keystroke bench runs several times faster than
  the pre-rewrite baseline; `scripts/check-bench.mjs` fails CI if the
  ratio regresses.
- **CI gates:** bundle size (`size-limit`), coverage (v8 with per-
  metric thresholds), and bench regression all run on every PR across
  the Node matrix. Test-file and intra-file execution order shuffles
  on every run.
- **Tree-shaking.** `sideEffects: false` is declared — unused subpath
  imports drop out of consumer bundles.
- **Docs.** A new `docs/` tree covers the full public API, task-
  oriented recipes (dynamic field arrays, server errors, custom
  adapters, SSR hydration, advanced validation), and per-release
  migration notes.

**Breaking changes**

Two consumer-facing breakages since 0.6:

- `useForm` requires `key`. Compile error without it; runtime error
  if passed `undefined` / `null` / `''`. See
  [`docs/migration/0.7-to-0.8.md`](docs/migration/0.7-to-0.8.md).
- `handleSubmit(cb)` returns a handler function instead of running
  immediately. Bind it directly to `@submit.prevent` or call it
  imperatively. See
  [`docs/migration/0.6-to-0.7.md`](docs/migration/0.6-to-0.7.md).

**Out of scope for this release (future candidates)**

Async validators, a Valibot adapter to validate the
schema-agnostic claim, a bare-Vue playground, an auto-release
pipeline, the Vue DevTools plugin, and published comparison
benchmarks against FormKit / VeeValidate / react-hook-form.

---

## Compare

[compare changes](https://github.com/cubicforms/chemical-x-forms/compare/v0.5.0...HEAD)

### 🚀 Enhancements

- Reactive field-error store + setFieldErrorsFromApi helper ([#107](https://github.com/cubicforms/chemical-x-forms/pull/107))
- ⚠️  HandleSubmit returns a submit handler instead of running immediately ([#108](https://github.com/cubicforms/chemical-x-forms/pull/108))
- Phase 0 — max TS strictness, canonical paths, SSR primitives, typed errors ([6157a26](https://github.com/cubicforms/chemical-x-forms/commit/6157a26))
- Phase 1a — diff-apply walker + keystroke benchmark (7.6x-10.6x faster) ([16a0193](https://github.com/cubicforms/chemical-x-forms/commit/16a0193))
- Phase 1b.1 — structured-path get/set primitives ([1fcd2a8](https://github.com/cubicforms/chemical-x-forms/commit/1fcd2a8))
- Phase 1b.2 — hydrate-api-errors with structured result shape ([8e89513](https://github.com/cubicforms/chemical-x-forms/commit/8e89513))
- Phase 1b.3 — createFormState, the single per-form closure ([872471d](https://github.com/cubicforms/chemical-x-forms/commit/872471d))
- Phase 1b.4 — API factories for register, field-state, process-form ([79458f1](https://github.com/cubicforms/chemical-x-forms/commit/79458f1))
- Phase 2.1 — registry, plugin factory, serialization, directive move ([8c45fb0](https://github.com/cubicforms/chemical-x-forms/commit/8c45fb0))
- Phase 2.2 — wire use-abstract-form to createFormState + registry ([204440a](https://github.com/cubicforms/chemical-x-forms/commit/204440a))
- Phase 3 — AST + directive hardening (substring match, file input, shim, cleanup) ([d9f5185](https://github.com/cubicforms/chemical-x-forms/commit/d9f5185))
- Phase 4a — packaging restructure, multi-entry build, new subpaths ([6c8ef1d](https://github.com/cubicforms/chemical-x-forms/commit/6c8ef1d))
- Phase 4a + 4b — multi-entry build, dual zod v3/v4 adapters ([492577a](https://github.com/cubicforms/chemical-x-forms/commit/492577a))
- Phase 5 — bare-Vue SSR end-to-end test (@vue/server-renderer) ([c8a4471](https://github.com/cubicforms/chemical-x-forms/commit/c8a4471))
- ⚠️  Phase 7.2 — require explicit `key` at the type level ([584239e](https://github.com/cubicforms/chemical-x-forms/commit/584239e))
- Phase 7.6 — v4 adapter parity with v3 (validate-then-fix, DU, strip) ([acdb63d](https://github.com/cubicforms/chemical-x-forms/commit/acdb63d))
- Phase 8.2 — form-level isDirty and isValid computed aggregates ([0633b6d](https://github.com/cubicforms/chemical-x-forms/commit/0633b6d))
- Phase 8.3 — expose isSubmitting/submitCount/submitError from handleSubmit ([d0fed7f](https://github.com/cubicforms/chemical-x-forms/commit/d0fed7f))
- Phase 8.4 — reset() and resetField(path) restore form state ([48de785](https://github.com/cubicforms/chemical-x-forms/commit/48de785))
- Phase 8.5 — typed array helpers (append/remove/swap/move/...) + recipe ([3de1298](https://github.com/cubicforms/chemical-x-forms/commit/3de1298))

### 🔥 Performance

- Flag the package as `sideEffects: false` for tree-shaking ([3636b19](https://github.com/cubicforms/chemical-x-forms/commit/3636b19))

### 🩹 Fixes

- **exports:** Drop null values and fix missing .js extension ([#106](https://github.com/cubicforms/chemical-x-forms/pull/106))
- Phase 8.1 — release FormState from the registry on scope dispose ([8fc9436](https://github.com/cubicforms/chemical-x-forms/commit/8fc9436))

### 💅 Refactors

- Phase 2.3 — delete pre-rewrite composables, utils, and directive plugins ([7fa8479](https://github.com/cubicforms/chemical-x-forms/commit/7fa8479))
- Phase 7.1 — remove dead surface ([d049fd7](https://github.com/cubicforms/chemical-x-forms/commit/d049fd7))
- Phase 7.4 — tighten ESLint exemptions to zero disables ([e7c9248](https://github.com/cubicforms/chemical-x-forms/commit/e7c9248))
- Phase 7.5 — rewrite-zod-aliases script → rollup-plugin-alias ([56261af](https://github.com/cubicforms/chemical-x-forms/commit/56261af))

### 📖 Documentation

- Surface reactive field-errors API in Features list ([#111](https://github.com/cubicforms/chemical-x-forms/pull/111))
- Phase 6 — README rewrite for the multi-target shape ([4bd4611](https://github.com/cubicforms/chemical-x-forms/commit/4bd4611))
- Phase 8.7 — API reference, recipes, and migration notes ([864a32d](https://github.com/cubicforms/chemical-x-forms/commit/864a32d))

### 📦 Build

- Silence the last two unbuild warnings (zod-v3, @nuxt/schema) ([d319f1c](https://github.com/cubicforms/chemical-x-forms/commit/d319f1c))

### 🏡 Chore

- **dev:** Dist-rebuild watcher for consumer-side iteration via pnpm link ([#109](https://github.com/cubicforms/chemical-x-forms/pull/109))
- Phase 7.7 — CI gates for bundle size, coverage, bench regression ([16088de](https://github.com/cubicforms/chemical-x-forms/commit/16088de))
- Phase 7.3 — playground migrated to /zod subpath ([d273d36](https://github.com/cubicforms/chemical-x-forms/commit/d273d36))
- Silence npm warnings in husky hooks via `pnpm exec` ([3c2b900](https://github.com/cubicforms/chemical-x-forms/commit/3c2b900))

### ✅ Tests

- Phase 7.8 — Vite plugin resolution + transforms registration coverage ([42dc662](https://github.com/cubicforms/chemical-x-forms/commit/42dc662))
- Phase 7.9 — Nuxt SSR payload round-trip for server-written values ([2b61e56](https://github.com/cubicforms/chemical-x-forms/commit/2b61e56))
- Phase 7.10 — property-based tests for diff-apply, paths, api-errors ([cee5b1b](https://github.com/cubicforms/chemical-x-forms/commit/cee5b1b))
- **packaging:** Skip exports checks when dist contains Nuxt stubs ([698209e](https://github.com/cubicforms/chemical-x-forms/commit/698209e))
- Add type-inference tests; fix register generic; shuffle tests in CI ([d980198](https://github.com/cubicforms/chemical-x-forms/commit/d980198))

### 🤖 CI

- Sign publish-workflow version-bump commits with GPG ([#110](https://github.com/cubicforms/chemical-x-forms/pull/110))
- Phase 8.6 — run full pnpm check on every PR across the Node matrix ([200fe46](https://github.com/cubicforms/chemical-x-forms/commit/200fe46))

#### ⚠️ Breaking Changes

- ⚠️  HandleSubmit returns a submit handler instead of running immediately ([#108](https://github.com/cubicforms/chemical-x-forms/pull/108))
- ⚠️  Phase 7.2 — require explicit `key` at the type level ([584239e](https://github.com/cubicforms/chemical-x-forms/commit/584239e))

### ❤️ Contributors

- Oswald Chisala <ozzy@cubicforms.com>

