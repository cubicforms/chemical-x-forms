// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
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
type Field = 'email' | 'password'

function mountForm(persist: Parameters<typeof useForm<typeof schema>>[0]['persist']): {
  app: App
  api: ApiReturn
  /**
   * Drive a write through the v-register directive — the canonical "user
   * typed something" path. With per-element opt-in semantics, persistence
   * only fires for writes sourced from a binding that opted in via
   * `register('foo', { persist: true })`. Programmatic `api.setValue`
   * intentionally bypasses the persistence pipeline; a test that wants
   * to exercise the persistence layer must drive its mutation through a
   * real input element.
   */
  type: (field: Field, value: string) => void
} {
  const inputs: Partial<Record<Field, HTMLInputElement>> = {}
  const handle: { api?: ApiReturn } = {}
  const App = defineComponent({
    setup() {
      const api = useForm({
        schema,
        key: `persist-${Math.random().toString(36).slice(2)}`,
        ...(persist ? { persist } : {}),
      })
      handle.api = api
      // Both fields opt in. Tests that focus on a single field still get
      // a mounted directive for the other one — fine, since opted-in but
      // never-typed fields produce no writes.
      return () =>
        h('div', [
          withDirectives(
            h('input', {
              type: 'text',
              ref: (el): void => {
                if (el !== null) inputs.email = el as HTMLInputElement
              },
            }),
            [[vRegister, api.register('email', { persist: true })]]
          ),
          withDirectives(
            h('input', {
              type: 'text',
              ref: (el): void => {
                if (el !== null) inputs.password = el as HTMLInputElement
              },
            }),
            // `password` matches the sensitive-name heuristic — tests
            // intentionally opt in here to exercise the persistence
            // pipeline. Real consumers should NOT persist passwords;
            // the override forces a code-review trigger every time.
            [[vRegister, api.register('password', { persist: true, acknowledgeSensitive: true })]]
          ),
        ])
    },
  })
  const app = createApp(App).use(createChemicalXForms())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  const type = (field: Field, value: string): void => {
    const el = inputs[field]
    if (el === undefined) throw new Error(`mountForm: <input> for ${field} not mounted`)
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return { app, api: handle.api as ApiReturn, type }
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
    const { app, type } = mountForm({ storage: 'local', key: 'test-local', debounceMs: 20 })
    apps.push(app)
    await drain()
    type('email', 'alice@example.com')
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
    const { app, api, type } = mountForm({
      storage: 'local',
      key: 'test-noclear',
      debounceMs: 20,
      clearOnSubmitSuccess: false,
    })
    apps.push(app)
    await drain()
    type('email', 'user@x.com')
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
    const { app, type } = mountForm({ storage: 'session', key: 'test-session', debounceMs: 20 })
    apps.push(app)
    await drain()
    type('email', 'sess@example.com')
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
    const { app, type } = mountForm({ storage: 'indexeddb', key: 'test-idb-rt', debounceMs: 20 })
    apps.push(app)
    await drain(16)
    type('email', 'idb@example.com')
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
    const { app, api, type } = mountForm({
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
    // Drive a real input event on a persist-opted-in field to stage the
    // error for persistence — programmatic api.setValue would bypass the
    // per-element gate.
    type('password', 'trigger')
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

/**
 * Per-element persist opt-in — the headline new contract.
 *
 * The security model: only writes sourced from a binding that explicitly
 * opted in via `register('foo', { persist: true })` reach the storage
 * adapter. Programmatic `api.setValue` does NOT persist. Inputs without
 * an opt-in flag do NOT persist. Two inputs on the same path are tracked
 * independently — one can opt in while the other doesn't.
 *
 * Together these invariants prevent the "developer adds a CVV field
 * later, persistence silently extends to cover it" footgun. Persistence
 * is announced explicitly at every binding's call site.
 */
describe('persistence — per-element opt-in', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('programmatic api.setValue does NOT persist (no opt-in carrier)', async () => {
    // Mount with `persist:` configured but no v-register inputs at all
    // — so no opt-ins exist. Programmatic setValue must not write.
    const handle: { api?: ApiReturn } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: 'opt-in-no-bindings',
          persist: { storage: 'local', key: 'test-noop', debounceMs: 20 },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)

    handle.api?.setValue('email', 'leak@example.com')
    // Generous wait — debounce is 20 ms, so 80 ms covers timer + drain.
    await wait(80)
    await drain()
    expect(localStorage.getItem('test-noop')).toBeNull()
  })

  it('directive write WITHOUT register({ persist: true }) does NOT persist', async () => {
    // Reverse of mountForm: render an input, but call `register('email')`
    // with NO options. The input fires real input events; the directive's
    // assigner attaches `meta.persist: false` because this element has
    // no opt-in. Storage must stay empty.
    const handle: { api?: ApiReturn; el?: HTMLInputElement } = {}
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: 'opt-in-no-flag',
          persist: { storage: 'local', key: 'test-no-flag', debounceMs: 20 },
        })
        handle.api = api
        return () =>
          h('div', [
            withDirectives(
              h('input', {
                type: 'text',
                ref: (el): void => {
                  if (el !== null) handle.el = el as HTMLInputElement
                },
              }),
              [[vRegister, api.register('email')]] // <-- no { persist: true }
            ),
          ])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)

    const input = handle.el as HTMLInputElement
    input.value = 'no-opt-in@example.com'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(80)
    await drain()
    expect(localStorage.getItem('test-no-flag')).toBeNull()
    // Sanity: the value still landed in the form ref (writes work, just
    // no persistence).
    expect(handle.api?.getValue('email').value).toBe('no-opt-in@example.com')
  })

  it('two inputs on the same path: only the opted-in one persists', async () => {
    // The crux of the per-element model. Both inputs bind to 'email';
    // input A opts in, input B does not. Typing in A persists; typing
    // in B doesn't.
    const handle: { a?: HTMLInputElement; b?: HTMLInputElement } = {}
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: 'opt-in-mixed',
          persist: { storage: 'local', key: 'test-mixed', debounceMs: 20 },
        })
        return () =>
          h('div', [
            withDirectives(
              h('input', {
                type: 'text',
                'data-test': 'a',
                ref: (el): void => {
                  if (el !== null) handle.a = el as HTMLInputElement
                },
              }),
              [[vRegister, api.register('email', { persist: true })]]
            ),
            withDirectives(
              h('input', {
                type: 'text',
                'data-test': 'b',
                ref: (el): void => {
                  if (el !== null) handle.b = el as HTMLInputElement
                },
              }),
              [[vRegister, api.register('email')]] // no opt-in
            ),
          ])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)

    // Input B fires first — should NOT persist.
    const b = handle.b as HTMLInputElement
    b.value = 'from-b@example.com'
    b.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(80)
    await drain()
    expect(localStorage.getItem('test-mixed')).toBeNull()

    // Input A fires — should persist.
    const a = handle.a as HTMLInputElement
    a.value = 'from-a@example.com'
    a.dispatchEvent(new Event('input', { bubbles: true }))
    const raw = await waitUntil(() => localStorage.getItem('test-mixed'))
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { data: { form: { email: string } } }
    expect(payload.data.form.email).toBe('from-a@example.com')
  })
})

