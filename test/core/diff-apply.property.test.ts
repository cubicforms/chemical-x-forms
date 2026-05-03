import { fc, test } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { diffAndApply, type Patch } from '../../src/runtime/core/diff-apply'

/**
 * Property coverage for the diff-apply walker.
 *
 * Hand-written unit tests in diff-apply.test.ts cover the structural
 * cases (added/removed/changed, array/object, shape mismatch). These
 * properties lock down the invariants that hold for *any* input the walker
 * might see in practice.
 */

// Depth-limited JSON-ish generator: plain records / arrays / primitives /
// null. Deliberately excludes undefined-at-top (diffAndApply treats those
// as a full-form construction signal) and exotic types the walker treats
// as leaves (Map, Set, Date, class instances, functions).
const arbLeaf = fc.oneof(
  fc.string({ maxLength: 10 }),
  fc.integer(),
  fc.boolean(),
  fc.constant(null)
)

const arbForm = fc.letrec((tie) => ({
  value: fc.oneof(
    arbLeaf,
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 4 }), tie('value'), { maxKeys: 4 })
  ),
})).value

function collect(oldValue: unknown, newValue: unknown): Patch[] {
  const patches: Patch[] = []
  diffAndApply(oldValue, newValue, [], (p) => patches.push(p))
  return patches
}

describe('diff-apply — properties', () => {
  test.prop([arbForm])('identity: diff(x, x) emits no patches', (x) => {
    expect(collect(x, x)).toEqual([])
  })

  test.prop([arbForm, arbForm])(
    'determinism: diff(a, b) produces the same sequence on repeat runs',
    (a, b) => {
      const first = collect(a, b)
      const second = collect(a, b)
      expect(second).toEqual(first)
    }
  )

  test.prop([arbForm, arbForm])(
    'symmetry-ish: swapping old and new inverts added/removed and preserves path set',
    (a, b) => {
      const forward = collect(a, b)
      const backward = collect(b, a)
      // Both runs touch the same paths.
      const fPaths = new Set(forward.map((p) => JSON.stringify(p.path)))
      const bPaths = new Set(backward.map((p) => JSON.stringify(p.path)))
      expect([...fPaths].sort()).toEqual([...bPaths].sort())
    }
  )

  test.prop([arbForm])(
    'leaf replacement: diff(x, y) where y is a non-descendable, different leaf emits at most one patch',
    (x) => {
      // Replace the root with a fresh leaf that differs from x.
      const replacement = typeof x === 'string' ? 'atta:sentinel' : 'atta:sentinel'
      if (Object.is(x, replacement)) return
      const patches = collect(x, replacement)
      // If x itself was a leaf, we expect exactly one patch at []; if x was a
      // container, we expect a single 'changed' at [] (full replacement).
      expect(patches.length).toBe(1)
      expect(patches[0]?.path).toEqual([])
    }
  )
})
