/**
 * Phase 5.1 baseline perf comparison for the paths module.
 *
 * Two old/new pairs land here:
 *
 *   - canonicalizePath: repeated-input cost before vs after the LRU cache.
 *   - isDirty loop: iterating `originals` with JSON.parse(pathKey) per entry
 *     vs iterating the new {segments, value} record shape.
 *
 * The "old" implementations are kept verbatim inside this file so the
 * ratio gate (scripts/check-bench.mjs, 3× floor) stays a stable regression
 * check against the pre-5.1 baseline.
 */

import { bench, describe } from 'vitest'
import { getAtPath } from '../src/runtime/core/path-walker'
import {
  canonicalizePath,
  parseDottedPath,
  type Path,
  type PathKey,
  type Segment,
} from '../src/runtime/core/paths'

// ---------- Pre-5.1 canonicalizePath (uncached, redundant normalize pass) ----------

const INTEGER_SEGMENT = /^(?:0|[1-9]\d*)$/

function normalizeSegmentLegacy(raw: Segment): Segment {
  if (typeof raw === 'number') return raw
  if (INTEGER_SEGMENT.test(raw)) return Number(raw)
  return raw
}

function oldCanonicalizePath(input: string | Path): {
  segments: readonly Segment[]
  key: PathKey
} {
  const rawSegments: Segment[] =
    typeof input === 'string' ? parseDottedPath(input) : Array.from(input)
  const segments = rawSegments.map(normalizeSegmentLegacy)
  const key = JSON.stringify(segments) as PathKey
  return { segments, key }
}

// ---------- Fixture: 100-leaf form + originals in both shapes ----------

function makeForm100(): Record<string, unknown> {
  const form: Record<string, unknown> = {}
  for (let i = 0; i < 100; i++) {
    const g = `group${Math.floor(i / 10)}`
    const f = `field${i % 10}`
    const group = (form[g] as Record<string, unknown> | undefined) ?? {}
    group[f] = `v${i}`
    form[g] = group
  }
  return form
}

function makeOriginalsOld(): Map<PathKey, unknown> {
  const m = new Map<PathKey, unknown>()
  for (let i = 0; i < 100; i++) {
    const segments: readonly Segment[] = [`group${Math.floor(i / 10)}`, `field${i % 10}`]
    const key = JSON.stringify(segments) as PathKey
    m.set(key, `v${i}`)
  }
  return m
}

function makeOriginalsNew(): Map<PathKey, { segments: readonly Segment[]; value: unknown }> {
  const m = new Map<PathKey, { segments: readonly Segment[]; value: unknown }>()
  for (let i = 0; i < 100; i++) {
    const segments: readonly Segment[] = [`group${Math.floor(i / 10)}`, `field${i % 10}`]
    const key = JSON.stringify(segments) as PathKey
    m.set(key, { segments, value: `v${i}` })
  }
  return m
}

// ---------- Group 1: canonicalizePath on a repeated dotted-string input ----------
//
// Real forms re-canonicalise the same small working-set of dotted paths
// thousands of times per session (every keystroke on a registered field).
// The LRU makes repeat calls O(Map hit) instead of parse + normalize +
// stringify. A deeper path (8 segments, representative of nested
// arrays-of-objects forms like `items.0.variants.0.pricing.regions.0.amount`)
// widens the gap between the cached and uncached paths — parse + stringify
// grow linearly with segment count, while the LRU remains O(1).

const HOT_PATH = 'items.0.variants.0.pricing.regions.0.amount'

describe('canonicalizePath: repeated dotted input', () => {
  bench('old: parse + normalize + stringify, no cache', () => {
    oldCanonicalizePath(HOT_PATH)
  })
  bench('new: LRU-cached on string inputs', () => {
    canonicalizePath(HOT_PATH)
  })
})

// ---------- Group 2: isDirty loop on a 100-leaf pristine form ----------
//
// The `isDirty` computed iterates originals and compares each tracked
// original against the live form value. Pre-5.1, each iteration
// JSON.parsed the PathKey to recover the Path; post-5.1, segments are
// stored alongside the value.

describe('isDirty: 100-leaf pristine form', () => {
  const form = makeForm100()
  const originalsOld = makeOriginalsOld()
  const originalsNew = makeOriginalsNew()

  bench('old: Map<PathKey, unknown> with JSON.parse per entry', () => {
    let dirty = false
    for (const [pathKey, original] of originalsOld) {
      const segments = JSON.parse(pathKey) as Segment[]
      if (!Object.is(getAtPath(form, segments), original)) {
        dirty = true
        break
      }
    }
    // Ensure the result isn't eliminated.
    if (dirty) throw new Error('fixture invariant: 100-leaf pristine form should read clean')
  })

  bench('new: Map<PathKey, {segments, value}> reading stored segments', () => {
    let dirty = false
    for (const [, { segments, value: original }] of originalsNew) {
      if (!Object.is(getAtPath(form, segments), original)) {
        dirty = true
        break
      }
    }
    if (dirty) throw new Error('fixture invariant: 100-leaf pristine form should read clean')
  })
})