/**
 * Sensitive-name heuristic: opting a sensitive-named path into
 * persistence throws unless the consumer explicitly acknowledges. Same
 * gate fires for the imperative `form.persist(path)` API.
 */
describe('persistence — sensitive-name heuristic', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('register({ persist: true }) on a sensitive path throws SensitivePersistFieldError', () => {
    // Mount throws synchronously inside the directive's `created` hook.
    // Vue surfaces it through the app's errorHandler; install one that
    // re-throws so the test sees the error.
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: 'sensitive-throw',
          persist: { storage: 'local', key: 'test-sensitive-throw', debounceMs: 20 },
        })
        return () =>
          h('div', [
            withDirectives(
              h('input', { type: 'text' }),
              // password is sensitive; no acknowledge → throw
              [[vRegister, api.register('password', { persist: true })]]
            ),
          ])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    let captured: unknown
    app.config.errorHandler = (err): void => {
      captured = err
    }
    // Silence Vue's warn that wraps the unhandled error.
    app.config.warnHandler = (): void => undefined
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)

    expect(captured).toBeInstanceOf(Error)
    expect((captured as Error).name).toBe('SensitivePersistFieldError')
    expect((captured as Error).message).toMatch(/sensitive-name pattern/)
    expect((captured as Error).message).toMatch(/acknowledgeSensitive/)
  })

  it('acknowledgeSensitive: true on register() bypasses the throw', () => {
    // Just mount — if the directive's enforceSensitiveCheck fires, the
    // mount throws. No throw → assertion of clean mount is enough.
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: 'sensitive-ack',
          persist: { storage: 'local', key: 'test-sensitive-ack', debounceMs: 20 },
        })
        return () =>
          h('div', [
            withDirectives(h('input', { type: 'text' }), [
              [vRegister, api.register('password', { persist: true, acknowledgeSensitive: true })],
            ]),
          ])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    let captured: unknown
    app.config.errorHandler = (err): void => {
      captured = err
    }
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    expect(captured).toBeUndefined()
  })

  it('form.persist() on a sensitive path throws (without acknowledge)', async () => {
    const handle: { api?: ApiReturn } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: 'sensitive-imperative',
          persist: { storage: 'local', key: 'test-sensitive-imp', debounceMs: 20 },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    await drain()
    await expect(handle.api?.persist('password')).rejects.toThrow(/sensitive-name pattern/)
  })

  it('form.persist({ acknowledgeSensitive: true }) on a sensitive path is allowed', async () => {
    const handle: { api?: ApiReturn } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: 'sensitive-imperative-ack',
          persist: { storage: 'local', key: 'test-sensitive-imp-ack', debounceMs: 20 },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    await drain()
    handle.api?.setValue('password', 'unsafe-but-acknowledged')
    await expect(
      handle.api?.persist('password', { acknowledgeSensitive: true })
    ).resolves.toBeUndefined()
    const raw = localStorage.getItem('test-sensitive-imp-ack')
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { data: { form: { password?: string } } }
    expect(payload.data.form.password).toBe('unsafe-but-acknowledged')
  })
})

