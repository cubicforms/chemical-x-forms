import { fc, test } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { canonicalizePath, type Segment } from '../../src/runtime/core/paths'

/**
 * Properties for path canonicalisation. The invariants here are subtle —
 * the PathKey is a stable Map key, so collisions across "same path, two
 * forms" would cause FormState key lookups to miss. These properties
 * guard the encoding.
 */

// Strings that never contain a dot — avoids the parse-ambiguity between
// "a.b" as a single segment vs ["a", "b"] as two segments. Users who need
// literal dots pass the array form; property testing sticks to strings
// that round-trip unambiguously.
const arbDotlessString = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter((s) => !s.includes('.') && s.trim().length > 0)

// Integer-like string or random non-integer string. Covers the canonical
// normalisation path (integer strings → number segments).
const arbStringSegment = fc.oneof(
  arbDotlessString,
  // Non-negative integer strings (no leading zeros). These normalise to numbers.
  fc.nat({ max: 99 }).map(String)
)

const arbSegment: fc.Arbitrary<Segment> = fc.oneof(arbStringSegment, fc.nat({ max: 99 }))

const arbSegmentArray = fc.array(arbSegment, { maxLength: 6 })

describe('canonicalizePath — properties', () => {
  test.prop([arbSegmentArray])(
    'idempotent: canonicalize(canonicalize(x).segments).key === canonicalize(x).key',
    (segments) => {
      const once = canonicalizePath(segments)
      const twice = canonicalizePath([...once.segments])
      expect(twice.key).toBe(once.key)
    }
  )

  test.prop([fc.array(arbDotlessString, { maxLength: 6 })])(
    'dotted ↔ array form produce the same key',
    (stringSegs) => {
      if (stringSegs.length === 0) return
      const dotted = stringSegs.join('.')
      const byDotted = canonicalizePath(dotted)
      const byArray = canonicalizePath(stringSegs)
      expect(byDotted.key).toBe(byArray.key)
    }
  )

  test.prop([fc.nat({ max: 99 })])('integer-string segments normalise to numbers', (n) => {
    const fromString = canonicalizePath([String(n)])
    const fromNumber = canonicalizePath([n])
    expect(fromString.key).toBe(fromNumber.key)
    // And the underlying segment is a number in both cases.
    expect(typeof fromString.segments[0]).toBe('number')
    expect(typeof fromNumber.segments[0]).toBe('number')
  })

  test.prop([arbSegmentArray, arbSegmentArray])(
    'different segment arrays produce different keys (no plausible collisions)',
    (a, b) => {
      const canonA = canonicalizePath(a)
      const canonB = canonicalizePath(b)
      const segmentsEqual =
        canonA.segments.length === canonB.segments.length &&
        canonA.segments.every((seg, i) => Object.is(seg, canonB.segments[i]))
      if (segmentsEqual) {
        expect(canonA.key).toBe(canonB.key)
      } else {
        expect(canonA.key).not.toBe(canonB.key)
      }
    }
  )
})
