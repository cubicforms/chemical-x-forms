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
import { flattenObjectWithBaseKey } from '../src/runtime/lib/core/utils/flatten-object'
import { setDifference, setIntersection } from '../src/runtime/lib/core/utils/set-utilities'

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

/** Deeply clone and mutate one leaf to simulate a single keystroke. */
function mutateOneLeaf(form: Record<string, unknown>, newValue: unknown): Record<string, unknown> {
  // Structured clone for a fair "next state" object (keeps ref inequality).
  const next = structuredClone(form) as Record<string, unknown>
  // Walk into a known leaf at group0/level1/.../fieldN — our generator always produces it.
  let node = next
  // Descend to group0
  node = node['group0'] as Record<string, unknown>
  // Descend through levels
  while ('level1' in node) {
    node = node['level1'] as Record<string, unknown>
    if (!('level2' in node)) break
    node = node['level2'] as Record<string, unknown>
    if (!('level3' in node)) break
  }
  // Mutate the first leaf we see in this node.
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

  bench('old: flatten + setDifference x3 + setIntersection x3 + key iteration', () => {
    // Clone the seed map per run so oldApproach mutates don't accumulate.
    const summaryCopy = { ...summaryValues }
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

  bench('old: 500-leaf form', () => {
    const summaryCopy = { ...summaryValues }
    oldApproach(current, previous, summaryCopy)
  })

  bench('new: 500-leaf form', () => {
    newApproach(current, previous)
  })
})
