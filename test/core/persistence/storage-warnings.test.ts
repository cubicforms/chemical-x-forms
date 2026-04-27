// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalStorageAdapter } from '../../../src/runtime/core/persistence/local-storage'
import { createSessionStorageAdapter } from '../../../src/runtime/core/persistence/session-storage'

/**
 * One-shot dev warnings on storage failures (B6). Adapters silently
 * swallowed quota / security errors before — the form looked fine
 * but writes were dropped, leaving consumers unable to diagnose
 * the regression. The fix surfaces the FIRST failure as a
 * `console.warn`, then stays quiet so debounced writes don't
 * spam the console.
 */

class ThrowingStorage implements Storage {
  setItemCalls = 0
  store = new Map<string, string>()
  get length() {
    return this.store.size
  }
  clear() {
    this.store.clear()
  }
  getItem(key: string) {
    return this.store.get(key) ?? null
  }
  key(i: number) {
    return [...this.store.keys()][i] ?? null
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  setItem(_key: string, _value: string) {
    this.setItemCalls++
    throw new DOMException('Quota exceeded', 'QuotaExceededError')
  }
}

async function withStorage(
  globalKey: 'localStorage' | 'sessionStorage',
  storage: Storage,
  fn: () => Promise<void>
): Promise<void> {
  // Hold the original descriptor; restore it AFTER the fn's async
  // body settles so per-tick storage swaps don't leak across `await`
  // boundaries inside fn.
  const original = Object.getOwnPropertyDescriptor(globalThis, globalKey)
  Object.defineProperty(globalThis, globalKey, { value: storage, configurable: true })
  try {
    await fn()
  } finally {
    if (original !== undefined) Object.defineProperty(globalThis, globalKey, original)
  }
}

describe('persistence — localStorage one-shot dev warning', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('warns once on first setItem failure, stays silent on subsequent', async () => {
    const throwing = new ThrowingStorage()
    await withStorage('localStorage', throwing, async () => {
      const adapter = createLocalStorageAdapter()
      await adapter.setItem('k1', { a: 1 })
      await adapter.setItem('k2', { a: 2 })
      await adapter.setItem('k3', { a: 3 })
    })
    expect(throwing.setItemCalls).toBe(3)
    const warnings = warnSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('localStorage write failed')
    )
    expect(warnings.length).toBe(1)
  })
})

describe('persistence — sessionStorage one-shot dev warning', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('warns once on first setItem failure, stays silent on subsequent', async () => {
    const throwing = new ThrowingStorage()
    await withStorage('sessionStorage', throwing, async () => {
      const adapter = createSessionStorageAdapter()
      await adapter.setItem('k1', { a: 1 })
      await adapter.setItem('k2', { a: 2 })
    })
    expect(throwing.setItemCalls).toBe(2)
    const warnings = warnSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('sessionStorage write failed')
    )
    expect(warnings.length).toBe(1)
  })
})
