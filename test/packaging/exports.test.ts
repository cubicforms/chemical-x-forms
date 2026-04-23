import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Sanity-checks on the built dist/. Skipped when dist doesn't exist yet —
 * this test runs meaningfully after `pnpm prepack` (or during CI release).
 * Scope: verify every package.json exports subpath resolves to an artifact
 * that was actually produced.
 */

const repoRoot = join(__dirname, '..', '..')
const distDir = join(repoRoot, 'dist')

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
  main: string
  types: string
  exports: Record<string, { types?: string; import?: string; require?: string }>
}

/**
 * After running `pnpm dev:prepare`, unbuild (or Nuxt's module-builder on
 * older branches) drops jiti-wrapped stubs into dist/ so the playground
 * can resolve the module without a real build. Those stubs re-export
 * from source via jiti and don't reflect the final published shape.
 * Skip the packaging asserts in that case — `pnpm prepack` (or
 * `pnpm check:size` which runs it) produces the real build.
 *
 * Two stub formats exist in the wild:
 *   - Nuxt module-builder:  `import jiti from '…/jiti.mjs'`
 *   - unbuild --stub:       `import { createJiti } from '…/jiti.mjs'`
 * Match on the shared `jiti` import specifier to cover both.
 */
const isRealBuild =
  existsSync(join(distDir, 'index.mjs')) &&
  !/from\s*['"][^'"]*jiti[^'"]*['"]/.test(readFileSync(join(distDir, 'index.mjs'), 'utf-8'))

describe.skipIf(!existsSync(distDir) || !isRealBuild)('packaging: package.json exports', () => {
  it('main points at a file that exists', () => {
    expect(existsSync(join(repoRoot, pkg.main))).toBe(true)
  })

  it('types points at a file that exists', () => {
    expect(existsSync(join(repoRoot, pkg.types))).toBe(true)
  })

  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    it(`subpath "${subpath}" — every declared artifact exists`, () => {
      for (const [kind, relativePath] of Object.entries(entry)) {
        // `entry` is typed as having optional fields, but at runtime we only
        // iterate defined entries. The values are always strings in
        // package.json; treat them as such.
        expect(
          existsSync(join(repoRoot, relativePath)),
          `${subpath}.${kind} -> ${relativePath}`
        ).toBe(true)
      }
    })
  }

  it('all five expected entries are present', () => {
    for (const name of ['nuxt', 'index', 'vite', 'transforms', 'zod-v3']) {
      expect(existsSync(join(distDir, `${name}.mjs`)), `${name}.mjs`).toBe(true)
      expect(existsSync(join(distDir, `${name}.d.mts`)), `${name}.d.mts`).toBe(true)
    }
  })

  it('core entry (index.mjs) does not import zod (keeps /zod-v3 opt-in)', () => {
    const src = readFileSync(join(distDir, 'index.mjs'), 'utf-8')
    // Minified bundles may omit whitespace between `from` and the module
    // specifier, so match both forms.
    expect(src).not.toMatch(/from\s*['"]zod['"]/)
    expect(src).not.toMatch(/require\(\s*['"]zod['"]\s*\)/)
  })

  it('zod-v3 entry references zod', () => {
    const src = readFileSync(join(distDir, 'zod-v3.mjs'), 'utf-8')
    expect(src).toMatch(/from\s*['"]zod['"]/)
  })

  it('no dist bundle imports `zod-v3` (the pnpm-alias specifier gets rewritten)', () => {
    // Guard against regressions in the rollup alias plugin (build.config.ts).
    // If the alias silently stopped firing, every zod-v3 entry would re-
    // externalize as `from 'zod-v3'` and consumers would hit resolution
    // failures at install time. We exclude error-message string literals
    // from the check.
    for (const name of ['index', 'nuxt', 'vite', 'transforms', 'zod', 'zod-v3']) {
      const mjs = readFileSync(join(distDir, `${name}.mjs`), 'utf-8')
      expect(mjs, `${name}.mjs imports zod-v3`).not.toMatch(
        /from\s*['"]zod-v3['"]|require\(\s*['"]zod-v3['"]\s*\)/
      )
    }
  })
})
