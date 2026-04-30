# Releases

## v0.13.0 — 2026-04-30

## What's Changed
* chore: gitignore .claude workspace state by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/155
* feat!: Pinia-style read API + persist throws + SSR fixes by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/156
* refactor: rename transient-empty test files to blank.* by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/157
* docs: polish pass — proxy API everywhere, action-first JSDoc, 0.12→0.13 migration by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/158


**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.12.1...v0.13.0

---

## v0.12.1 — 2026-04-29

## What's Changed
* fix(slim-gate): reject unknown-path writes + property tests + KISS warn copy by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/154
* chore(deps-dev): bump the dev-dependencies group with 3 updates by @dependabot[bot] in https://github.com/cubicforms/chemical-x-forms/pull/152


**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.12.0...v0.12.1

---

## v0.12.0 — 2026-04-29

## What's Changed
* Claude/optimistic isconnected ssr by @ozzyfromcubic in https://github.com/cubicforms/chemical-x-forms/pull/133
* feat!: validation refactor — errors as data, live by default by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/134
* docs: trim README + close the lint/format-check gap by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/135
* docs: lower the first-touch barrier in the README by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/136
* docs: hoist npm install above the framework split by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/137
* feat!: validationMode defaults to 'strict' by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/138
* feat: snappier default field-validation debounce (200 → 125 ms) by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/139
* feat: app-level defaults on createChemicalXForms + Nuxt module by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/140
* feat!: reserve __cx: form-key namespace; rename anon prefix by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/141
* test: silence Vue setup-error warns on the reserved-key reject tests by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/142
* feat!: per-element persistence opt-in via register({ persist: true }) by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/143
* fix: honor setValue callback form at runtime by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/148
* feat!: useFormContext returns null + dev-warn on miss by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/149
* feat: split useRegistry throws into OutsideSetupError vs RegistryNotInstalledError by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/150
* feat!: structural-completeness invariant + fingerprint persistence + read/write type honesty by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/151
* feat!: error codes + transient-empty/unset + slim-primitive write contract by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/153


**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.11.1...v0.12.0

---

## v0.11.1 — 2026-04-25

## What's Changed
* fix(dev): quiet ambient-provide warning + add source frames by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/132


**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.11.0...v0.11.1

---

## v0.11.0 — 2026-04-25

## What's Changed
* docs: slim README, add Vue 3 / Nuxt 3 + 4 / TypeScript badges by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/126
* ci: dedicated lint job + extend prettier scope to md/json/yml by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/127
* feat(api)!: expose fieldErrors as a Proxy view, drop ComputedRef wrapper by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/128
* feat(api)!: bundle 9 form-level scalars into reactive `state` by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/129
* feat(api)!: rename initialState → defaultValues across config + adapters by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/130
* docs: sweep recipes + api.md to the 0.11 `state` bundle vocabulary by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/131


**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.10.0...v0.11.0

---

## v0.10.0 — 2026-04-24

## What's Changed
* fix(nuxt): resolve Nuxt module against package entry, not ./runtime/ by @ozzyfromcubic in https://github.com/cubicforms/chemical-x-forms/pull/125


**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.9.0...v0.10.0

---

## v0.9.0 — 2026-04-24

## What's Changed
* Claude/optional form key by @ozzyfromcubic in https://github.com/cubicforms/chemical-x-forms/pull/117
* feat(schema): structural fingerprint() on AbstractSchema + shared-key warning by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/118
* ci: enable Dependabot + GitHub Dependency Review on PRs by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/119
* chore(ci): bump actions/upload-artifact from 5 to 7 by @dependabot[bot] in https://github.com/cubicforms/chemical-x-forms/pull/120
* chore(ci): bump actions/checkout from 5 to 6 by @dependabot[bot] in https://github.com/cubicforms/chemical-x-forms/pull/123
* chore(ci): bump actions/setup-node from 5 to 6 by @dependabot[bot] in https://github.com/cubicforms/chemical-x-forms/pull/121
* chore(ci): bump pnpm/action-setup from 5 to 6 by @dependabot[bot] in https://github.com/cubicforms/chemical-x-forms/pull/122
* ci: drop deprecated always-auth input from publish-npm workflow by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/124


**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.8.3...v0.9.0

---

## v0.8.3 — 2026-04-24

## What's Changed
* fix(test): poll for persistence writes instead of fixed-sleep waits by @ozzyfromcubic in https://github.com/cubicforms/chemical-x-forms/pull/115
* ci: auto-create GitHub Release after npm publish + tag push by @ozzyfromcubic in https://github.com/cubicforms/chemical-x-forms/pull/116


**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.8.2...v0.8.3

---

## v0.8.2 — 2026-04-24

## What's Changed
* fix(eslint): point nuxt-globals loader at playground/.nuxt by @ozzyfromcubic in https://github.com/cubicforms/chemical-x-forms/pull/114


**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.8.1...v0.8.2

---

## v0.8.1 — 2026-04-24

## What's Changed
* ci: bump crazy-max/ghaction-import-gpg + actions/upload-artifact by @ozzyfromcubic in https://github.com/cubicforms/chemical-x-forms/pull/113

## New Contributors
* @ozzyfromcubic made their first contribution in https://github.com/cubicforms/chemical-x-forms/pull/113

**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.8.0...v0.8.1

---

## v0.8.0 — 2026-04-24

## What's Changed
* Core rewrite + new APIs + docs by @ozzyfromspace in https://github.com/cubicforms/chemical-x-forms/pull/112


**Full Changelog**: https://github.com/cubicforms/chemical-x-forms/compare/v0.7.2...v0.8.0

---

Auto-generated per version from the PRs merged into `main` since the
previous tag. Written by `scripts/generate-release-notes.mjs` during
the `pnpm version` hook in the publish workflow — format mirrors
GitHub's auto-generated release notes (PR title + author + PR number).

Historical entries land at the top; older entries below. `CHANGELOG.md`
remains the commit-grouped narrative view of releases.

<!-- Automated entries will be prepended here by the publish workflow. -->
