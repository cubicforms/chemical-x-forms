/**
 * Phase 1 PR 1a baseline perf comparison.
 *
 * Old approach (src/runtime/lib/core/composables/use-form-store.ts's
 * updateFormSummaryValuesRecord): deep `watch` on the form store fires on
 * every keystroke, then the callback flattens BOTH old and new forms into
 * dotted records, computes three set differences + three intersections, then
 * iterates every key to recompute currentValue/previousValue/originalValue/
 * pristine/dirty. This is O(total leaf count), regardless of how little
 * changed.
 *
 * New approach (src/runtime/core/diff-apply.ts): a single structural walk
 * that emits patches only for leaves that differ. O(size of changed subtree).
 *
 * This bench simulates a single keystroke on a 100-leaf nested form and
 * measures ops/sec for each approach. Target per the plan: >3× improvement.
 */

import { bench, describe } from 'vitest'
import { diffAndApply, type Patch } from '../src/runtime/core/diff-apply'

// The "old approach" utilities (flattenObjectWithBaseKey + setDifference +
// setIntersection) used to live under src/runtime/lib/core/utils/ but were
// deleted as part of Phase 2.3. We keep verbatim copies here so the bench
// keeps comparing the new writer against the exact historical algorithm.

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isArrayOrRecord(value: unknown): value is unknown[] | Record<string, unknown> {
  return Array.isArray(value) || isRecord(value)
}

function flattenObjectWithBaseKey(obj: unknown, basePath?: string): Record<string, unknown> {
  const recordedPaths: Record<string, unknown> = {}
  function logic(currentValue: unknown, _basePath?: string): void {
    if (!isArrayOrRecord(currentValue)) {
      recordedPaths[_basePath ?? ''] = currentValue
      return
    }
    for (const key of Object.keys(currentValue)) {
      const childValue = (currentValue as Record<string, unknown>)[key]
      const targetPath =
        _basePath !== undefined && _basePath.length > 0 ? `${_basePath}.${key}` : key
      if (!isArrayOrRecord(childValue)) {
        recordedPaths[targetPath] = childValue
        continue
      }
      logic(childValue, targetPath)
    }
  }
  logic(obj, basePath)
  return recordedPaths
}

function setDifference<T>(primary: Set<T>, secondary: Set<T>): Set<T> {
  const diff = new Set<T>()
  for (const item of primary) {
    if (!secondary.has(item)) diff.add(item)
  }
  return diff
}

function setIntersection<T>(first: Set<T>, second: Set<T>): Set<T> {
  const intersection = new Set<T>()
  const smallest = first.size <= second.size ? first : second
  const other = smallest === first ? second : first
  for (const item of smallest) {
    if (other.has(item)) intersection.add(item)
  }
  return intersection
}

type Summary = {
  currentValue: unknown
  previousValue: unknown
  originalValue: unknown
  pristine: boolean
  dirty: boolean
}

/** Generate a form tree with ~leafCount leaves nested ~depth-deep. */
function makeForm(leafCount: number, depth: number): Record<string, unknown> {
  const form: Record<string, unknown> = {}
  let produced = 0
  const groupSize = Math.max(1, Math.ceil(leafCount / 10))
  for (let group = 0; produced < leafCount; group++) {
    const groupKey = `group${group}`
    let cursor: Record<string, unknown> = (form[groupKey] = {})
    for (let d = 1; d < depth; d++) {
      const inner: Record<string, unknown> = {}
      cursor[`level${d}`] = inner
      cursor = inner
    }
    for (let i = 0; i < groupSize && produced < leafCount; i++) {
      cursor[`field${i}`] = `value${produced}`
      produced++
    }
  }
  return form
}

/**
 * Deeply clone and mutate one leaf to simulate a single keystroke.
 *
 * Descends through `level1 → level2 → … → levelN` greedily until it
 * reaches a parent node whose first child is NOT a `levelN` container
 * — the field-bearing parent. The previous hardcoded
 * `level1 → level2 → break` walker stopped one level early at depth ≥ 4
 * and ended up mutating a `levelN` key itself (clobbering the whole
 * leaves-bearing subtree with a primitive). That made the 500-leaf
 * bench measure subtree replacement instead of a single-leaf
 * keystroke and gave a misleading speedup ratio.
 */
function mutateOneLeaf(form: Record<string, unknown>, newValue: unknown): Record<string, unknown> {
  // Structured clone for a fair "next state" object (keeps ref inequality).
  const next = structuredClone(form) as Record<string, unknown>
  let node = next['group0'] as Record<string, unknown>
  // Walk down through every `level\d+` child until we hit the parent of
  // the field leaves. Since our generator only emits one container per
  // level, the first matching key is unambiguous.
  for (;;) {
    const childKeys = Object.keys(node)
    const levelKey = childKeys.find((k) => /^level\d+$/.test(k))
    if (levelKey === undefined) break
    node = node[levelKey] as Record<string, unknown>
  }
  // Mutate the first leaf in the field-bearing parent.
  for (const k of Object.keys(node)) {
    node[k] = newValue
    break
  }
  return next
}

