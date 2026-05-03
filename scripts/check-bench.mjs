#!/usr/bin/env node
/**
 * Guardrail: run the keystroke bench and fail if the new writer regresses
 * below 3× the old flatten+setDiff approach for any scenario.
 *
 * Current headroom is comfortable (~7-10× in both scenarios), so this rule
 * catches real regressions rather than normal measurement noise.
 *
 * Runs as part of `pnpm check` via the `check:bench` script in
 * package.json. The bench itself lives at bench/keystroke.bench.ts — each
 * `describe` group pairs an "old: ..." and a "new: ..." bench. We parse the
 * vitest bench JSON output, walk each group, and assert
 *   hz(new) / hz(old) >= RATIO_FLOOR.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RATIO_FLOOR = 3.0

const tmp = mkdtempSync(join(tmpdir(), 'attaform-bench-'))
const outputPath = join(tmp, 'bench.json')

// Run the bench; let vitest write to our temp JSON file so we don't fight
// with stdout interleaving.
try {
  execFileSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['vitest', 'bench', '--run', `--outputJson=${outputPath}`],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  )
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[check-bench] vitest bench exited non-zero: ${err?.message ?? err}`)
  process.exit(1)
}

let report
try {
  report = JSON.parse(readFileSync(outputPath, 'utf8'))
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[check-bench] Failed to parse bench JSON at ${outputPath}: ${err?.message ?? err}`)
  process.exit(1)
}

const failures = []

for (const file of report.files ?? []) {
  for (const group of file.groups ?? []) {
    const benchmarks = group.benchmarks ?? []
    const oldBench = benchmarks.find((b) => b.name?.startsWith('old:'))
    const newBench = benchmarks.find((b) => b.name?.startsWith('new:'))
    if (!oldBench || !newBench) {
      // Group doesn't follow the old/new pairing convention — skip silently.
      continue
    }
    const ratio = newBench.hz / oldBench.hz
    const status = ratio >= RATIO_FLOOR ? 'OK' : 'FAIL'
    // eslint-disable-next-line no-console
    console.log(
      `[check-bench] ${status}  ${group.fullName}  ratio=${ratio.toFixed(2)}× ` +
        `(old=${oldBench.hz.toFixed(0)} hz, new=${newBench.hz.toFixed(0)} hz, floor=${RATIO_FLOOR}×)`
    )
    if (ratio < RATIO_FLOOR) {
      failures.push({
        group: group.fullName,
        ratio,
        oldHz: oldBench.hz,
        newHz: newBench.hz,
      })
    }
  }
}

if (failures.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `\n[check-bench] ${failures.length} scenario(s) regressed below ${RATIO_FLOOR}× threshold:`
  )
  for (const f of failures) {
    // eslint-disable-next-line no-console
    console.error(`  - ${f.group}: ${f.ratio.toFixed(2)}×`)
  }
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log(`[check-bench] All scenarios within ${RATIO_FLOOR}× floor.`)
