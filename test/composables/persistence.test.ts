// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { __resetIndexedDbForTests } from '../../src/runtime/core/persistence/indexeddb'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { fingerprintZodSchema } from '../../src/runtime/adapters/zod-v4/fingerprint'

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

/**
 * Fingerprint suffix appended to every storage key by the runtime.
 * Tests that pre-seed storage at a specific key need to seed at the
 * fingerprint-suffixed key the live form will read; otherwise the
 * pre-seeded entry is treated as an orphan (stale-fingerprint) and
 * cleaned up on mount instead of rehydrating.
 */
const FP = fingerprintZodSchema(schema)
const fpKey = (base: string): string => `${base}:${FP}`

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
    const raw = await waitUntil(() => localStorage.getItem(fpKey('test-local')))
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { v: number; data: { form: { email: string } } }
    expect(payload.v).toBe(3)
    expect(payload.data.form.email).toBe('alice@example.com')
  })

  it('hydrates from a persisted payload on mount', async () => {
    localStorage.setItem(
      fpKey('test-hydrate'),
      JSON.stringify({ v: 3, data: { form: { email: 'seed@example.com', password: 'pw' } } })
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

  it('drops AND wipes a version-mismatched payload', async () => {
    localStorage.setItem(
      fpKey('test-vmismatch'),
      JSON.stringify({ v: 99, data: { form: { email: 'stale@x.com', password: 'stale' } } })
    )
    const { app, api } = mountForm({
      storage: 'local',
      key: 'test-vmismatch',
      debounceMs: 20,
    })
    apps.push(app)
    // Schema defaults (empty strings) — the stale payload was rejected.
    // Hydration is async, so wait for the wipe to land before asserting.
    await waitUntil(() => (localStorage.getItem(fpKey('test-vmismatch')) === null ? true : null))
    expect(localStorage.getItem(fpKey('test-vmismatch'))).toBeNull()
    expect(api.getValue('email').value).toBe('')
  })

  it('wipes a malformed-shape payload on mount', async () => {
    // A non-null raw that doesn't match the expected envelope (no `v`,
    // wrong type, etc.) is treated like a stale entry — auto-wiped so
    // sensitive fields from a previous shape can't linger.
    localStorage.setItem(
      fpKey('test-malformed'),
      JSON.stringify({ totally: 'not the right shape', email: 'leak@x.com' })
    )
    const { app, api } = mountForm({
      storage: 'local',
      key: 'test-malformed',
      debounceMs: 20,
    })
    apps.push(app)
    await waitUntil(() => (localStorage.getItem(fpKey('test-malformed')) === null ? true : null))
    expect(localStorage.getItem(fpKey('test-malformed'))).toBeNull()
    expect(api.getValue('email').value).toBe('')
  })

  it('clears the persisted entry on submit success', async () => {
    localStorage.setItem(
      fpKey('test-clear'),
      JSON.stringify({ v: 3, data: { form: { email: 'pre@x.com', password: 'pw' } } })
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
    await waitUntil(() => (localStorage.getItem(fpKey('test-clear')) === null ? true : null))
    expect(localStorage.getItem(fpKey('test-clear'))).toBeNull()
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
    await waitUntil(() => localStorage.getItem(fpKey('test-noclear')))
    expect(localStorage.getItem(fpKey('test-noclear'))).not.toBeNull()
    const handler = api.handleSubmit(async () => {})
    await handler()
    await drain()
    // Entry stayed — user opted out of clear-on-success. Give a small
    // wait afterwards to prove the clear path genuinely didn't run
    // (otherwise a delayed removeItem would fail this after the
    // assertion settles).
    await wait(40)
    expect(localStorage.getItem(fpKey('test-noclear'))).not.toBeNull()
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
    const raw = await waitUntil(() => sessionStorage.getItem(fpKey('test-session')))
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
    const raw = await waitUntil(() => localStorage.getItem(fpKey('test-form-errors')))
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
    expect(localStorage.getItem(fpKey('test-noop'))).toBeNull()
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
    expect(localStorage.getItem(fpKey('test-no-flag'))).toBeNull()
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
    expect(localStorage.getItem(fpKey('test-mixed'))).toBeNull()

    // Input A fires — should persist.
    const a = handle.a as HTMLInputElement
    a.value = 'from-a@example.com'
    a.dispatchEvent(new Event('input', { bubbles: true }))
    const raw = await waitUntil(() => localStorage.getItem(fpKey('test-mixed')))
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
    const raw = localStorage.getItem(fpKey('test-sensitive-imp-ack'))
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
    const raw = localStorage.getItem(fpKey('test-imp-persist'))
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { data: { form: { email: string } } }
    expect(payload.data.form.email).toBe('checkpoint@example.com')
  })

  it('form.persist() preserves prior persisted paths (read-merge-write)', async () => {
    // Seed an entry with both fields populated, then persist only one
    // path's update — the other field's persisted value must survive.
    localStorage.setItem(
      fpKey('test-imp-merge'),
      JSON.stringify({ v: 3, data: { form: { email: 'prev@x.com', password: 'prev-pw' } } })
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
    const raw = localStorage.getItem(fpKey('test-imp-merge'))
    const payload = JSON.parse(raw as string) as {
      data: { form: { email: string; password: string } }
    }
    expect(payload.data.form.email).toBe('updated@example.com')
    // Prior 'password' value preserved by the merge.
    expect(payload.data.form.password).toBe('prev-pw')
  })

  it('form.clearPersistedDraft() wipes the entry; form.clearPersistedDraft(path) wipes only that subpath', async () => {
    localStorage.setItem(
      fpKey('test-clear-api'),
      JSON.stringify({ v: 3, data: { form: { email: 'a@x.com', password: 'pw' } } })
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
    const after1 = JSON.parse(localStorage.getItem(fpKey('test-clear-api')) as string) as {
      data: { form: Record<string, string> }
    }
    expect(after1.data.form['email']).toBeUndefined()
    expect(after1.data.form['password']).toBe('pw')

    // Whole-entry wipe.
    await handle.api?.clearPersistedDraft()
    expect(localStorage.getItem(fpKey('test-clear-api'))).toBeNull()
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
    await waitUntil(() => localStorage.getItem(fpKey('test-reset')))
    expect(localStorage.getItem(fpKey('test-reset'))).not.toBeNull()

    api.reset()
    // Storage wipe is fire-and-forget — poll for the entry to disappear.
    await waitUntil(() => (localStorage.getItem(fpKey('test-reset')) === null ? true : null))
    expect(localStorage.getItem(fpKey('test-reset'))).toBeNull()
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
    const raw = await waitUntil(() => localStorage.getItem(fpKey('test-sparse')))
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
      fpKey('test-sparse-hydrate'),
      JSON.stringify({ v: 3, data: { form: { email: 'sparse-seed@x.com' } } })
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

  it('dev warns when register({ persist: true }) is used on a form with no persist: configured', async () => {
    // Symmetric to the "persist configured but no opt-ins" warning:
    // user opted into persistence at the register() call site but
    // forgot the `persist:` option on useForm(). Without this warning,
    // the opt-in records silently and nothing ever lands in storage.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const App = defineComponent({
        setup() {
          const api = useForm({ schema, key: 'opt-in-without-persist-config' })
          // No persist option on useForm() — but the binding asks for it.
          return () =>
            h(
              'div',
              withDirectives(h('input', { type: 'text' }), [
                [vRegister, api.register('email', { persist: true })],
              ])
            )
        },
      })
      const app = createApp(App).use(createChemicalXForms())
      const root = document.createElement('div')
      document.body.appendChild(root)
      app.mount(root)
      apps.push(app)
      await drain()
      const warnCalls = warnSpy.mock.calls.map((args) => args.join(' '))
      const matched = warnCalls.find((msg) =>
        /register\('email', \{ persist: true \}\).*no `persist:` option is configured/.test(msg)
      )
      expect(matched).toBeDefined()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('does NOT fire the symmetric warning when persist: IS configured', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // mountForm wires `persist: { storage: 'local', ... }` AND opts in
      // both fields — so neither warning should fire.
      const { app } = mountForm({
        storage: 'local',
        key: 'test-no-symmetric-warn',
        debounceMs: 20,
      })
      apps.push(app)
      await drain()
      const warnCalls = warnSpy.mock.calls.map((args) => args.join(' '))
      const matched = warnCalls.find((msg) => /no `persist:` option is configured/.test(msg))
      expect(matched).toBeUndefined()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('warns once per form even when multiple paths opt in', async () => {
    // Dedupe: a template with N opted-in paths should produce ONE warning,
    // not N. Keyed by FormStore.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const App = defineComponent({
        setup() {
          const api = useForm({ schema, key: 'opt-in-dedupe' })
          return () =>
            h('div', [
              withDirectives(h('input', { type: 'text' }), [
                [vRegister, api.register('email', { persist: true })],
              ]),
              withDirectives(h('input', { type: 'text' }), [
                [
                  vRegister,
                  api.register('password', { persist: true, acknowledgeSensitive: true }),
                ],
              ]),
            ])
        },
      })
      const app = createApp(App).use(createChemicalXForms())
      const root = document.createElement('div')
      document.body.appendChild(root)
      app.mount(root)
      apps.push(app)
      await drain()
      const matchCount = warnSpy.mock.calls
        .map((args) => args.join(' '))
        .filter((msg) => /no `persist:` option is configured/.test(msg)).length
      expect(matchCount).toBe(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('form.resetField(path) wipes only the matching subpath from storage', async () => {
    // Seed both fields, mount with both opted in, then resetField just
    // 'email'. Storage should drop email but keep password.
    localStorage.setItem(
      fpKey('test-reset-field'),
      JSON.stringify({ v: 3, data: { form: { email: 'seed@x.com', password: 'seed-pw' } } })
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
      const raw = localStorage.getItem(fpKey('test-reset-field'))
      if (raw === null) return null
      const parsed = JSON.parse(raw) as { data: { form: Record<string, unknown> } }
      return parsed.data.form['email'] === undefined ? true : null
    })
    const final = JSON.parse(localStorage.getItem(fpKey('test-reset-field')) as string) as {
      data: { form: Record<string, string> }
    }
    expect(final.data.form['email']).toBeUndefined()
    expect(final.data.form['password']).toBe('seed-pw')
  })
})

/**
 * Shorthand input forms — `persist: 'local'` and
 * `persist: customAdapter` skip the options-bag wrapper for the common
 * "just pick a backend" case. Internally these normalise to
 * `{ storage: ... }` with library defaults; everything downstream
 * operates on the resolved shape.
 */
describe('persistence — shorthand config', () => {
  const apps: App[] = []
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
    sessionStorage.clear()
  })

  it("persist: 'local' (string shorthand) writes to localStorage with default key", async () => {
    // The default key is `chemical-x-forms:${formKey}` — mountForm
    // generates a unique formKey, so the resolved storage key is unique
    // per test and we read back via the same scheme.
    const handle: { api?: ApiReturn; el?: HTMLInputElement } = {}
    const formKey = `shorthand-${Math.random().toString(36).slice(2)}`
    const App = defineComponent({
      setup() {
        const api = useForm({ schema, key: formKey, persist: 'local' })
        handle.api = api
        return () =>
          h(
            'div',
            withDirectives(
              h('input', {
                type: 'text',
                ref: (el): void => {
                  if (el !== null) handle.el = el as HTMLInputElement
                },
              }),
              [[vRegister, api.register('email', { persist: true })]]
            )
          )
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)

    const el = handle.el as HTMLInputElement
    el.value = 'shorthand@example.com'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    // Default debounceMs is 300 — allow 600 ms for the timer + adapter chain.
    const expectedKey = `chemical-x-forms:${formKey}:${FP}`
    const raw = await waitUntil(() => localStorage.getItem(expectedKey), 1000)
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { v: number; data: { form: { email: string } } }
    expect(payload.v).toBe(3)
    expect(payload.data.form.email).toBe('shorthand@example.com')
  })

  it('persist: customAdapter (object shorthand) routes writes to the adapter', async () => {
    // A custom FormStorage with no `storage` key — disambiguator picks
    // it up as a custom adapter, NOT as a malformed options bag.
    const writes: Array<[string, unknown]> = []
    const customAdapter = {
      getItem: (): Promise<unknown> => Promise.resolve(undefined),
      setItem: (key: string, value: unknown): Promise<void> => {
        writes.push([key, value])
        return Promise.resolve()
      },
      removeItem: (): Promise<void> => Promise.resolve(),
      listKeys: (): Promise<string[]> => Promise.resolve([]),
    }
    const handle: { el?: HTMLInputElement } = {}
    const formKey = `custom-${Math.random().toString(36).slice(2)}`
    const App = defineComponent({
      setup() {
        const api = useForm({ schema, key: formKey, persist: customAdapter })
        return () =>
          h(
            'div',
            withDirectives(
              h('input', {
                type: 'text',
                ref: (el): void => {
                  if (el !== null) handle.el = el as HTMLInputElement
                },
              }),
              [[vRegister, api.register('email', { persist: true })]]
            )
          )
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    const el = handle.el as HTMLInputElement
    el.value = 'custom@example.com'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await waitUntil(() => (writes.length > 0 ? true : null), 1000)
    expect(writes.length).toBeGreaterThan(0)
    const [writtenKey, writtenValue] = writes[writes.length - 1]!
    expect(writtenKey).toBe(`chemical-x-forms:${formKey}:${FP}`)
    const payload = writtenValue as { data: { form: { email: string } } }
    expect(payload.data.form.email).toBe('custom@example.com')
  })
})

/**
 * Cross-store cleanup at mount: the configured backend is the source of
 * truth. Stale entries in non-configured standard backends (under the
 * same resolved key) get a fire-and-forget `removeItem` so a migration
 * from `'local'` → `'session'` (or `'local'` → encrypted custom store)
 * can't orphan PII / sensitive data in the abandoned backend.
 *
 * Custom adapters can't be enumerated, so a custom→custom migration is
 * on the consumer; configuring a custom adapter sweeps all three
 * standard backends.
 */
describe('persistence — cross-store cleanup at mount', () => {
  const apps: App[] = []
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
    sessionStorage.clear()
    __resetIndexedDbForTests()
  })

  function mountMinimal(persist: Parameters<typeof useForm<typeof schema>>[0]['persist']): App {
    const App = defineComponent({
      setup() {
        useForm({
          schema,
          key: `cleanup-${Math.random().toString(36).slice(2)}`,
          ...(persist ? { persist } : {}),
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    return app
  }

  it("configured 'local' wipes orphan entries from sessionStorage (legacy + stale-fingerprint)", async () => {
    const key = 'cleanup-shared-key'
    // Legacy pre-fingerprint key in non-configured store.
    sessionStorage.setItem(key, JSON.stringify({ stale: 'data' }))
    // Current-fingerprint key in configured store stays (cleanup only
    // touches non-current-fingerprint orphans).
    localStorage.setItem(fpKey(key), JSON.stringify({ v: 3, data: { form: { email: 'keep' } } }))
    expect(sessionStorage.getItem(key)).not.toBeNull()
    mountMinimal({ storage: 'local', key })
    // Cleanup is fire-and-forget; poll for the session entry to vanish.
    await waitUntil(() => (sessionStorage.getItem(key) === null ? true : null), 500)
    expect(sessionStorage.getItem(key)).toBeNull()
    // The configured backend's CURRENT entry must NOT be touched.
    expect(localStorage.getItem(fpKey(key))).not.toBeNull()
  })

  it("configured 'session' wipes orphan entries from localStorage", async () => {
    const key = 'cleanup-shared-key-2'
    localStorage.setItem(key, JSON.stringify({ stale: 'data' }))
    sessionStorage.setItem(fpKey(key), JSON.stringify({ v: 3, data: { form: { email: 'keep' } } }))
    mountMinimal({ storage: 'session', key })
    await waitUntil(() => (localStorage.getItem(key) === null ? true : null), 500)
    expect(localStorage.getItem(key)).toBeNull()
    expect(sessionStorage.getItem(fpKey(key))).not.toBeNull()
  })

  it('configured custom adapter wipes orphans from both localStorage and sessionStorage', async () => {
    // Custom adapters can't be reached by enumeration, so the cleanup
    // sweeps ALL three standard backends — the dev might have migrated
    // away from any of them.
    const key = 'cleanup-custom'
    localStorage.setItem(key, JSON.stringify({ stale: 'local' }))
    sessionStorage.setItem(key, JSON.stringify({ stale: 'session' }))
    const customAdapter = {
      getItem: (): Promise<unknown> => Promise.resolve(undefined),
      setItem: (): Promise<void> => Promise.resolve(),
      removeItem: (): Promise<void> => Promise.resolve(),
      listKeys: (): Promise<string[]> => Promise.resolve([]),
    }
    mountMinimal({ storage: customAdapter, key })
    await waitUntil(
      () =>
        localStorage.getItem(key) === null && sessionStorage.getItem(key) === null ? true : null,
      500
    )
    expect(localStorage.getItem(key)).toBeNull()
    expect(sessionStorage.getItem(key)).toBeNull()
  })

  it("shorthand persist: 'local' runs the same cleanup", async () => {
    // The shorthand is normalised to { storage: 'local' } before the
    // sweep — same code path, same behaviour.
    const formKey = `shorthand-cleanup-${Math.random().toString(36).slice(2)}`
    const expectedStorageKey = `chemical-x-forms:${formKey}`
    sessionStorage.setItem(expectedStorageKey, JSON.stringify({ stale: 'session' }))
    const App = defineComponent({
      setup() {
        useForm({ schema, key: formKey, persist: 'local' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    await waitUntil(() => (sessionStorage.getItem(expectedStorageKey) === null ? true : null), 500)
    expect(sessionStorage.getItem(expectedStorageKey)).toBeNull()
  })

  it('preserves entries under a DIFFERENT key in non-configured backends', async () => {
    // Cleanup sweeps the configured key only — entries that another
    // form (or another concern entirely) wrote to the same backend
    // under a different key must survive.
    const ourKey = 'cleanup-our-key'
    const otherKey = 'someone-elses-key'
    sessionStorage.setItem(ourKey, JSON.stringify({ stale: true }))
    sessionStorage.setItem(otherKey, JSON.stringify({ unrelated: true }))
    mountMinimal({ storage: 'local', key: ourKey })
    await waitUntil(() => (sessionStorage.getItem(ourKey) === null ? true : null), 500)
    expect(sessionStorage.getItem(ourKey)).toBeNull()
    // The unrelated session entry stays.
    expect(sessionStorage.getItem(otherKey)).not.toBeNull()
  })

  it('removing persist: from useForm() entirely wipes the previously-persisted entry', async () => {
    // The "I disabled persistence in this deployment" scenario.
    //
    // Deployment N had `useForm({ key: 'signup', persist: 'local' })` and
    // wrote an entry under `chemical-x-forms:signup`. Deployment N+1
    // removed the `persist:` option entirely (compliance pivot,
    // simplification, whatever) but kept the same form `key`. On next
    // mount, the orphaned entry from deployment N must be wiped from
    // every standard backend — leaving sensitive draft data lingering
    // because "we removed persistence" would silently betray the dev's
    // intent.
    //
    // This test simulates that gap directly: pre-seed a stale entry,
    // mount with NO persist option, expect the entry gone.
    const formKey = 'persist-removed'
    const expectedStorageKey = `chemical-x-forms:${formKey}`
    localStorage.setItem(
      expectedStorageKey,
      JSON.stringify({ v: 3, data: { form: { email: 'old@x.com' } } })
    )
    sessionStorage.setItem(
      expectedStorageKey,
      JSON.stringify({ v: 3, data: { form: { email: 'older@x.com' } } })
    )
    expect(localStorage.getItem(expectedStorageKey)).not.toBeNull()
    expect(sessionStorage.getItem(expectedStorageKey)).not.toBeNull()

    // Mount WITHOUT persist option — same form key as the deployment
    // that wrote the entry.
    const App = defineComponent({
      setup() {
        useForm({ schema, key: formKey })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)

    await waitUntil(
      () =>
        localStorage.getItem(expectedStorageKey) === null &&
        sessionStorage.getItem(expectedStorageKey) === null
          ? true
          : null,
      500
    )
    expect(localStorage.getItem(expectedStorageKey)).toBeNull()
    expect(sessionStorage.getItem(expectedStorageKey)).toBeNull()
  })
})

/**
 * Fingerprint-keyed storage key + active orphan cleanup. Schema content
 * changes produce a different fingerprint, so the new mount looks up a
 * fresh storage key — old drafts become orphans, cleaned up by the
 * same mount via `listKeys + removeItem`. Replaces the old manual
 * `version: number` invalidation protocol.
 */
describe('persistence — fingerprint-keyed storage + orphan cleanup', () => {
  const apps: App[] = []
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('storage key includes the schema fingerprint suffix', async () => {
    const { app, type } = mountForm({ storage: 'local', key: 'fp-write', debounceMs: 20 })
    apps.push(app)
    await drain()
    type('email', 'fp@example.com')
    const expected = fpKey('fp-write')
    const raw = await waitUntil(() => localStorage.getItem(expected))
    expect(raw).not.toBeNull()
  })

  it('schema-A → schema-B: fingerprint differs → no rehydration', async () => {
    const stalePayload = JSON.stringify({
      v: 3,
      data: { form: { email: 'stale@x.com', password: 'stale' } },
    })
    localStorage.setItem('fp-mismatch:OLD-FINGERPRINT', stalePayload)
    const { app, api } = mountForm({ storage: 'local', key: 'fp-mismatch', debounceMs: 20 })
    apps.push(app)
    await drain()
    expect(api.getValue('email').value).toBe('')
  })

  it('orphan cleanup: stale-fingerprint entries wiped on mount of the same form', async () => {
    const stalePayload = JSON.stringify({
      v: 3,
      data: { form: { email: 'stale@x.com', password: 'stale' } },
    })
    localStorage.setItem('fp-orphan:OLD-FP-1', stalePayload)
    localStorage.setItem('fp-orphan:OLD-FP-2', stalePayload)
    localStorage.setItem(
      fpKey('fp-orphan'),
      JSON.stringify({ v: 3, data: { form: { email: 'live@x.com', password: 'live' } } })
    )
    const { app, api } = mountForm({ storage: 'local', key: 'fp-orphan', debounceMs: 20 })
    apps.push(app)
    await waitUntil(() => (api.getValue('email').value === 'live@x.com' ? true : null))
    await waitUntil(() =>
      localStorage.getItem('fp-orphan:OLD-FP-1') === null &&
      localStorage.getItem('fp-orphan:OLD-FP-2') === null
        ? true
        : null
    )
    expect(localStorage.getItem('fp-orphan:OLD-FP-1')).toBeNull()
    expect(localStorage.getItem('fp-orphan:OLD-FP-2')).toBeNull()
    expect(localStorage.getItem(fpKey('fp-orphan'))).not.toBeNull()
  })

  it('orphan cleanup: pre-fingerprint legacy keys (no `:` suffix) are wiped', async () => {
    localStorage.setItem(
      'fp-legacy',
      JSON.stringify({ v: 3, data: { form: { email: 'legacy@x.com', password: 'pw' } } })
    )
    const { app } = mountForm({ storage: 'local', key: 'fp-legacy', debounceMs: 20 })
    apps.push(app)
    await waitUntil(() => (localStorage.getItem('fp-legacy') === null ? true : null))
    expect(localStorage.getItem('fp-legacy')).toBeNull()
  })

  it('orphan cleanup uses exact-or-`:`-prefix match (no sibling-form collision)', async () => {
    localStorage.setItem(
      fpKey('my-form-2'),
      JSON.stringify({ v: 3, data: { form: { email: 'sibling@x.com', password: 'pw' } } })
    )
    const { app } = mountForm({ storage: 'local', key: 'my-form', debounceMs: 20 })
    apps.push(app)
    await drain()
    expect(localStorage.getItem(fpKey('my-form-2'))).not.toBeNull()
  })
})

/**
 * `FormStorage.listKeys(prefix)` per-backend smoke tests. Each adapter
 * must enumerate keys whose name starts with the given prefix; the
 * orphan-cleanup pass relies on this contract.
 */
describe('FormStorage.listKeys — per-backend', () => {
  it('localStorage adapter returns matching keys', async () => {
    const { createLocalStorageAdapter } =
      await import('../../src/runtime/core/persistence/local-storage')
    const adapter = createLocalStorageAdapter()
    localStorage.clear()
    localStorage.setItem('cx-test:a', 'va')
    localStorage.setItem('cx-test:b:fp', 'vb')
    localStorage.setItem('other:x', 'vx')
    const keys = await adapter.listKeys('cx-test:')
    expect(keys.sort()).toEqual(['cx-test:a', 'cx-test:b:fp'])
    localStorage.clear()
  })

  it('sessionStorage adapter returns matching keys', async () => {
    const { createSessionStorageAdapter } =
      await import('../../src/runtime/core/persistence/session-storage')
    const adapter = createSessionStorageAdapter()
    sessionStorage.clear()
    sessionStorage.setItem('s-test:a', 'va')
    sessionStorage.setItem('s-test:b:fp', 'vb')
    sessionStorage.setItem('other:x', 'vx')
    const keys = await adapter.listKeys('s-test:')
    expect(keys.sort()).toEqual(['s-test:a', 's-test:b:fp'])
    sessionStorage.clear()
  })

  it('IndexedDB adapter returns matching keys', async () => {
    __resetIndexedDbForTests()
    const { createIndexedDbAdapter } = await import('../../src/runtime/core/persistence/indexeddb')
    const adapter = createIndexedDbAdapter()
    await adapter.setItem('idb-test:a', { v: 3, data: { form: { x: 1 } } })
    await adapter.setItem('idb-test:b:fp', { v: 3, data: { form: { x: 2 } } })
    await adapter.setItem('other:x', { v: 3, data: { form: {} } })
    const keys = await adapter.listKeys('idb-test:')
    expect(keys.sort()).toEqual(['idb-test:a', 'idb-test:b:fp'])
    __resetIndexedDbForTests()
  })
})

describe('persistence — dispose race (B1)', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('drains the last debounced keystroke when the component unmounts mid-debounce', async () => {
    const { app, type } = mountForm({
      storage: 'local',
      key: 'test-drain',
      debounceMs: 200, // long enough that unmount races the timer
    })
    apps.push(app)
    await drain()
    // Type a value, then immediately unmount — well before the debounce
    // window expires. Pre-fix, dispose() set `disposed=true` BEFORE
    // calling writer.flush(), so the closure bailed at its first guard
    // and the value was silently lost.
    type('email', 'race-condition@example.com')
    apps.pop()?.unmount()
    // The eviction path drains pending writes asynchronously. Poll
    // until the storage entry materialises (or fail the timeout).
    const raw = await waitUntil(() => localStorage.getItem(fpKey('test-drain')), 1000)
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as { data: { form: { email?: string } } }
    expect(payload.data.form.email).toBe('race-condition@example.com')
  })

  it('exposes registry.shutdown() that drains every form before resolving', async () => {
    // Two forms with overlapping pending debounced writes. shutdown()
    // should resolve only after both writes have landed in storage.
    const { app: app1, type: type1 } = mountForm({
      storage: 'local',
      key: 'test-shutdown-a',
      debounceMs: 100,
    })
    const { app: app2, type: type2 } = mountForm({
      storage: 'local',
      key: 'test-shutdown-b',
      debounceMs: 100,
    })
    apps.push(app1, app2)
    await drain()
    type1('email', 'one@example.com')
    type2('email', 'two@example.com')
    // Use the registry from app1 (any of them works — both share the
    // create-app pattern but have separate registries; we drain each
    // by calling its registry's shutdown).
    const registry1 = app1._chemicalX
    const registry2 = app2._chemicalX
    expect(registry1).toBeDefined()
    expect(registry2).toBeDefined()
    await Promise.all([registry1?.shutdown(), registry2?.shutdown()])
    // After the shutdown promise settles, both writes are in storage.
    const a = localStorage.getItem(fpKey('test-shutdown-a'))
    const b = localStorage.getItem(fpKey('test-shutdown-b'))
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
  })
})
