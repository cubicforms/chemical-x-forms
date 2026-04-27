import { describe, expect, it } from 'vitest'
import { normalizePersistConfig } from '../../src/runtime/core/persistence'
import type { FormStorage } from '../../src/runtime/types/types-api'

describe('normalizePersistConfig', () => {
  it("coerces a 'local' string shorthand into the options bag", () => {
    expect(normalizePersistConfig('local')).toEqual({ storage: 'local' })
  })

  it("coerces 'session' and 'indexeddb' shorthands too", () => {
    expect(normalizePersistConfig('session')).toEqual({ storage: 'session' })
    expect(normalizePersistConfig('indexeddb')).toEqual({ storage: 'indexeddb' })
  })

  it('passes through a full options bag unchanged', () => {
    const full = {
      storage: 'local' as const,
      key: 'custom-key',
      debounceMs: 500,
      version: 7,
      include: 'form+errors' as const,
      clearOnSubmitSuccess: false,
    }
    expect(normalizePersistConfig(full)).toBe(full)
  })

  it('wraps a custom FormStorage adapter into the storage slot', () => {
    const adapter: FormStorage = {
      getItem: () => Promise.resolve(undefined),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.resolve(),
      listKeys: () => Promise.resolve([]),
    }
    const normalized = normalizePersistConfig(adapter)
    expect(normalized.storage).toBe(adapter)
    // Disambiguation hinges on the absence of `'storage' in input`. A
    // sanity check that the FormStorage object did not collide with the
    // options-bag detection.
    expect(normalized).toEqual({ storage: adapter })
  })
})
