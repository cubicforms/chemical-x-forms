#!/usr/bin/env node
/**
 * Hit GitHub's `generate-notes` API for the range
 * `(previous-tag, HEAD)` and prepend the result to `RELEASES.md`.
 * Runs from the `version` npm hook alongside
 * `promote-changelog.mjs` — both files get staged by the caller and
 * ride along on the version commit.
 *
 * The API output mirrors GitHub's "Auto-generated release notes" UI:
 * a grouped list of `* PR title by @author in #N` entries plus a
 * `New Contributors` footer when applicable. Grouping follows the
 * repo's `.github/release.yml` config if one exists; otherwise the
 * default categories apply.
 *
 * Best-effort by design. Every failure path logs and exits 0 so a
 * transient API outage / auth hiccup / malformed response / disk
 * write error does NOT break the version bump. The worst case is the
 * RELEASES.md entry for this version being missing — the consumer
 * can regenerate after the fact or hand-fill it.
 *
 * Skip conditions (all exit 0):
 * - not running in GitHub Actions (local `pnpm version` shouldn't
 *   need a PAT just to tag a patch);
 * - no `GH_TOKEN` / `GITHUB_TOKEN` in the environment;
 * - `gh` CLI not on PATH;
 * - API call fails for any reason;
 * - response body is empty or unparseable;
 * - filesystem write fails.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function log(msg) {
  console.log(`[generate-release-notes] ${msg}`)
}
function warn(msg) {
  console.warn(`[generate-release-notes] ${msg}`)
}

/**
 * Outer guard: any uncaught exception, any rejected promise, any
 * sync throw inside the generate flow becomes a warning + exit 0.
 * The version hook chain (`A && B && C`) must NOT break on this
 * script — promote-changelog has already touched CHANGELOG.md and
 * the subsequent `git add` should still run.
 */
process.on('uncaughtException', (err) => {
  warn(`uncaught exception: ${err?.message ?? String(err)}`)
  process.exit(0)
})
process.on('unhandledRejection', (err) => {
  warn(`unhandled rejection: ${err?.message ?? String(err)}`)
  process.exit(0)
})

try {
  main()
} catch (err) {
  warn(`top-level error: ${err?.message ?? String(err)}`)
  process.exit(0)
}

function main() {
  const inCI = process.env.GITHUB_ACTIONS === 'true'
  if (!inCI) {
    log('skipping — not in GitHub Actions')
    return
  }

  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (token === undefined || token === '') {
    warn('no GH_TOKEN / GITHUB_TOKEN; skipping')
    return
  }

  // Resolve package.json version. A malformed package.json here would
  // have already broken `pnpm version` earlier in the pipeline, but
  // we still guard so a stale script file-handle can't escalate.
  let pkg
  try {
    pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
  } catch (err) {
    warn(`failed to read package.json: ${String(err)}`)
    return
  }
  if (typeof pkg?.version !== 'string' || pkg.version === '') {
    warn('package.json has no version; skipping')
    return
  }
  const newTag = `v${pkg.version}`

  // Most recent v-prefixed tag. `pnpm version` runs this hook BEFORE
  // it creates the new tag, so the tip is the previous release.
  let previousTag = ''
  try {
    previousTag = execFileSync(
      'bash',
      ['-c', "git tag --sort=-creatordate | grep -E '^v[0-9]' | head -n1"],
      { encoding: 'utf8' }
    ).trim()
  } catch (err) {
    warn(`git tag lookup failed: ${String(err)}`)
    return
  }

  if (previousTag === '') {
    log('no previous v-tag found — seeding first entry')
  }

  const repo = process.env.GITHUB_REPOSITORY ?? 'attaform/attaform'
  const args = [
    'api',
    `repos/${repo}/releases/generate-notes`,
    '-f',
    `tag_name=${newTag}`,
    '-f',
    'target_commitish=main',
  ]
  if (previousTag !== '') {
    args.push('-f', `previous_tag_name=${previousTag}`)
  }

  let raw
  try {
    raw = execFileSync('gh', args, {
      encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: token },
    })
  } catch (err) {
    warn(`gh api call failed: ${String(err)}`)
    return
  }

  let notes
  try {
    notes = JSON.parse(raw)
  } catch (err) {
    warn(`failed to parse API response as JSON: ${String(err)}`)
    return
  }

  const body = typeof notes?.body === 'string' ? notes.body.trim() : ''
  if (body === '') {
    log('API returned empty body — skipping')
    return
  }

  const date = new Date().toISOString().slice(0, 10)
  const entry = `## ${newTag} — ${date}\n\n${body}\n\n---\n\n`

  const releasesPath = resolve(repoRoot, 'RELEASES.md')
  const HEADER = '# Releases\n\n'
  let existing
  try {
    existing = existsSync(releasesPath) ? readFileSync(releasesPath, 'utf8') : HEADER
  } catch (err) {
    warn(`failed to read RELEASES.md: ${String(err)}`)
    return
  }
  if (!existing.startsWith('# Releases')) {
    existing = HEADER + existing
  }
  const afterHeader = existing.replace(/^# Releases\s*\n+/, '')

  try {
    writeFileSync(releasesPath, HEADER + entry + afterHeader)
  } catch (err) {
    warn(`failed to write RELEASES.md: ${String(err)}`)
    return
  }

  log(
    `prepended ${newTag} entry ` +
      `(${previousTag === '' ? 'seed' : `range ${previousTag}..${newTag}`})`
  )
}
