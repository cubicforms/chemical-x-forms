import { describe, expect, it } from 'vitest'
import { createStepperRegistry } from '../../src/runtime/core/stepper-registry'

/**
 * `stepper-registry` is the per-stepper bookkeeping primitive that
 * coordinates with `useAbstractForm.settle`. A stepper claims each
 * participating form's key, marks one of those claims `current`, and
 * (later) signals "this form's factory should defer until activated."
 *
 * Contract:
 *  - `claim(key, isCurrent)` records the claim. Duplicate claim of the
 *    same key from the same registry returns the same record (idempotent).
 *  - `isClaimed(key)` returns whether the key is owned by this registry.
 *  - `shouldDefer(key)` returns `true` for claimed-but-not-current keys.
 *  - `markCurrent(nextKey, priorKey)` flips the current bit and clears
 *    the prior's current bit.
 *  - `registerActivation(key, callback)` attaches a one-shot callback
 *    that fires the first time the key becomes current.
 *  - `dispose()` clears everything — for `onScopeDispose`.
 */

describe('createStepperRegistry', () => {
  it('records a claim and reports it', () => {
    const registry = createStepperRegistry()
    registry.claim('a', false)
    expect(registry.isClaimed('a')).toBe(true)
    expect(registry.isClaimed('b')).toBe(false)
  })

  it('reports current vs deferred', () => {
    const registry = createStepperRegistry()
    registry.claim('a', true)
    registry.claim('b', false)
    expect(registry.shouldDefer('a')).toBe(false)
    expect(registry.shouldDefer('b')).toBe(true)
  })

  it('returns false from shouldDefer for unclaimed keys', () => {
    const registry = createStepperRegistry()
    expect(registry.shouldDefer('never-claimed')).toBe(false)
  })

  it('markCurrent flips the current bit and clears the prior', () => {
    const registry = createStepperRegistry()
    registry.claim('a', true)
    registry.claim('b', false)
    registry.markCurrent('b', 'a')
    expect(registry.shouldDefer('a')).toBe(true)
    expect(registry.shouldDefer('b')).toBe(false)
  })

  it('registerActivation fires on transition into current', () => {
    const registry = createStepperRegistry()
    registry.claim('a', true)
    registry.claim('b', false)
    let bActivated = 0
    registry.registerActivation('b', () => {
      bActivated += 1
    })
    expect(bActivated).toBe(0)
    registry.markCurrent('b', 'a')
    expect(bActivated).toBe(1)
  })

  it('registerActivation is one-shot — re-activation does not re-fire', () => {
    const registry = createStepperRegistry()
    registry.claim('a', true)
    registry.claim('b', false)
    let bActivated = 0
    registry.registerActivation('b', () => {
      bActivated += 1
    })
    registry.markCurrent('b', 'a')
    expect(bActivated).toBe(1)
    registry.markCurrent('a', 'b')
    registry.markCurrent('b', 'a')
    expect(bActivated).toBe(1)
  })

  it('fires immediately if the key is already current at registration time', () => {
    const registry = createStepperRegistry()
    registry.claim('a', true)
    let aActivated = 0
    registry.registerActivation('a', () => {
      aActivated += 1
    })
    expect(aActivated).toBe(1)
  })

  it('dispose clears all claims and activations', () => {
    const registry = createStepperRegistry()
    registry.claim('a', true)
    registry.claim('b', false)
    registry.registerActivation('b', () => {
      throw new Error('should not fire after dispose')
    })
    registry.dispose()
    expect(registry.isClaimed('a')).toBe(false)
    expect(registry.isClaimed('b')).toBe(false)
    registry.markCurrent('b', 'a')
    expect(registry.shouldDefer('b')).toBe(false)
  })
})
