import { describe, expect, it } from 'vitest'
import { detectSSR } from '../../src/runtime/core/ssr'

describe('detectSSR', () => {
  it('returns the explicit override when provided', () => {
    expect(detectSSR({ ssr: true })).toBe(true)
    expect(detectSSR({ ssr: false })).toBe(false)
  })

  it('returns false in a DOM-equipped environment (JSDOM provides window/document)', () => {
    // Vitest's default environment ('node') would return true; our vitest config
    // uses jsdom via the existing harness, so this runs under jsdom.
    // If this expectation ever flips (e.g. we switch to node env), update the test
    // to mock away window/document explicitly.
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      expect(detectSSR()).toBe(false)
    } else {
      expect(detectSSR()).toBe(true)
    }
  })

  it('override wins even when window/document exist', () => {
    expect(detectSSR({ ssr: true })).toBe(true)
  })
})