/**
 * Imperative checkpoint via form.persist + wipe via
 * form.clearPersistedDraft. Both APIs are silent no-ops when persist:
 * isn't configured.
 */
describe('persistence — form.persist / form.clearPersistedDraft', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('form.persist(path) writes the current value, bypassing the per-element gate', async () => {
    // No v-register inputs at all → no opt-ins. setValue alone wouldn't
    // persist. form.persist() is the explicit checkpoint API.
    const handle: { api?: ApiReturn } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: 'imp-persist',
          persist: { storage: 'local', key: 'test-imp-persist', debounceMs: 20 },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    await drain()

    handle.api?.setValue('email', 'checkpoint@example.com')
    await handle.api?.persist('email')
    const raw = localStorage.getItem('test-imp-persist')
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { data: { form: { email: string } } }
    expect(payload.data.form.email).toBe('checkpoint@example.com')
  })

  it('form.persist() preserves prior persisted paths (read-merge-write)', async () => {
    // Seed an entry with both fields populated, then persist only one
    // path's update — the other field's persisted value must survive.
    localStorage.setItem(
      'test-imp-merge',
      JSON.stringify({ v: 2, data: { form: { email: 'prev@x.com', password: 'prev-pw' } } })
    )
    const handle: { api?: ApiReturn } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: 'imp-merge',
          persist: { storage: 'local', key: 'test-imp-merge', debounceMs: 20 },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    // Wait for hydration to land.
    await waitUntil(() => (handle.api?.getValue('email').value === 'prev@x.com' ? true : null))

    handle.api?.setValue('email', 'updated@example.com')
    await handle.api?.persist('email')
    const raw = localStorage.getItem('test-imp-merge')
    const payload = JSON.parse(raw as string) as {
      data: { form: { email: string; password: string } }
    }
    expect(payload.data.form.email).toBe('updated@example.com')
    // Prior 'password' value preserved by the merge.
    expect(payload.data.form.password).toBe('prev-pw')
  })

  it('form.clearPersistedDraft() wipes the entry; form.clearPersistedDraft(path) wipes only that subpath', async () => {
    localStorage.setItem(
      'test-clear-api',
      JSON.stringify({ v: 2, data: { form: { email: 'a@x.com', password: 'pw' } } })
    )
    const handle: { api?: ApiReturn } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: 'clear-api',
          persist: { storage: 'local', key: 'test-clear-api', debounceMs: 20 },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    await waitUntil(() => (handle.api?.getValue('email').value === 'a@x.com' ? true : null))

    // Subpath wipe — email gone, password remains.
    await handle.api?.clearPersistedDraft('email')
    const after1 = JSON.parse(localStorage.getItem('test-clear-api') as string) as {
      data: { form: Record<string, string> }
    }
    expect(after1.data.form['email']).toBeUndefined()
    expect(after1.data.form['password']).toBe('pw')

    // Whole-entry wipe.
    await handle.api?.clearPersistedDraft()
    expect(localStorage.getItem('test-clear-api')).toBeNull()
  })

  it('form.persist / form.clearPersistedDraft are silent no-ops when persist: not configured', async () => {
    const handle: { api?: ApiReturn } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: 'no-persist-config' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    await drain()
    // Both should resolve without throwing or touching storage.
    await expect(handle.api?.persist('email')).resolves.toBeUndefined()
    await expect(handle.api?.clearPersistedDraft()).resolves.toBeUndefined()
  })
})