/** The pre-rewrite algorithm, simplified to the hot path relevant for the bench. */
function oldApproach(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
  summaryValues: Record<string, Summary>
): void {
  const currentFlat = flattenObjectWithBaseKey(current)
  const previousFlat = flattenObjectWithBaseKey(previous)

  const currentKeys = new Set(Object.keys(currentFlat))
  const previousKeys = new Set(Object.keys(previousFlat))
  const summaryKeys = new Set(Object.keys(summaryValues))

  const newKeys = setDifference(currentKeys, previousKeys)
  const deletedKeys = setDifference(previousKeys, currentKeys)
  const persistedKeys = setIntersection(currentKeys, previousKeys)

  const unknownPersistedKeys = setDifference(persistedKeys, summaryKeys)
  const alreadyDeletedKeys = setDifference(deletedKeys, summaryKeys)
  const preExistingSummaryKeys = setIntersection(newKeys, summaryKeys)

  for (const key of alreadyDeletedKeys) deletedKeys.delete(key)
  for (const key of unknownPersistedKeys) {
    persistedKeys.delete(key)
    newKeys.add(key)
  }
  for (const key of preExistingSummaryKeys) {
    persistedKeys.add(key)
    newKeys.delete(key)
  }

  for (const key of newKeys) {
    summaryValues[key] = {
      currentValue: currentFlat[key],
      previousValue: undefined,
      originalValue: currentFlat[key],
      pristine: true,
      dirty: false,
    }
  }
  for (const key of deletedKeys) {
    delete summaryValues[key]
  }
  for (const key of persistedKeys) {
    const prev =
      previousFlat[key] === currentFlat[key] ? summaryValues[key]?.previousValue : previousFlat[key]
    const dirty = summaryValues[key]?.originalValue !== currentFlat[key]
    summaryValues[key] = {
      currentValue: currentFlat[key],
      previousValue: prev,
      originalValue: summaryValues[key]?.originalValue,
      pristine: !dirty,
      dirty,
    }
  }
}

/** The new approach: walk once, emit per-leaf patches. */
function newApproach(current: Record<string, unknown>, previous: Record<string, unknown>): Patch[] {
  const patches: Patch[] = []
  diffAndApply(previous, current, [], (p) => patches.push(p))
  return patches
}

describe('keystroke: 100-leaf form, single-leaf mutation', () => {
  const previous = makeForm(100, 3)
  const current = mutateOneLeaf(previous, 'typed-char')
  const summaryValues: Record<string, Summary> = {}
  // Seed the summary map to match the pre-rewrite's typical state.
  for (const [k, v] of Object.entries(flattenObjectWithBaseKey(previous))) {
    summaryValues[k] = {
      currentValue: v,
      previousValue: undefined,
      originalValue: v,
      pristine: true,
      dirty: false,
    }
  }

  // Clone ONCE outside the measured loop. oldApproach mutates its
  // summary map, but current/previous don't change between iterations,
  // so after the first run the map converges to a stable steady-state.
  // Subsequent iterations still exercise the full algorithm (flatten,
  // setDifference / setIntersection, persisted-keys rebuild) — big-O
  // identical to the cold-start run. Cloning inside the bench inflated
  // the ratio gate, charging clone overhead to `old:` runs only.
  const summaryCopy = { ...summaryValues }
  bench('old: flatten + setDifference x3 + setIntersection x3 + key iteration', () => {
    oldApproach(current, previous, summaryCopy)
  })

  bench('new: diffAndApply emits patches only for changed leaves', () => {
    newApproach(current, previous)
  })
})

describe('keystroke: 500-leaf form, single-leaf mutation', () => {
  const previous = makeForm(500, 4)
  const current = mutateOneLeaf(previous, 'typed-char')
  const summaryValues: Record<string, Summary> = {}
  for (const [k, v] of Object.entries(flattenObjectWithBaseKey(previous))) {
    summaryValues[k] = {
      currentValue: v,
      previousValue: undefined,
      originalValue: v,
      pristine: true,
      dirty: false,
    }
  }

  const summaryCopy = { ...summaryValues }
  bench('old: 500-leaf form', () => {
    oldApproach(current, previous, summaryCopy)
  })

  bench('new: 500-leaf form', () => {
    newApproach(current, previous)
  })
})
