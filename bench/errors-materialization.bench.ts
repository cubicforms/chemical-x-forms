/**
 * Phase 5.2 baseline: errors-materialization inner loop.
 *
 * `JSON.stringify(form.errors.<container>)` triggers `materializeErrors`
 * (errors-proxy.ts), which walks all three reactive error stores and
 * recovers the structured `Segment[]` per entry. Pre-5.2 used
 * `JSON.parse(pathKey)` per entry (300 parses for a 100-error form
 * across schema/blank/user stores). Post-5.2 reads the canonical
 * segments through the inverse cache populated by `canonicalizePath`.
 *
 * This bench isolates the iteration + parse/lookup cost so the gate
 * tracks the JSON.parse elimination directly. The actual proxy
 * machinery (containerSegments comparison, hasAtPath active-path
 * filter, placeAt tree write) is identical between branches and
 * shared by both implementations under test — only the parse/lookup
 * step differs.
 */

import { bench, describe } from 'vitest'
import {
  canonicalizePath,
  segmentsForPathKey,
  type PathKey,
  type Segment,
} from '../src/runtime/core/paths'

type ErrorEntry = { message: string; path: readonly Segment[]; code: string }

// 100 errors across 10 groups × 10 fields, mirroring the keystroke
// fixture's shape so the bench results compose with paths.bench.ts.
function makeErrorStore(): Map<PathKey, ErrorEntry[]> {
  const m = new Map<PathKey, ErrorEntry[]>()
  for (let i = 0; i < 100; i++) {
    const dotted = `group${Math.floor(i / 10)}.field${i % 10}`
    const { key, segments } = canonicalizePath(dotted)
    m.set(key, [{ message: `bad ${i}`, path: segments, code: 'atta:test' }])
  }
  return m
}

function makeUncachedKeysFromOldStore(store: Map<PathKey, ErrorEntry[]>): PathKey[] {
  // Pre-5.2 baseline: PathKey strings without the inverse cache
  // populated. We can't actually un-warm the cache from outside it,
  // but the old branch below uses raw `JSON.parse` and so doesn't
  // touch the cache anyway — the keys are functionally cold relative
  // to that code path.
  return [...store.keys()]
}

const errorStore = makeErrorStore()
const errorKeys = makeUncachedKeysFromOldStore(errorStore)

describe('materializeErrors inner loop: 100-entry error store', () => {
  // Worst-case container scope: root container with no descendant
  // filter. Both branches walk every entry.
  const containerSegments: readonly Segment[] = []

  bench('old: JSON.parse(pathKey) per entry', () => {
    let collected = 0
    entries: for (const [pathKey, errors] of errorStore) {
      if (errors.length === 0) continue
      const fullPath = JSON.parse(pathKey) as Segment[]
      if (fullPath.length <= containerSegments.length) continue
      for (let i = 0; i < containerSegments.length; i++) {
        if (fullPath[i] !== containerSegments[i]) continue entries
      }
      collected += errors.length
    }
    if (collected === 0) throw new Error('fixture invariant: 100 errors expected')
  })

  bench('new: segmentsForPathKey via inverse cache', () => {
    let collected = 0
    entries: for (const [pathKey, errors] of errorStore) {
      if (errors.length === 0) continue
      const fullPath = segmentsForPathKey(pathKey)
      if (fullPath === null) continue
      if (fullPath.length <= containerSegments.length) continue
      for (let i = 0; i < containerSegments.length; i++) {
        if (fullPath[i] !== containerSegments[i]) continue entries
      }
      collected += errors.length
    }
    if (collected === 0) throw new Error('fixture invariant: 100 errors expected')
  })

  // Ensure the keys array is referenced so the constructor isn't
  // tree-shaken out of the bench fixture.
  if (errorKeys.length !== 100) throw new Error('fixture invariant: 100 keys expected')
})
