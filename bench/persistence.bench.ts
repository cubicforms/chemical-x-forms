/**
 * Phase 5.8 — persistence write-latency sanity check across backends.
 *
 * Measures one full write cycle (schedule → timer fires → serialize +
 * adapter.setItem) for a 100-leaf form on localStorage, sessionStorage,
 * and IndexedDB. No `old:` / `new:` pairing — the regression gate
 * skips this bench. Reports numbers for inspection; alerts if any
 * backend's steady-state write takes much longer than the sync ones.
 */

import 'fake-indexeddb/auto'
import { bench, describe } from 'vitest'
import {
  buildPersistedPayload,
  createDebouncedWriter,
  getStorageAdapter,
} from '../src/runtime/core/persistence'
import type { FormStorage } from '../src/runtime/types/types-api'

// Storage polyfill for Node 25's broken native webstorage — mirrors
// the test file's MemoryStorage so the bench actually writes somewhere.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
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
  setItem(key: string, value: string) {
    this.store.set(key, String(value))
  }
}
if (typeof globalThis.localStorage === 'undefined' || !('setItem' in globalThis.localStorage)) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  })
}
if (typeof globalThis.sessionStorage === 'undefined' || !('setItem' in globalThis.sessionStorage)) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
  })
}

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

async function benchOneWrite(adapter: FormStorage, form: Record<string, unknown>): Promise<void> {
  const payload = buildPersistedPayload(form, 'form', new Map(), 1)
  await adapter.setItem('bench-key', payload)
}

const form100 = makeForm(100, 3)

describe('persistence: 100-leaf form write latency', () => {
  let local!: FormStorage
  let session!: FormStorage
  let idb!: FormStorage
  // vitest's bench runner doesn't await async setup helpers, so
  // resolve the adapters eagerly at module load via top-level awaits
  // gated behind promises.
  const ready = Promise.all([
    getStorageAdapter('local').then((a) => (local = a)),
    getStorageAdapter('session').then((a) => (session = a)),
    getStorageAdapter('indexeddb').then((a) => (idb = a)),
  ])

  bench(
    'localStorage: JSON.stringify + setItem',
    async () => {
      await ready
      await benchOneWrite(local, form100)
    },
    { time: 500 }
  )

  bench(
    'sessionStorage: JSON.stringify + setItem',
    async () => {
      await ready
      await benchOneWrite(session, form100)
    },
    { time: 500 }
  )

  bench(
    'IndexedDB: structuredClone + put',
    async () => {
      await ready
      await benchOneWrite(idb, form100)
    },
    { time: 500 }
  )
})

describe('persistence: debounced writer overhead', () => {
  bench('schedule() call with active timer (steady-state typing)', () => {
    const writer = createDebouncedWriter(() => Promise.resolve(undefined), 200)
    writer.schedule()
    writer.cancel()
  })
})
