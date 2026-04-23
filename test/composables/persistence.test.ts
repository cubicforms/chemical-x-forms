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
    await wait(50)
    const raw = localStorage.getItem('test-local')
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { v: number; data: { form: { email: string } } }
    expect(payload.v).toBe(1)
    expect(payload.data.form.email).toBe('alice@example.com')
  })

  it('hydrates from a persisted payload on mount', async () => {
    localStorage.setItem(
      'test-hydrate',
      JSON.stringify({ v: 1, data: { form: { email: 'seed@example.com', password: 'pw' } } })
    )
    const { app, api } = mountForm({ storage: 'local', key: 'test-hydrate', debounceMs: 20 })
    apps.push(app)
    // Hydration is async (dynamic import + adapter.getItem + apply) —
    // drain microtasks AND a real-time wait so the full chain settles.
    await wait(30)
    await drain()
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
      JSON.stringify({ v: 1, data: { form: { email: 'pre@x.com', password: 'pw' } } })
    )
    const { app, api } = mountForm({ storage: 'local', key: 'test-clear', debounceMs: 20 })
    apps.push(app)
    await wait(40)
    await drain()
    const handler = api.handleSubmit(async () => {})
    await handler()
    // The onSubmitSuccess listener fires a fire-and-forget
    // flush()→removeItem() chain; give real time for the microtask
    // pipeline to settle and localStorage.removeItem to land.
    await wait(40)
    await drain()
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
    await wait(40)
    expect(localStorage.getItem('test-noclear')).not.toBeNull()
    const handler = api.handleSubmit(async () => {})
    await handler()
    await drain()
    // Entry stayed — user opted out of clear-on-success.
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
    await wait(40)
    const raw = sessionStorage.getItem('test-session')
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
    await wait(80)
    await drain(16)
    // Remount a different form component with the same storage key —
    // the payload should be in IDB and hydrate.
    app.unmount()
    __resetIndexedDbForTests()
    const second = mountForm({ storage: 'indexeddb', key: 'test-idb-rt', debounceMs: 20 })
    apps.push(second.app)
    await drain(16)
    await wait(40)
    await drain(16)
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

  it('persists fieldErrors when include=form+errors is set', async () => {
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
    await wait(40)
    const raw = localStorage.getItem('test-form-errors')
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as {
      data: { errors?: ReadonlyArray<readonly [string, { message: string }[]]> }
    }
    expect(payload.data.errors).toBeDefined()
    const flatMessages = payload.data.errors!.flatMap(([, errs]) => errs.map((e) => e.message))
    expect(flatMessages).toContain('bad')
  })
})
