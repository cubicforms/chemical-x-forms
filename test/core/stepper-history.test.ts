// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStepperHistory } from '../../src/runtime/core/stepper-history'

/**
 * `createStepperHistory(param)` encapsulates `window.history` for the
 * stepper. The primitive is the only DOM-touching module in the
 * stepper surface — it abstracts pushState / replaceState / popstate
 * behind a small handle, lets the stepper composable stay focused on
 * navigation semantics, and stays SSR-safe by returning a no-op
 * handle when `window` is undefined.
 */

const ORIGINAL_URL = 'http://localhost:3000/wizard'

describe('createStepperHistory — primitive', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', ORIGINAL_URL)
  })

  afterEach(() => {
    window.history.replaceState(null, '', ORIGINAL_URL)
  })

  it('push(key) adds a history entry and writes `?step=<key>`', () => {
    const handle = createStepperHistory('step')
    const before = window.history.length
    handle.push('cargo')
    expect(window.history.length).toBeGreaterThan(before)
    expect(new URL(window.location.href).searchParams.get('step')).toBe('cargo')
    handle.dispose()
  })

  it('replace(key) updates current entry without growing history', () => {
    const handle = createStepperHistory('step')
    handle.push('cargo')
    const beforeLen = window.history.length
    handle.replace('review')
    expect(window.history.length).toBe(beforeLen)
    expect(new URL(window.location.href).searchParams.get('step')).toBe('review')
    handle.dispose()
  })

  it('read() returns the current step param value (or undefined)', () => {
    const handle = createStepperHistory('step')
    expect(handle.read()).toBeUndefined()
    handle.push('reference')
    expect(handle.read()).toBe('reference')
    handle.dispose()
  })

  it('subscribe(cb) fires the callback on popstate with the new key', async () => {
    const handle = createStepperHistory('step')
    const seen: Array<string | undefined> = []
    handle.subscribe((key) => seen.push(key))
    handle.push('a')
    handle.push('b')
    window.history.back()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(seen[seen.length - 1]).toBe('a')
    handle.dispose()
  })

  it('dispose() removes the popstate listener (idempotent)', async () => {
    const handle = createStepperHistory('step')
    const cb = vi.fn()
    handle.subscribe(cb)
    handle.push('a')
    handle.dispose()
    handle.dispose() // idempotent
    window.history.replaceState(null, '', ORIGINAL_URL + '?step=zzz')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(cb).not.toHaveBeenCalled()
  })

  it('preserves existing search params when writing the step param', () => {
    window.history.replaceState(null, '', `${ORIGINAL_URL}?ref=email&utm=launch`)
    const handle = createStepperHistory('step')
    handle.push('cargo')
    const url = new URL(window.location.href)
    expect(url.searchParams.get('step')).toBe('cargo')
    expect(url.searchParams.get('ref')).toBe('email')
    expect(url.searchParams.get('utm')).toBe('launch')
    handle.dispose()
  })
})
