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
- **Breaking — `validationMode` defaults to `'strict'`.** Was `'lax'`
  in 0.11. Combined with the construction-time seed below, forms
  whose default values fail validation now report errors immediately
  — no user mutation or `validateAsync` call required. Lax remains
  as the explicit opt-out for multi-step wizards, placeholder rows
  in field arrays, and any case where mounting with invalid data is
  intentional. Migration: pass `validationMode: 'lax'` to keep the
  old behaviour.
- **Breaking — errors split by source.** `setFieldErrors` /
  `addFieldErrors` write to a separate user-error store internally;
  their entries now SURVIVE schema revalidation AND successful
  submits (only `clearFieldErrors` / `reset` / `resetField` remove
  them). Public surfaces (`fieldErrors`, `state.isValid`,
  `getFieldState(path).errors`) merge schema + user transparently —
  schema first, user second. `clearFieldErrors(path?)` deliberately
  clears both stores at the given path (pragmatic "make these
  errors go away" semantic).
- **Breaking — `setFieldErrorsFromApi` retired.** Replaced by the
  pure `parseApiErrors(payload, { formKey })` exported helper +
  `setFieldErrors(result.errors)`. The form's setter surface is now
  one canonical write; shape adapters live as composable parsers.
  Old: `form.setFieldErrorsFromApi(payload)`. New:
  `const r = parseApiErrors(payload, { formKey: form.key }); if (r.ok) form.setFieldErrors(r.errors)`.
  New exports: `parseApiErrors`, `PARSE_API_ERRORS_DEFAULTS`,
  `ParseApiErrorsOptions`, `ParseApiErrorsResult`. The parser
  returns a discriminated `{ ok, errors, rejected? }` so malformed
  payloads are visible (vs. the old "returns empty array" silent
  failure).
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
- **New — app-level defaults on the plugin.** Pass
  `createChemicalXForms({ defaults: { ... } })` (or
  `chemicalX: { defaults: { ... } }` on the Nuxt module) to set
  cx-wide preferences once instead of repeating them at every
  `useForm` call. Supported defaults: `validationMode`,
  `onInvalidSubmit`, `fieldValidation`, `history`. Per-form options
  always win; `fieldValidation` shallow-merges at the field level so
  consumers can set `debounceMs` globally and override `on` per-form.
  See [recipe](./docs/recipes/app-defaults.md). Additive — existing
  apps that don't pass `defaults` are unchanged.
- **Breaking — synthetic-key namespace reserved.** `useForm({ key })`
  now throws `ReservedFormKeyError` when the consumer-supplied key
  starts with `__cx:`. The library uses the `__cx:` prefix for its
  internal synthetic keys, and synthetic anonymous-form keys are now
  `__cx:anon:<id>` (was `cx:anon:<id>`). Consumers using either prefix
  at any call site need to rename. Reserves the `__cx:` namespace for
  future internal use; with the entry-reject in place, collisions
  between consumer keys and library-allocated keys are now impossible
  by construction.
- **Breaking — persistence opt-in moved to per-field.** Form-level
  `persist: { storage: 'local' }` no longer auto-persists every
  field. Each persisted field opts in explicitly at its `register()`
  call site: `register('email', { persist: true })`. Programmatic
  `form.setValue` no longer reaches storage; use new `form.persist(path)`
  for an explicit one-shot checkpoint. Sensitive-named paths
  (password / cvv / ssn / token / api-key / etc.) throw
  `SensitivePersistFieldError` at mount unless
  `acknowledgeSensitive: true` is also passed. Persisted payloads
  are sparse — only opted-in paths land in storage; hydration
  merges over schema defaults. `reset()` and `resetField(path)` now
  wipe the persisted draft alongside the in-memory clear.
  New APIs: `form.persist(path, opts?)`,
  `form.clearPersistedDraft(path?)`, `RegisterOptions`, `WriteMeta`,
  `SensitivePersistFieldError`. Dev-mode warning if persist is
  configured but no field opts in. The `assignKey` symbol on
  v-register elements gains an optional `meta` parameter (clean
  break for the rare consumer who supplied a custom assigner via
  `onUpdate:registerValue`). See the
  [migration guide](./docs/migration/0.11-to-0.12.md#breaking-persistence-opt-in-moved-to-per-field)
  + [persistence recipe](./docs/recipes/persistence.md) for the full
  rewrite.
- **New — shorthand `persist:` config.** `useForm({ persist: 'local' })`
  is now equivalent to `useForm({ persist: { storage: 'local' } })`;
  same shorthand for `'session'` / `'indexeddb'` and for custom
  `FormStorage` adapters (`persist: encryptedStorage`). The full
  options bag is still required to override `key`, `debounceMs`,
  `version`, etc. New `PersistConfigOptions` type exported alongside
  `PersistConfig` (which is now the union of all input forms).
- **New — cross-store cleanup at mount.** The configured `storage` is
  the source of truth for "where the draft lives now." Standard
  backends (`'local'` / `'session'` / `'indexeddb'`) NOT matching the
  configured one get a `removeItem(key)` (fire-and-forget). A
  migration `'local'` → `'session'` (or `'local'` → encrypted custom
  adapter) can no longer orphan PII / sensitive fields in the
  abandoned backend. Configuring a custom adapter sweeps all three
  standard backends. Inlined per-backend so it doesn't drag in the
  adapter chunks the consumer didn't ask for.
- **New — auto-wipe of stale persisted entries.** A non-empty raw
  value that fails to parse on hydration (version mismatch,
  malformed envelope, corrupted JSON) is now wiped from the
  configured backend instead of being left on disk. Bumping
  `persist.version` no longer leaves the old payload bytes lingering
  indefinitely. "Truly absent" entries stay a no-op — the wipe only
  fires when there's actually something to clean.
- **New — symmetric dev-mode warning for the inverse misuse.**
  `register('foo', { persist: true })` on a form with no `persist:`
  option configured on `useForm()` now logs a one-time warning in
  development pointing at the offending call. Pairs with the
  existing "persist configured but no opt-ins" warning so both halves
  of the wire-up problem produce a clear signal at the right call
  site. Production is silent.

**Structural-completeness invariant + fingerprint persistence + read-
type honesty.** Three intertwined gaps closed in one pass — every
`setValue` write now leaves the form satisfying the slim schema (so
consumer code can read `prev.first.toUpperCase()` without optional-
chaining), persisted-draft keys carry a schema fingerprint that
auto-invalidates across deploys with no manual `version` bump, and
the read-type for `getValue` / `register` now reports `T | undefined`
once the path crosses an array index (out-of-bounds is an honest
runtime case, not a type-system lie). See the
[migration guide](./docs/migration/0.11-to-0.12.md) for the full set
of related changes.

- **Breaking — `AbstractSchema.getDefaultAtPath(path)` is now
  required.** Custom-adapter authors implement a fifth method that
  returns the schema-prescribed default at a structured path
  (object property → property's default; array index → element
  default; tuple position → position default; optional/nullable
  around a structural inner → inner default; primitive
  optional/nullable → `undefined`/`null`). The runtime calls this
  on every `setValue` to fill structural gaps; without it, partial
  writes leak through and break the new invariant. Migration: see
  [custom-adapter recipe](./docs/recipes/custom-adapter.md). Both
  Zod adapters ship the implementation out of the box.
- **Breaking — `FormStorage.listKeys(prefix)` is now required.**
  Custom storage adapters implement a fourth method that returns
  every key whose name starts with `prefix`. The persistence layer
  uses it to find and clean up orphaned fingerprint-suffixed keys
  on mount. Adapters that can't enumerate (HTTP-backed drafts,
  cookie-backed) can return `[]` — orphan cleanup degrades
  gracefully on those backends.
- **Breaking — `setValue` drops `DeepPartial` from both forms.**
  `setValue(value)` and `setValue(path, value)` now expect the full
  write shape at the type level, both for direct writes and for the
  callback form's return. Runtime mergeStructural still completes
  partials so dynamic / typecast inputs don't crash, but the type
  system now leads with strictness — the IDE points consumers at
  the canonical "give me the whole shape" pattern. Path-form
  callback `prev` is now `NonNullable<T>` (the runtime auto-defaults
  missing slots from the schema before invoking the callback);
  whole-form callback `prev` is `WithIndexedUndefined<Form>` (array
  reads are honest about returning `Item | undefined`). Migration:
  switch partial value-form writes to the callback form, or spread
  the existing value (`setValue('user', { ...prev, name: 'X' })`).
- **Breaking — `getValue` and `register` use `NestedReadType<F, P>`
  instead of `NestedType<F, P>`.** Once a path crosses an array
  index segment (e.g. `'posts.0.title'`), every result is
  `T | undefined`. Strict (no taint) for paths that don't cross
  arrays. Tuple positions stay strict — a tuple's length is static
  so out-of-bounds is a compile error, not a runtime case. Whole-
  form `getValue()` returns `Readonly<Ref<WithIndexedUndefined<Form>>>`
  (every unbounded array's elements get `| undefined`). Migration:
  consumers narrow at array-crossing paths with `?.` / `??` or a
  conditional check; non-crossing paths are unchanged.
- **Breaking — `PersistConfig.version` is gone.** The schema's
  `fingerprint()` is the canonical "shape changed" signal — passing
  a manual version is redundant and decoupled from the actual
  schema state. Storage keys now resolve to
  `${base}:${fingerprint}` automatically; a schema change produces
  a different fingerprint, the old key becomes orphaned, and the
  next mount's `listKeys`-driven cleanup pass wipes it. Migration:
  delete the `version: N` line from your `persist:` config; the
  typechecker flags it. The cx-internal envelope version (the `v`
  field on serialized payloads) stays as an internal storage-format
  invariant — bumped only when cx itself changes the on-disk shape,
  never by consumers.
- **Breaking — `AbstractSchema` parameter rename: `getInitialState`
  → `getDefaultValues`** has already shipped (0.11.0); the new
  break is `getDefaultAtPath`'s required-method status. The
  five-method contract is now: `fingerprint`, `getDefaultValues`,
  `getDefaultAtPath`, `getSchemasAtPath`, `validateAtPath`.
- **New — structural-completeness invariant on every `setValue`.**
  After every `setValue` write, the form is guaranteed to satisfy
  the slim schema (objects/arrays/primitives without refines).
  Three concrete consequences:
  - Sparse array writes (`setValue('posts.21', cb)` against an
    empty array) auto-pad indices `0..20` with the schema's
    element default. The runtime walks the path, fills missing
    intermediates from `getDefaultAtPath`, and writes the value at
    the leaf.
  - Partial value-form writes (`setValue('user', { name: 'X' })`
    when the schema requires `{ name, age, email }`) get
    structurally completed via `mergeStructural` against the
    schema's default — sibling keys appear with their schema-
    prescribed defaults. Consumer-only keys (validation flags,
    metadata) are preserved.
  - Path-form callback writes (`setValue('user', prev => ({ ...prev,
    name: 'X' }))`) now receive a strict, fully-defaulted `prev` —
    even when the slot was previously empty. The callback no
    longer needs `prev?.name ?? ''` defensive reads.
  Performance: the fast path (writes to existing slots) skips the
  schema entirely. Schema lookups fire only when a write actually
  hits a structural gap, with element-default caching to keep
  sparse-array padding O(N) instead of O(N×schema-traversal).
- **New — fingerprint-keyed persistence + active orphan cleanup.**
  Storage keys are now `${base}:${fingerprint}` automatically —
  changing the schema produces a different fingerprint, the old
  key becomes unreachable, and on the next mount the new
  `listKeys`-driven cleanup pass removes the orphaned entry. No
  manual `version` bumps, no stale drafts accumulating across
  redeploys. Cleanup uses exact-or-`:`-prefix match scoped to
  `${PERSISTENCE_KEY_PREFIX}${formKey}` (or the consumer's custom
  `key`) — sibling forms with overlapping prefixes (e.g.
  `'my-form'` vs `'my-form-2'`) don't collide. Cross-store
  cleanup on the non-configured standard backends extends to
  orphan-key sweeping symmetrically.
- **New — `WithIndexedUndefined<T>`, `NestedReadType<F, P>`, and
  `IsTuple<T>` type transforms** are exported from
  `@chemical-x/forms`. `WithIndexedUndefined` taints every
  unbounded array's element type with `| undefined`; tuples,
  `Date`, `RegExp`, `Map`, `Set`, and functions pass through
  untouched. `NestedReadType` walks a `FlatPath` and tracks
  whether a numeric segment was crossed — once tainted, all
  subsequent results are `T | undefined`. Use these directly when
  building wrappers / utility types around the form API.
- **New — `SetValuePayload<Write, Read = Write>` is parameterised**
  to support honest read-vs-write shape distinction in callbacks.
  `Write` is what the callback returns / what direct writes
  accept; `Read` is what the callback's `prev` receives. The
  whole-form `setValue` parameterises `Read` to
  `WithIndexedUndefined<Form>` so consumer reads of `prev.posts[5]`
  are honest. The path-form parameterises `Read` to
  `NonNullable<NestedType<Form, Path>>` because the runtime
  auto-defaults missing slots before the callback fires.

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