/**
 * Reset semantics: in-memory clear PLUS persisted-draft wipe. The
 * opt-in registry is preserved so the next user keystroke
 * re-populates the entry naturally.
 */
describe('persistence — reset wipes the persisted draft', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('form.reset() wipes the storage entry and the in-memory state', async () => {
    const { app, api, type } = mountForm({ storage: 'local', key: 'test-reset', debounceMs: 20 })
    apps.push(app)
    await drain()
    type('email', 'before-reset@example.com')
    await waitUntil(() => localStorage.getItem('test-reset'))
    expect(localStorage.getItem('test-reset')).not.toBeNull()

    api.reset()
    // Storage wipe is fire-and-forget — poll for the entry to disappear.
    await waitUntil(() => (localStorage.getItem('test-reset') === null ? true : null))
    expect(localStorage.getItem('test-reset')).toBeNull()
    expect(api.getValue('email').value).toBe('')
  })

  it('sparse payload — only opted-in paths reach storage', async () => {
    // Schema has both `email` and `password`, but only `email` opts in.
    // Storage payload should contain `email` only — the `password` field
    // (the user typed something, since it's a real input) stays in
    // memory but never lands in localStorage.
    const handle: { api?: ApiReturn; emailEl?: HTMLInputElement; passwordEl?: HTMLInputElement } =
      {}
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: 'sparse-payload',
          persist: { storage: 'local', key: 'test-sparse', debounceMs: 20 },
        })
        handle.api = api
        return () =>
          h('div', [
            withDirectives(
              h('input', {
                type: 'text',
                ref: (el): void => {
                  if (el !== null) handle.emailEl = el as HTMLInputElement
                },
              }),
              [[vRegister, api.register('email', { persist: true })]]
            ),
            withDirectives(
              h('input', {
                type: 'text',
                ref: (el): void => {
                  if (el !== null) handle.passwordEl = el as HTMLInputElement
                },
              }),
              // No persist opt-in for password — value will land in
              // memory but NOT in storage.
              [[vRegister, api.register('password')]]
            ),
          ])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)

    // Type into both inputs.
    const emailEl = handle.emailEl as HTMLInputElement
    emailEl.value = 'opted-in@example.com'
    emailEl.dispatchEvent(new Event('input', { bubbles: true }))
    const passwordEl = handle.passwordEl as HTMLInputElement
    passwordEl.value = 'never-persisted'
    passwordEl.dispatchEvent(new Event('input', { bubbles: true }))
    const raw = await waitUntil(() => localStorage.getItem('test-sparse'))
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { data: { form: Record<string, unknown> } }
    expect(payload.data.form['email']).toBe('opted-in@example.com')
    // password is in the form value (in memory) but NOT in the
    // persisted payload — sparse payload contract.
    expect('password' in payload.data.form).toBe(false)
    expect(handle.api?.getValue('password').value).toBe('never-persisted')
  })

  it('sparse hydration — opted-in paths restore; non-opted paths come from schema defaults', async () => {
    // Seed a sparse payload (only email present). On mount, email
    // hydrates from the seed, password falls back to schema default.
    localStorage.setItem(
      'test-sparse-hydrate',
      JSON.stringify({ v: 2, data: { form: { email: 'sparse-seed@x.com' } } })
    )
    const { app, api } = mountForm({
      storage: 'local',
      key: 'test-sparse-hydrate',
      debounceMs: 20,
    })
    apps.push(app)
    await waitUntil(() => (api.getValue('email').value === 'sparse-seed@x.com' ? true : null))
    expect(api.getValue('email').value).toBe('sparse-seed@x.com')
    // password wasn't in the persisted payload → schema default ('').
    expect(api.getValue('password').value).toBe('')
  })

  it('dev warns when persist is configured but no field opted in', async () => {
    // No <input v-register> at all → no opt-ins. The dev warning should
    // fire one microtask after construction.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const App = defineComponent({
        setup() {
          useForm({
            schema,
            key: 'no-opt-ins-warn',
            persist: { storage: 'local', key: 'test-no-opt-warn', debounceMs: 20 },
          })
          return () => h('div')
        },
      })
      const app = createApp(App).use(createChemicalXForms())
      const root = document.createElement('div')
      document.body.appendChild(root)
      app.mount(root)
      apps.push(app)
      // Drain the microtasks so the deferred warning fires.
      await drain()
      const warnCalls = warnSpy.mock.calls.map((args) => args.join(' '))
      const matched = warnCalls.find((msg) =>
        /Persistence is configured.*no fields opted in/.test(msg)
      )
      expect(matched).toBeDefined()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('does NOT warn when at least one field opted in', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const { app } = mountForm({ storage: 'local', key: 'test-warn-skip', debounceMs: 20 })
      apps.push(app)
      await drain()
      const warnCalls = warnSpy.mock.calls.map((args) => args.join(' '))
      const matched = warnCalls.find((msg) =>
        /Persistence is configured.*no fields opted in/.test(msg)
      )
      expect(matched).toBeUndefined()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('form.resetField(path) wipes only the matching subpath from storage', async () => {
    // Seed both fields, mount with both opted in, then resetField just
    // 'email'. Storage should drop email but keep password.
    localStorage.setItem(
      'test-reset-field',
      JSON.stringify({ v: 2, data: { form: { email: 'seed@x.com', password: 'seed-pw' } } })
    )
    const { app, api } = mountForm({
      storage: 'local',
      key: 'test-reset-field',
      debounceMs: 20,
    })
    apps.push(app)
    await waitUntil(() => (api.getValue('email').value === 'seed@x.com' ? true : null))

    api.resetField('email')
    // Wait for the fire-and-forget clearPersistedDraft to land.
    await waitUntil(() => {
      const raw = localStorage.getItem('test-reset-field')
      if (raw === null) return null
      const parsed = JSON.parse(raw) as { data: { form: Record<string, unknown> } }
      return parsed.data.form['email'] === undefined ? true : null
    })
    const final = JSON.parse(localStorage.getItem('test-reset-field') as string) as {
      data: { form: Record<string, string> }
    }
    expect(final.data.form['email']).toBeUndefined()
    expect(final.data.form['password']).toBe('seed-pw')
  })
})
