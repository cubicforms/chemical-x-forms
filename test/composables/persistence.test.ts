// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { __resetIndexedDbForTests } from '../../src/runtime/core/persistence/indexeddb'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * Node 25's native `localStorage` (behind `--experimental-webstorage`)
 * lands as an empty-object shell when no `--localstorage-file` is
 * provided, and jsdom loses the race to override it. Install a minimal
 * in-memory polyfill for both Storage surfaces so our tests see a
 * conformant `Storage` with working `getItem` / `setItem` / `clear`.
 */
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
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value))
  }
}
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
})
Object.defineProperty(globalThis, 'sessionStorage', {
  value: new MemoryStorage(),
  configurable: true,
})

/**
 * Phase 5.8 — persistence across all three built-in backends.
 *
 * Covers hydration (read on mount), debounced writes, submit-success
 * clearing, version-bump invalidation, missing-backend fallback, and
 * async-read flash (IDB).
 */

const schema = z.object({
  email: z.string(),
  password: z.string(),
})

type ApiReturn = ReturnType<typeof useForm<typeof schema>>

function mountForm(persist: Parameters<typeof useForm<typeof schema>>[0]['persist']): {
  app: App
  api: ApiReturn
} {
  const handle: { api?: ApiReturn } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: `persist-${Math.random().toString(36).slice(2)}`,
        ...(persist ? { persist } : {}),
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as ApiReturn }
}

async function drain(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/**
 * Poll `predicate` until it returns a non-null / non-undefined value or
 * the timeout elapses. Avoids the classic `await wait(40)` flake: the
 * debounced writer + adapter chain (dynamic-imported + Promise.then →
 * adapter.setItem) can exceed a fixed sleep on a loaded CI runner,
 * even for an expected 20 ms debounce window. Polling converges as
 * soon as the write lands, with a generous ceiling (default 500 ms)
 * so a genuinely broken write still fails the assertion instead of
 * hanging the suite.
 */
async function waitUntil<T>(
  predicate: () => T | null | undefined,
  timeoutMs = 500,
  intervalMs = 5
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = predicate()
    if (v !== null && v !== undefined) return v
    if (Date.now() >= deadline) return null
    await wait(intervalMs)
  }
}

describe('persistence — localStorage backend', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('writes form state after a mutation + debounce window', async () => {
    const { app, api } = mountForm({ storage: 'local', key: 'test-local', debounceMs: 20 })
    apps.push(app)
    await drain()
    api.setValue('email', 'alice@example.com')
    const raw = await waitUntil(() => localStorage.getItem('test-local'))
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { v: number; data: { form: { email: string } } }
    expect(payload.v).toBe(2)
    expect(payload.data.form.email).toBe('alice@example.com')
  })

  it('hydrates from a persisted payload on mount', async () => {
    localStorage.setItem(
      'test-hydrate',
      JSON.stringify({ v: 2, data: { form: { email: 'seed@example.com', password: 'pw' } } })
    )
    const { app, api } = mountForm({ storage: 'local', key: 'test-hydrate', debounceMs: 20 })
    apps.push(app)
    // Hydration is async (dynamic import + adapter.getItem + apply).
    // Poll the getValue ref until the replacement lands rather than
    // wagering a fixed sleep — the adapter's dynamic import alone can
    // take a variable number of microtasks on a cold CI runner.
    await waitUntil(() => (api.getValue('email').value === 'seed@example.com' ? true : null))
    expect(api.getValue('email').value).toBe('seed@example.com')
    expect(api.getValue('password').value).toBe('pw')
  })

  it('drops a version-mismatched payload', async () => {
    localStorage.setItem(
      'test-vmismatch',
      JSON.stringify({ v: 99, data: { form: { email: 'stale@x.com', password: 'stale' } } })
    )
    const { app, api } = mountForm({
      storage: 'local',
      key: 'test-vmismatch',
      debounceMs: 20,
      version: 1,
    })
    apps.push(app)
    await drain()
    // Schema defaults (empty strings) — the stale payload was rejected.
    expect(api.getValue('email').value).toBe('')
  })

  it('clears the persisted entry on submit success', async () => {
    localStorage.setItem(
      'test-clear',
      JSON.stringify({ v: 2, data: { form: { email: 'pre@x.com', password: 'pw' } } })
    )
    const { app, api } = mountForm({ storage: 'local', key: 'test-clear', debounceMs: 20 })
    apps.push(app)
    // The seed payload is in place before mount; hydration replays it
    // and is async, so wait for the form to actually carry the seed
    // value before we submit. Otherwise a submit-during-hydration
    // races the clear-on-success path.
    await waitUntil(() => (api.getValue('email').value === 'pre@x.com' ? true : null))
    const handler = api.handleSubmit(async () => {})
    await handler()
    // The onSubmitSuccess listener fires a fire-and-forget
    // flush()→removeItem() chain; poll for the entry to disappear
    // rather than wagering a fixed sleep.
    await waitUntil(() => (localStorage.getItem('test-clear') === null ? true : null))
    expect(localStorage.getItem('test-clear')).toBeNull()
  })

  it('honours clearOnSubmitSuccess: false', async () => {
    const { app, api } = mountForm({
      storage: 'local',
      key: 'test-noclear',
      debounceMs: 20,
      clearOnSubmitSuccess: false,
    })
    apps.push(app)
    await drain()
    api.setValue('email', 'user@x.com')
    await waitUntil(() => localStorage.getItem('test-noclear'))
    expect(localStorage.getItem('test-noclear')).not.toBeNull()
    const handler = api.handleSubmit(async () => {})
    await handler()
    await drain()
    // Entry stayed — user opted out of clear-on-success. Give a small
    // wait afterwards to prove the clear path genuinely didn't run
    // (otherwise a delayed removeItem would fail this after the
    // assertion settles).
    await wait(40)
    expect(localStorage.getItem('test-noclear')).not.toBeNull()
  })
})

