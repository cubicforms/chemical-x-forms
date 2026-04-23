#!/usr/bin/env node
/**
 * Promote the CHANGELOG's `## Unreleased` block to the version npm is
 * about to tag. Runs from the `version` npm hook — `pnpm version X`
 * bumps package.json first, fires this script, then commits + tags.
 * Adding CHANGELOG.md to the working tree here means it rides along
 * on the version commit (instead of drifting behind the tag).
 *
 * If no `## Unreleased` block exists we leave the file untouched —
 * the release machinery shouldn't fail a publish just because the
 * changelog has already been hand-promoted.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
const changelogPath = resolve(repoRoot, 'CHANGELOG.md')
const content = readFileSync(changelogPath, 'utf8')

const unreleased = /^## Unreleased\s*$/m
if (!unreleased.test(content)) {
  console.error(
    `[promote-changelog] no "## Unreleased" header in CHANGELOG.md — skipping (version=${pkg.version})`
  )
  process.exit(0)
}

// Replace `## Unreleased` with `## v<version>` AND seed a fresh
// placeholder for the next cycle. The placeholder makes it obvious at
// a glance that the release cycle has reset.
const replacement = `## Unreleased\n\n_No unreleased changes yet._\n\n## v${pkg.version}`
const updated = content.replace(unreleased, replacement)
writeFileSync(changelogPath, updated)
console.log(`[promote-changelog] promoted "## Unreleased" → "## v${pkg.version}"`)
