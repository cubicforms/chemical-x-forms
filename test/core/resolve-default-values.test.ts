import { describe, expect, it } from 'vitest'
import { resolveTrichotomy } from '../../src/runtime/core/resolve-default-values'

/**
 * `resolveTrichotomy` classifies a `T | (() => T) | (() => Promise<T>)`
 * input into the discriminated union that downstream consumers branch
 * on:
 *  - `kind: 'sync'`  → use `.value` directly at construction.
 *  - `kind: 'async'` → defer via `.factory()` (may be sync or async
 *    function; consumers `await` either way).
 *
 * The classifier is the shared seam for `useForm({ defaultValues })`
 * (PR 1) and `useStepper({ defaultStatuses })` (PR 3). It's
 * intentionally simple — just a `typeof` check — so the contract is
 * easy to reason about and the seam stays at the boundary, not buried
 * downstream.
 */

describe('resolveTrichotomy', () => {
  it('classifies a plain object value as sync', () => {
    const value = { email: 'a@b.c' }
    const result = resolveTrichotomy(value)
    expect(result.kind).toBe('sync')
    if (result.kind === 'sync') {
      expect(result.value).toBe(value)
    }
  })

  it('classifies undefined as sync (value pass-through)', () => {
    const result = resolveTrichotomy<{ email: string } | undefined>(undefined)
    expect(result.kind).toBe('sync')
    if (result.kind === 'sync') {
      expect(result.value).toBeUndefined()
    }
  })

  it('classifies null as sync (value pass-through)', () => {
    const result = resolveTrichotomy<{ email: string } | null>(null)
    expect(result.kind).toBe('sync')
    if (result.kind === 'sync') {
      expect(result.value).toBeNull()
    }
  })

  it('classifies a sync factory as async (deferred path)', () => {
    let calls = 0
    const factory = () => {
      calls += 1
      return { email: 'a@b.c' }
    }
    const result = resolveTrichotomy(factory)
    expect(result.kind).toBe('async')
    // Factory is captured, NOT invoked.
    expect(calls).toBe(0)
  })

  it('classifies an async factory as async', async () => {
    const factory = () => Promise.resolve({ email: 'a@b.c' })
    const result = resolveTrichotomy(factory)
    expect(result.kind).toBe('async')
    if (result.kind === 'async') {
      const value = await result.factory()
      expect(value).toEqual({ email: 'a@b.c' })
    }
  })

  it('async-branch factory normalises sync and async returns via await', async () => {
    // Consumers `await` the factory either way — sync function returns
    // resolve on the next microtask, identical to a Promise that
    // resolved synchronously. The classifier doesn't fork on this.
    const syncFactory = () => ({ count: 1 })
    const asyncFactory = () => Promise.resolve({ count: 2 })

    const a = resolveTrichotomy(syncFactory)
    const b = resolveTrichotomy(asyncFactory)

    if (a.kind === 'async' && b.kind === 'async') {
      const aValue = await a.factory()
      const bValue = await b.factory()
      expect(aValue).toEqual({ count: 1 })
      expect(bValue).toEqual({ count: 2 })
    } else {
      throw new Error('factory branches should classify as async')
    }
  })

  it('factory reference is the same function passed in', () => {
    const factory = () => ({ x: 1 })
    const result = resolveTrichotomy(factory)
    if (result.kind === 'async') {
      expect(result.factory).toBe(factory)
    } else {
      throw new Error('expected async classification')
    }
  })
})