describe('persistence — sessionStorage backend', () => {
  const apps: App[] = []
  beforeEach(() => sessionStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    sessionStorage.clear()
  })

  it('round-trips through sessionStorage', async () => {
    const { app, api } = mountForm({ storage: 'session', key: 'test-session', debounceMs: 20 })
    apps.push(app)
    await drain()
    api.setValue('email', 'sess@example.com')
    const raw = await waitUntil(() => sessionStorage.getItem('test-session'))
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { data: { form: { email: string } } }
    expect(payload.data.form.email).toBe('sess@example.com')
  })
})

describe('persistence — IndexedDB backend', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    __resetIndexedDbForTests()
  })

  it('writes + hydrates through IDB', async () => {
    const { app, api } = mountForm({ storage: 'indexeddb', key: 'test-idb-rt', debounceMs: 20 })
    apps.push(app)
    await drain(16)
    api.setValue('email', 'idb@example.com')
    // Wait for the debounced write to reach IDB. We can't peek IDB
    // directly, but the second-mount hydration below IS what reads
    // the stored value, so polling the hydrated ref is the reliable
    // convergence signal. A small hold here lets the write's tx
    // settle before we tear the db down.
    await wait(80)
    await drain(16)
    app.unmount()
    __resetIndexedDbForTests()
    const second = mountForm({ storage: 'indexeddb', key: 'test-idb-rt', debounceMs: 20 })
    apps.push(second.app)
    await waitUntil(() => (second.api.getValue('email').value === 'idb@example.com' ? true : null))
    expect(second.api.getValue('email').value).toBe('idb@example.com')
  })
})

describe('persistence — include=form+errors', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('persists user-injected errors under userErrors when include=form+errors is set', async () => {
    const { app, api } = mountForm({
      storage: 'local',
      key: 'test-form-errors',
      debounceMs: 20,
      include: 'form+errors',
    })
    apps.push(app)
    await drain()
    api.setFieldErrors([{ path: ['email'], message: 'bad', formKey: api.key }])
    // setFieldErrors doesn't go through applyFormReplacement, but our
    // persistence listens to onFormChange which IS the form channel.
    // To stage the error for persistence, trigger a form mutation too.
    api.setValue('password', 'trigger')
    const raw = await waitUntil(() => localStorage.getItem('test-form-errors'))
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as {
      data: {
        schemaErrors?: ReadonlyArray<readonly [string, { message: string }[]]>
        userErrors?: ReadonlyArray<readonly [string, { message: string }[]]>
      }
    }
    // setFieldErrors routes to the user-error store, so the persisted
    // payload carries the entry under `userErrors`. Schema errors stay
    // an empty array (no validation errors fired here).
    expect(payload.data.userErrors).toBeDefined()
    const userMessages = payload.data.userErrors!.flatMap(([, errs]) => errs.map((e) => e.message))
    expect(userMessages).toContain('bad')
    expect(payload.data.schemaErrors).toBeDefined()
    const schemaMessages = payload.data.schemaErrors!.flatMap(([, errs]) =>
      errs.map((e) => e.message)
    )
    expect(schemaMessages).not.toContain('bad')
  })
})
