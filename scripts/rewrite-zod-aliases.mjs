#!/usr/bin/env node
/**
 * Post-build rewrite of the `zod-v3` pnpm-alias specifier back to `zod`
 * in published dist files. Rationale:
 *
 * - We install both zod@^4 (as `zod`) and zod@^3 (as `zod-v3`) in devDeps
 *   so both adapter tests can run in the same workspace without
 *   package-name collisions.
 * - The v3 adapter's SOURCE imports `from 'zod-v3'` to pull the v3
 *   namespace during dev/test. Published bundles, however, need `from
 *   'zod'` — consumers install zod@3 themselves and the adapter resolves
 *   against their installed version.
 * - Rollup's replace/alias plugins didn't fire reliably for this via
 *   unbuild's config surface. A post-pack rewrite is the simplest,
 *   mechanical fix that's easy to reason about.
 *
 * Runs as `postpack` via the build pipeline in package.json. If the dist/
 * directory doesn't exist (e.g. in a clean dev state), exits silently.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const distDir = new URL('../dist', import.meta.url).pathname

function walk(dir) {
  const entries = readdirSync(dir)
  return entries.flatMap((name) => {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) return walk(full)
    return [full]
  })
}

try {
  statSync(distDir)
} catch {
  // dist doesn't exist yet (dev state). Exit cleanly.
  process.exit(0)
}

const files = walk(distDir).filter(
  (f) =>
    f.endsWith('.mjs') ||
    f.endsWith('.cjs') ||
    f.endsWith('.d.ts') ||
    f.endsWith('.d.mts') ||
    f.endsWith('.d.cts')
)

let rewrittenCount = 0
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  if (!content.includes('zod-v3')) continue
  const updated = content
    .replace(/(['"])zod-v3(['"])/g, '$1zod$2')
    .replace(/from "zod-v3"/g, 'from "zod"')
    .replace(/from 'zod-v3'/g, "from 'zod'")
  if (updated !== content) {
    writeFileSync(file, updated)
    rewrittenCount++
  }
}

// eslint-disable-next-line no-console
console.log(`[rewrite-zod-aliases] Rewrote 'zod-v3' -> 'zod' in ${rewrittenCount} file(s).`)
