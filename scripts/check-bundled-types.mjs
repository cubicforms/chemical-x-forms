#!/usr/bin/env node
/**
 * Bundled-types regression gate. Verifies that the fixture in
 * `tests/fixtures/bundled-types/` typechecks against the published
 * `.d.ts` shape — the artifact a real consumer sees through
 * `attaform/zod-v4` and `attaform`.
 *
 * This script is the acceptance test for the depth-efficiency
 * refactor: a 4-form `useStepper` pattern with discriminated unions,
 * nested objects, arrays, and tuples must not trip TS2589 ("Type
 * instantiation is excessively deep") under the bundled `.d.ts`.
 *
 * Usage:
 *   pnpm check:bundled-types
 *
 * Side effects:
 *   - Builds `dist/` if missing (calls `pnpm prepack`).
 *   - Runs `tsc --project tests/fixtures/bundled-types/tsconfig.json`.
 *   - Exits non-zero on any compile error.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const distDir = resolve(repoRoot, 'dist')
const fixtureTsConfig = resolve(repoRoot, 'tests/fixtures/bundled-types/tsconfig.json')
const sentinelDts = resolve(distDir, 'zod-v4.d.ts')

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', cwd: repoRoot, ...opts })
}

function distIsRealBundle() {
  try {
    const head = readFileSync(sentinelDts, 'utf8').slice(0, 256)
    // `unbuild --stub` writes `export * from "/app/src/..."` (absolute
    // source paths). A real bundle imports from `./shared/...` chunks.
    return !head.includes('/src/')
  } catch {
    return false
  }
}

if (!distIsRealBundle()) {
  console.log('[check-bundled-types] dist/ missing or stubbed — building real bundle first')
  run('pnpm prepack')
}

console.log('[check-bundled-types] typechecking 4-form-stepper fixture against bundled .d.ts')
try {
  run(`pnpm exec tsc --project "${fixtureTsConfig}"`)
  console.log('[check-bundled-types] ok — bundled types support the 4-form pattern')
} catch {
  console.error('[check-bundled-types] FAILED — bundled types do not compile the 4-form pattern.')
  console.error(
    '  This means the depth-efficiency refactor has regressed. Audit DefaultValuesInput,'
  )
  console.error('  LeafWalker, internal-helper exports, and WriteShape for the cause.')
  process.exit(1)
}
