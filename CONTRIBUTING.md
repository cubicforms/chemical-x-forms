# Contributing to `attaform`

Short-form guide. The canonical source of truth is the codebase —
everything below leads you to the file that actually does the thing.

## Dev setup

Required: Node `>=18`, pnpm `>=9` (pinned in `package.json`
`packageManager`). Corepack handles the pnpm version for you:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev:prepare
```

`dev:prepare` stubs the library with `unbuild --stub` and prepares the
Nuxt playground. Run it once after install.

## The check that matters

```sh
pnpm check
```

Runs, in order: `lint` → `format:check` → `typecheck` → `test` →
`check:size` → `check:bench` → `check:coverage`. CI runs the same
command on every PR across the Node matrix. If it's green locally it's
green in CI.

Tight inner loops:

- `pnpm test -- path/to/file.test.ts` — single test file, watch off.
- `pnpm test:watch` — all tests, watch on.
- `pnpm bench` — benchmarks (reports ops/sec; regression floor in
  `scripts/check-bench.mjs`).
- `pnpm check:size` — bundle-size budget (`size-limit` entries in
  `package.json`).

## Adding a new Zod v4 kind to the adapter

The adapter chokepoints every `def.*` access in one file:
`src/runtime/adapters/zod-v4/introspect.ts`. To add support for a new
zod kind:

1. Extend the `ZodKind` union in `introspect.ts` with the new kind.
2. Add a case to `kindOf(schema)` mapping zod's internal `def.type`
   string to your new kind. (The internal type strings can change
   between zod minors — treat them as unstable.)
3. Add accessor helpers for any fields you need to read off the
   schema (`unwrapLazy`, `getIntersectionLeft`, etc.).
4. Extend the four switch statements that enumerate `ZodKind`:
   `deriveDefault` (initial-state.ts), `stripRefinements` /
   `getSlimSchema` (strip.ts), `walkSegments` (path-walker.ts). TS's
   exhaustive-switch check will flag each one for you once the union
   grows.
5. If the kind can't be meaningfully represented as a form value, add
   it to `UNSUPPORTED` in `assert-supported.ts` instead — adapter
   construction will throw `UnsupportedSchemaError` with a path.
6. Add a test in `test/adapters/zod-v4/` mirroring the existing file
   naming. `test/adapters/zod-v3/adapter.test.ts` is the v3 parity
   case — add the same happy-path scenario there if v3 already
   supports the kind, so the two adapters stay aligned.

## Writing a recipe

Recipes live in `docs/recipes/`. The existing set (dynamic field
arrays, server errors, custom adapter, SSR hydration, advanced
validation) hits these marks — copy a format that fits:

- Lead with the problem, not the mechanism.
- First code block is runnable — a user should be able to paste it
  and hit "save".
- Cover the subtle failure mode near the end. No recipe has zero
  edge cases; the one that matters is the one that bites at 2am.

## Releasing (maintainers only)

Two paths. They produce the same commit shape — `pnpm version` runs
the `version` script hook in both cases, promoting the `## Unreleased`
block in `CHANGELOG.md` to the tagged version.

### Via GitHub Actions (`publish-npm.yml`)

Recommended — gets OIDC-signed provenance on the npm tarball.

Checklist:

- [ ] Topic branch merged to `main` via PR (review required).
- [ ] All gates green on `main` (matrix CI including size, coverage,
      bench).
- [ ] `CHANGELOG.md` `## Unreleased` entry has the final summary. The
      `version` script rewrites the header on publish; the entries
      themselves carry.
- [ ] Run the `publish-npm.yml` workflow manually
      (`workflow_dispatch`). Pick `version_type: patch` / `minor` /
      `major`. For a pre-release, use `prerelease` and publish under
      `dist-tag = beta` / `next` so `@latest` stays on the stable
      line.
- [ ] After publish: install the freshly-published version in a fresh
      Vue or Nuxt project and exercise useForm end-to-end. Confirm
      subpath exports work and the SSR round-trip under
      `@vue/server-renderer` is intact.

The `version` script hook does two things during the workflow's
version-bump step:

1. Promotes `CHANGELOG.md`'s `## Unreleased` block to `## v<version>`
   (`scripts/promote-changelog.mjs`).
2. Fetches PR-sourced release notes for the range
   `(previous tag, HEAD)` from GitHub's `generate-notes` API and
   prepends the result to `RELEASES.md`
   (`scripts/generate-release-notes.mjs`). Requires `GH_TOKEN` —
   provided by the workflow's `GITHUB_TOKEN`. Outside CI the script
   skips, so local `pnpm version` doesn't need a PAT.

Both files get staged by the hook and land in the same commit as the
version bump, so the tag a consumer sees carries both the
narrative (CHANGELOG) and the PR-ledger (RELEASES) views of the
release.

### Via `pnpm release` (local)

Used for emergency patches or when CI is down. Same steps as the
workflow, but run locally:

```sh
pnpm release
```

Mirrors the CI flow: `pnpm check && pnpm version patch && pnpm
prepack && pnpm publish && git push --follow-tags`. The local path
publishes _without_ `--provenance` (OIDC only works in CI), so the
resulting tarball won't carry a signed statement. Prefer the
workflow when you can.

## Commit style

Conventional commits: `feat:` / `fix:` / `ci:` / `docs:` / `perf:` /
`test:` / `chore:` / `refactor:`. The release tooling
(`changelogen`) parses these into the CHANGELOG. Keep subject lines
short; put reasoning in the body.

Where a commit lands a phase from a plan doc, reference it in the
subject: `feat: phase 9.1 — ...`. Not mandatory, just helps the log
tell a story.

## What NOT to change

- `package.json` `version`. The `publish-npm.yml` workflow bumps it
  via `pnpm version`. Manual edits break the workflow's
  version-calculation step.
- `pnpm-lock.yaml` ad-hoc. Let `pnpm install` regenerate it after
  `package.json` changes; CI installs with `--frozen-lockfile`.
- The `src/runtime/lib/core/transforms/` directory without a matching
  test. The AST transforms ship shape into every consumer's bundle —
  regressions here are the scariest class of bugs we have.
