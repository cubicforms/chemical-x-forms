import { describe, expect, it } from 'vitest'
import {
  DEVTOOLS_WINDOW_KEY,
  REDACTED,
  redactSensitiveLeaves,
} from '../../src/runtime/core/devtools-shared'
import type { Segment } from '../../src/runtime/core/paths'

/**
 * Unit tests for the shared devtools redaction. Both the Vue DevTools
 * inspector wire-up and the Nuxt overlay panel consume this — keeping
 * the unit tests close to the shared module means a future tightening
 * of the policy lands one assertion update, not two surfaces' worth.
 */

describe('redactSensitiveLeaves', () => {
  const matchPassword = (seg: Segment): boolean =>
    typeof seg === 'string' && seg.toLowerCase().includes('password')
  const matchNothing = (): boolean => false
  const matchAll = (): boolean => true

  it('returns the input unchanged when no segment matches', () => {
    const input = { email: 'a@b.com', count: 3 }
    expect(redactSensitiveLeaves(input, matchNothing)).toEqual(input)
  })

  it('redacts a top-level leaf at a sensitive key', () => {
    const input = { email: 'a@b.com', password: 'secret' }
    expect(redactSensitiveLeaves(input, matchPassword)).toEqual({
      email: 'a@b.com',
      password: REDACTED,
    })
  })

  it('redacts every leaf below a sensitive ancestor (whole-subtree)', () => {
    const input = { auth: { password: { value: 'x', timestamp: 123 } } }
    const matchPasswordOnly = (seg: Segment): boolean => seg === 'password'
    expect(redactSensitiveLeaves(input, matchPasswordOnly)).toEqual({
      auth: { password: { value: REDACTED, timestamp: REDACTED } },
    })
  })

  it('preserves array structure and only redacts sensitive leaves inside', () => {
    const input = {
      users: [
        { name: 'a', password: '1' },
        { name: 'b', password: '2' },
      ],
    }
    expect(redactSensitiveLeaves(input, matchPassword)).toEqual({
      users: [
        { name: 'a', password: REDACTED },
        { name: 'b', password: REDACTED },
      ],
    })
  })

  it('passes through primitives as-is', () => {
    expect(redactSensitiveLeaves('hello', matchNothing)).toBe('hello')
    expect(redactSensitiveLeaves(42, matchNothing)).toBe(42)
    expect(redactSensitiveLeaves(true, matchNothing)).toBe(true)
    expect(redactSensitiveLeaves(null, matchAll)).toBeNull()
    expect(redactSensitiveLeaves(undefined, matchAll)).toBeUndefined()
  })

  it('redacts non-plain objects (Date, class instance) under a sensitive ancestor', () => {
    const d = new Date()
    expect(redactSensitiveLeaves({ password: d }, matchPassword)).toEqual({ password: REDACTED })
  })

  it('passes Date / class instances through when not under a sensitive ancestor', () => {
    const d = new Date()
    expect(redactSensitiveLeaves({ created: d }, matchNothing)).toEqual({ created: d })
  })

  it('does not mutate the input', () => {
    const input = { password: 'secret', email: 'a@b.com' }
    const snapshot = { password: 'secret', email: 'a@b.com' }
    redactSensitiveLeaves(input, matchPassword)
    expect(input).toEqual(snapshot)
  })

  it('numeric segments never count as sensitive (array indices pass through)', () => {
    const matchAnyString = (seg: Segment): boolean => typeof seg === 'string'
    // The walker passes array indices as the parent's `inSensitiveSubtree`
    // flag, never as fresh segments — so `matchAnyString` doesn't redact
    // here just because indices exist.
    const input = [{ name: 'a' }, { name: 'b' }]
    expect(redactSensitiveLeaves(input, matchAnyString)).toEqual([
      { name: REDACTED },
      { name: REDACTED },
    ])
  })
})

describe('DEVTOOLS_WINDOW_KEY', () => {
  it('is the namespaced window property the bridge attaches to', () => {
    expect(DEVTOOLS_WINDOW_KEY).toBe('__attaform_devtools__')
  })
})
