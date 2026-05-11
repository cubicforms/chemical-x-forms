// @vitest-environment jsdom
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'

/**
 * Pins the public surface of `useForm()`'s return value against
 * accidental drift. Two failure modes this guards against:
 *
 *   1. A property silently moves between `api`, `api.meta`, and
 *      `api.history` — types vs. runtime drift.
 *   2. A method is introduced/removed/renamed without the surface
 *      contract being updated.
 *
 * The architecture:
 *
 *   ┌─ Lives directly on `api` ───────────────────────────────┐
 *   │  setValue, handleSubmit, validateAsync, process, reset, │
 *   │  resetField, register, fields, errors, values, key,     │
 *   │  meta, history, …                                       │
 *   └─────────────────────────────────────────────────────────┘
 *
 *   ┌─ Lives on `api.meta` ───────────────────────────────────┐
 *   │  dirty, valid, submitting, submitCount, submitError,    │
 *   │  showErrors, firstError, …                              │
 *   └─────────────────────────────────────────────────────────┘
 *
 *   ┌─ Lives on `api.history` ────────────────────────────────┐
 *   │  undo(), redo(), clear(), canUndo, canRedo, size        │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Form-level actions and field accessors sit at the top level;
 * form-level status flags sit on `meta`; undo/redo lives entirely
 * on `history`.
 *
 * Absence checks use type-level assertions (`@ts-expect-error`) rather
 * than runtime `=== undefined`, because the FieldState proxy returns a
 * stub callable for unknown property reads (a separate bug — see
 * round-2 chaos probe). The compile-time check is the canonical surface
 * contract; the runtime check is subordinate.
 */

const schema = z.object({
  name: z.string(),
  email: z.string().email(),
})

type Api = UseFormReturnType<z.output<typeof schema>>

function mountForm(): { app: App; api: Api } {
  const handle: { api?: Api } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: `surface-contract-${Math.random().toString(36).slice(2)}`,
        history: true,
        defaultValues: { name: '', email: '' },
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  app.mount(document.createElement('div'))
  return { app, api: handle.api as Api }
}

describe('API surface contract — actions on `api`, status on `api.meta`, history on `api.history`', () => {
  it('undo/redo + flags live on `api.history` — both methods and reactive flags', () => {
    const { api } = mountForm()

    // Runtime — methods are functions, flags are unwrapped primitives
    // (the `readonly(reactive({...}))` bundle auto-unwraps ComputedRef
    // fields on access).
    expect(typeof api.history.undo).toBe('function')
    expect(typeof api.history.redo).toBe('function')
    expect(typeof api.history.clear).toBe('function')
    expect(typeof api.history.canUndo).toBe('boolean')
    expect(typeof api.history.canRedo).toBe('boolean')
    expect(typeof api.history.size).toBe('number')

    // Type-level pin — same shape.
    expectTypeOf(api.history.undo).toEqualTypeOf<() => boolean>()
    expectTypeOf(api.history.redo).toEqualTypeOf<() => boolean>()
    expectTypeOf(api.history.clear).toEqualTypeOf<() => void>()
    expectTypeOf(api.history.canUndo).toEqualTypeOf<boolean>()
    expectTypeOf(api.history.canRedo).toEqualTypeOf<boolean>()
    expectTypeOf(api.history.size).toEqualTypeOf<number>()
  })

  it('history surface does NOT leak onto `api` or `api.meta` (consolidation is exclusive)', () => {
    const { api } = mountForm()

    // The pre-consolidation addresses must not resurrect. If a future
    // change accidentally restores them (e.g. by re-adding `undo` to
    // `UseFormReturnType`), the @ts-expect-error stops being needed and
    // the `Unused @ts-expect-error directive` lint trips, forcing the
    // contract update.
    // @ts-expect-error api.undo lives at api.history.undo now
    void api.undo
    // @ts-expect-error api.redo lives at api.history.redo now
    void api.redo
    // @ts-expect-error api.canUndo lives at api.history.canUndo now
    void api.canUndo
    // @ts-expect-error api.canRedo lives at api.history.canRedo now
    void api.canRedo
    // @ts-expect-error api.historySize lives at api.history.size now
    void api.historySize
    // @ts-expect-error api.meta.canUndo lives at api.history.canUndo now
    void api.meta.canUndo
    // @ts-expect-error api.meta.canRedo lives at api.history.canRedo now
    void api.meta.canRedo
    // @ts-expect-error api.meta.historySize lives at api.history.size now
    void api.meta.historySize
  })

  it('mutating actions live directly on `api`', () => {
    const { api } = mountForm()

    expect(typeof api.setValue).toBe('function')
    expect(typeof api.reset).toBe('function')
    expect(typeof api.resetField).toBe('function')
    expect(typeof api.handleSubmit).toBe('function')
    expect(typeof api.validateAsync).toBe('function')
    expect(typeof api.process).toBe('function')
  })

  it('form-level reactive flags live on `api.meta` (not `api`)', () => {
    const { api } = mountForm()

    // Status flags — the canonical `meta` surface.
    expect(typeof api.meta.dirty).toBe('boolean')
    expect(typeof api.meta.valid).toBe('boolean')
    expect(typeof api.meta.submitting).toBe('boolean')
    expect(typeof api.meta.submitCount).toBe('number')

    // showErrors / firstError landed in PR #186.
    expect(typeof api.meta.showErrors).toBe('boolean')
    expect(['undefined', 'object']).toContain(typeof api.meta.firstError)

    // Type-level absence at the top level.
    // @ts-expect-error api.dirty must NOT exist; use api.meta.dirty
    void api.dirty
    // @ts-expect-error api.valid must NOT exist; use api.meta.valid
    void api.valid
    // @ts-expect-error api.submitting must NOT exist; use api.meta.submitting
    void api.submitting
    // @ts-expect-error api.submitCount must NOT exist; use api.meta.submitCount
    void api.submitCount
  })

  it('field accessors live directly on `api`', () => {
    const { api } = mountForm()

    // `api.fields` is a callable proxy — supports both
    // `api.fields.email` (property access) and a function-form
    // signature. typeof returns 'function' for callable proxies.
    expect(typeof api.fields === 'function' || typeof api.fields === 'object').toBe(true)
    expect(typeof api.errors).toBe('function')
    expect(typeof api.values === 'function' || typeof api.values === 'object').toBe(true)
    expect(typeof api.register).toBe('function')
    expect(typeof api.key).toBe('string')

    // Property access works as advertised. FieldState entries are
    // also callable proxies (lift signature), so typeof returns
    // 'function' rather than 'object' even for leaf fields.
    expect(typeof api.fields.email === 'function' || typeof api.fields.email === 'object').toBe(
      true
    )
    expect(typeof api.values.email).toBe('string')
  })

  it('per-field state surfaces status directly on the FieldState', () => {
    const { api } = mountForm()
    const emailField = api.fields.email

    expect(typeof emailField.dirty).toBe('boolean')
    expect(typeof emailField.valid).toBe('boolean')
    expect(typeof emailField.touched === 'boolean' || emailField.touched === null).toBe(true)
    expect(typeof emailField.showErrors).toBe('boolean')

    expectTypeOf(emailField.dirty).toEqualTypeOf<boolean>()
    expectTypeOf(emailField.valid).toEqualTypeOf<boolean>()
    expectTypeOf(emailField.showErrors).toEqualTypeOf<boolean>()
  })

  it('per-field history does NOT exist today (pinned for the consolidation question)', () => {
    const { api } = mountForm()
    const emailField = api.fields.email

    // Type-level absence — future per-field history (e.g.
    // `api.fields.email.history.{undo, redo, canUndo}`) breaks these
    // @ts-expect-error directives intentionally.
    // @ts-expect-error per-field history is not part of the contract today
    void emailField.history
    // @ts-expect-error per-field undo is not part of the contract today
    void emailField.undo
    // @ts-expect-error per-field redo is not part of the contract today
    void emailField.redo

    // Note: runtime `emailField.undo` returns `[Function undefined]`
    // because the FieldState proxy stubs unknown property reads as
    // callables (separate bug — see round-2 chaos probe). The
    // type-level absence above is the canonical contract; runtime
    // probing here would fail-positive.
  })
})

/**
 * FUTURE-COMMITMENT MARKERS — fail LOUDLY in CI until implemented.
 *
 * Plain `it()` (NOT `it.fails()`): a silently-green `it.fails()` lets
 * the signal dissipate; a CI red is a constant nag every time the
 * suite runs. Each marker stays red until the feature lands, at which
 * point the assertions pass and CI goes green by virtue of the work
 * being done.
 *
 * Asserts SHAPE / minimal-behavior only, not full semantics. The full
 * semantics live in the implementing PR's tests; this file's job is
 * to keep the commitment visible.
 */

/**
 * Multi-tab sync via BroadcastChannel.
 *
 * The user-impact concern (the B19 footgun): a user with N open tabs
 * of the same keyed form submits on one tab while the others quietly
 * hold stale state. Subsequent edits on a stale tab race against /
 * overwrite the just-submitted truth — invisible data loss.
 *
 * Resolution: same-keyed `useForm` callsites in same-origin tabs
 * auto-pair over a `BroadcastChannel` derived from `key + schema
 * fingerprint`. Every local mutation broadcasts `Patch[]`; receivers
 * apply via `applyPatchesForward` with `crossTab: true` meta.
 *
 * Tests below pin the surface and the load-bearing security gates.
 * See `docs/recipes/multi-tab-sync.md` for the full design + threat
 * model.
 */
describe('multi-tab sync — BroadcastChannel', () => {
  /**
   * Helper: wait for the form's multi-tab sync module to transition
   * out of the joining-flow lifecycle (`'joining'` → `'established'`).
   * Without this, external `postMessage` sent before the join
   * collection window elapses races against the module's
   * lifecycle-gated handlers and gets silently dropped.
   */
  async function waitForSyncEstablished(app: App, formKey: string): Promise<void> {
    const { MULTI_TAB_SYNC_MODULE_KEY } = await import('../../src/runtime/core/multi-tab-sync')
    const { waitUntil } = await import('../utils/form-harness')
    const reg = (
      app as unknown as {
        _attaform: { forms: Map<string, { modules: Map<string, { lifecycle: () => string }> }> }
      }
    )._attaform
    const state = reg.forms.get(formKey)
    const syncMod = state?.modules.get(MULTI_TAB_SYNC_MODULE_KEY)
    if (syncMod === undefined) return
    await waitUntil(() => (syncMod.lifecycle() === 'established' ? true : null), 500)
  }

  it('live convergence: a local mutation propagates to a sibling tab via the channel', async () => {
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { waitUntil } = await import('../utils/form-harness')

    const formKey = `b19-live-${Math.random().toString(36).slice(2)}`
    const channelName = `attaform:sync:${formKey}:${hashStableString(fingerprintZodSchema(schema))}`

    // Mount Tab A (acts as the "established" peer).
    const handleA: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handleA.api = useForm({ schema, key: formKey, defaultValues: { name: '', email: '' } })
        return () => h('div')
      },
    })
    const appA = createApp(App).use(createAttaform())
    appA.mount(document.createElement('div'))
    const apiA = handleA.api as Api
    await waitForSyncEstablished(appA, formKey)

    // Simulate Tab B's outbound patches via a raw external channel —
    // this models "a sibling tab made a write." Tab A should converge.
    const externalChannel = new BroadcastChannel(channelName)
    externalChannel.postMessage({
      v: 1,
      kind: 'patches',
      senderId: 'external-tab-B',
      formPatches: [{ kind: 'changed', path: ['name'], oldValue: '', newValue: 'from-tab-B' }],
      blankPathsAdded: [],
      blankPathsRemoved: [],
    })

    const converged = await waitUntil(() => (apiA.values.name === 'from-tab-B' ? true : null), 500)
    expect(converged).toBe(true)
    expect(apiA.values.name).toBe('from-tab-B')

    externalChannel.close()
    appA.unmount()
  })

  it('echo drop: own outbound messages do NOT mutate own state on receive', async () => {
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { wait } = await import('../utils/form-harness')

    const formKey = `b19-echo-${Math.random().toString(36).slice(2)}`
    const channelName = `attaform:sync:${formKey}:${hashStableString(fingerprintZodSchema(schema))}`

    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: formKey, defaultValues: { name: '', email: '' } })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    const api = handle.api as Api
    await waitForSyncEstablished(app, formKey)

    // Read the sync module's own senderId, then fabricate a message
    // claiming to come from it. The echo-drop guard rejects.
    const { MULTI_TAB_SYNC_MODULE_KEY } = await import('../../src/runtime/core/multi-tab-sync')
    const reg = (
      app as unknown as {
        _attaform: { forms: Map<string, { modules: Map<string, { senderId: string }> }> }
      }
    )._attaform
    const state = reg.forms.get(formKey)
    expect(state).toBeDefined()
    const syncMod = state!.modules.get(MULTI_TAB_SYNC_MODULE_KEY)
    expect(syncMod).toBeDefined()
    const ownSenderId = syncMod!.senderId
    expect(typeof ownSenderId).toBe('string')
    expect(ownSenderId.length).toBeGreaterThan(0)

    const external = new BroadcastChannel(channelName)
    external.postMessage({
      v: 1,
      kind: 'patches',
      senderId: ownSenderId,
      formPatches: [{ kind: 'changed', path: ['name'], oldValue: '', newValue: 'echo-injected' }],
      blankPathsAdded: [],
      blankPathsRemoved: [],
    })
    await wait(100)
    expect(api.values.name).toBe('')

    external.close()
    app.unmount()
  })

  it('protocol-version drop: messages with unknown `v` are ignored', async () => {
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { wait } = await import('../utils/form-harness')

    const formKey = `b19-vdrop-${Math.random().toString(36).slice(2)}`
    const channelName = `attaform:sync:${formKey}:${hashStableString(fingerprintZodSchema(schema))}`

    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: formKey, defaultValues: { name: '', email: '' } })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    const api = handle.api as Api
    await waitForSyncEstablished(app, formKey)

    const external = new BroadcastChannel(channelName)
    external.postMessage({
      v: 999,
      kind: 'patches',
      senderId: 'future-tab',
      formPatches: [{ kind: 'changed', path: ['name'], oldValue: '', newValue: 'from-future' }],
      blankPathsAdded: [],
      blankPathsRemoved: [],
    })
    await wait(100)
    expect(api.values.name).toBe('')

    external.close()
    app.unmount()
  })

  it('inbound sensitive-path REJECTION — hostile sibling cannot inject a `password` write', async () => {
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { wait } = await import('../utils/form-harness')
    const { z: zod } = await import('zod')

    const secretSchema = zod.object({
      name: zod.string(),
      password: zod.string(),
    })
    type SecretApi = UseFormReturnType<z.output<typeof secretSchema>>

    const formKey = `b19-sensitive-${Math.random().toString(36).slice(2)}`
    const channelName = `attaform:sync:${formKey}:${hashStableString(fingerprintZodSchema(secretSchema))}`

    const handle: { api?: SecretApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: secretSchema,
          key: formKey,
          defaultValues: { name: '', password: '' },
        }) as SecretApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    const api = handle.api as SecretApi
    await waitForSyncEstablished(app, formKey)

    // Hostile-source scenario: fabricate a patches message that writes
    // a value to the `password` path. The receiving tab's inbound
    // sensitive-path filter rejects it — even though the wire format
    // is otherwise valid.
    const external = new BroadcastChannel(channelName)
    external.postMessage({
      v: 1,
      kind: 'patches',
      senderId: 'hostile-tab',
      formPatches: [
        { kind: 'changed', path: ['password'], oldValue: '', newValue: 'p4ssw0rd-pwned' },
        { kind: 'changed', path: ['name'], oldValue: '', newValue: 'name-ok' },
      ],
      blankPathsAdded: [],
      blankPathsRemoved: [],
    })
    await wait(100)
    // `password` was filtered; `name` (non-sensitive) was applied.
    expect(api.values.password).toBe('')
    expect(api.values.name).toBe('name-ok')

    external.close()
    app.unmount()
  })

  it('inbound prototype-pollution defense — patch with `__proto__` segment rejected', async () => {
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { wait } = await import('../utils/form-harness')

    const formKey = `b19-proto-${Math.random().toString(36).slice(2)}`
    const channelName = `attaform:sync:${formKey}:${hashStableString(fingerprintZodSchema(schema))}`

    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: formKey, defaultValues: { name: '', email: '' } })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    await waitForSyncEstablished(app, formKey)

    const external = new BroadcastChannel(channelName)
    external.postMessage({
      v: 1,
      kind: 'patches',
      senderId: 'hostile-tab',
      formPatches: [{ kind: 'added', path: ['__proto__', 'polluted'], newValue: 'yes' }],
      blankPathsAdded: [],
      blankPathsRemoved: [],
    })
    await wait(100)
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined()

    external.close()
    app.unmount()
  })

  it('form-level `multiTab: false` — module never instantiates; hand-crafted broadcast cannot mutate', async () => {
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { MULTI_TAB_SYNC_MODULE_KEY } = await import('../../src/runtime/core/multi-tab-sync')
    const { wait } = await import('../utils/form-harness')

    const formKey = `b19-form-off-${Math.random().toString(36).slice(2)}`
    const channelName = `attaform:sync:${formKey}:${hashStableString(fingerprintZodSchema(schema))}`

    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: formKey,
          multiTab: false,
          defaultValues: { name: '', email: '' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    const api = handle.api as Api

    const reg = (
      app as unknown as { _attaform: { forms: Map<string, { modules: Map<string, unknown> }> } }
    )._attaform
    const state = reg.forms.get(formKey)
    expect(state).toBeDefined()
    expect(state!.modules.has(MULTI_TAB_SYNC_MODULE_KEY)).toBe(false)

    const external = new BroadcastChannel(channelName)
    external.postMessage({
      v: 1,
      kind: 'patches',
      senderId: 'external-tab',
      formPatches: [{ kind: 'changed', path: ['name'], oldValue: '', newValue: 'no-sync' }],
      blankPathsAdded: [],
      blankPathsRemoved: [],
    })
    await wait(100)
    expect(api.values.name).toBe('')

    external.close()
    app.unmount()
  })

  it('secure-context gate — sync noop when `window.isSecureContext === false`', async () => {
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { MULTI_TAB_SYNC_MODULE_KEY } = await import('../../src/runtime/core/multi-tab-sync')
    const { wait } = await import('../utils/form-harness')

    const formKey = `b19-insecure-${Math.random().toString(36).slice(2)}`
    const channelName = `attaform:sync:${formKey}:${hashStableString(fingerprintZodSchema(schema))}`

    const prior = window.isSecureContext
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    try {
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: formKey,
            multiTab: true,
            defaultValues: { name: '', email: '' },
          })
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      const api = handle.api as Api

      const reg = (
        app as unknown as { _attaform: { forms: Map<string, { modules: Map<string, unknown> }> } }
      )._attaform
      const state = reg.forms.get(formKey)
      expect(state).toBeDefined()
      expect(state!.modules.has(MULTI_TAB_SYNC_MODULE_KEY)).toBe(false)

      const external = new BroadcastChannel(channelName)
      external.postMessage({
        v: 1,
        kind: 'patches',
        senderId: 'external-tab',
        formPatches: [
          { kind: 'changed', path: ['name'], oldValue: '', newValue: 'should-not-apply' },
        ],
        blankPathsAdded: [],
        blankPathsRemoved: [],
      })
      await wait(100)
      expect(api.values.name).toBe('')

      external.close()
      app.unmount()
    } finally {
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: prior })
    }
  })

  it('per-register `multiTab: false` (inbound) — opted-out path rejects incoming patches', async () => {
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { vRegister } = await import('../../src/runtime/core/directive')
    const { MULTI_TAB_SYNC_MODULE_KEY } = await import('../../src/runtime/core/multi-tab-sync')
    const { withDirectives } = await import('vue')
    const { wait, waitUntil } = await import('../utils/form-harness')

    const formKey = `b19-reg-off-${Math.random().toString(36).slice(2)}`
    const channelName = `attaform:sync:${formKey}:${hashStableString(fingerprintZodSchema(schema))}`

    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        const api = useForm({ schema, key: formKey, defaultValues: { name: '', email: '' } })
        handle.api = api
        return () =>
          h('div', [
            withDirectives(h('input', { 'data-field': 'name' }), [
              [vRegister, api.register('name', { multiTab: false })],
            ]),
            withDirectives(h('input', { 'data-field': 'email' }), [
              [vRegister, api.register('email')],
            ]),
          ])
      },
    })
    const app = createApp(App).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    const api = handle.api as Api

    // Wait for the sync module's join window to elapse (solo-tab → established).
    const reg = (
      app as unknown as {
        _attaform: { forms: Map<string, { modules: Map<string, { lifecycle: () => string }> }> }
      }
    )._attaform
    const syncMod = reg.forms.get(formKey)!.modules.get(MULTI_TAB_SYNC_MODULE_KEY)!
    await waitUntil(() => (syncMod.lifecycle() === 'established' ? true : null), 500)

    const external = new BroadcastChannel(channelName)
    external.postMessage({
      v: 1,
      kind: 'patches',
      senderId: 'external-tab',
      formPatches: [
        { kind: 'changed', path: ['name'], oldValue: '', newValue: 'should-NOT-sync' },
        { kind: 'changed', path: ['email'], oldValue: '', newValue: 'a@b.co' },
      ],
      blankPathsAdded: [],
      blankPathsRemoved: [],
    })
    await wait(50)
    // `name` was opted out of sync via the register call → rejected.
    expect(api.values.name).toBe('')
    // `email` rode the form-level default (multiTab on) → applied.
    expect(api.values.email).toBe('a@b.co')

    external.close()
    app.unmount()
    document.body.removeChild(root)
  })

  it('persistence skip on crossTab meta — sibling-driven writes do NOT re-persist locally', async () => {
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { vRegister } = await import('../../src/runtime/core/directive')
    const { withDirectives, nextTick } = await import('vue')
    const { wait, waitUntil } = await import('../utils/form-harness')

    const formKey = `b19-persist-skip-${Math.random().toString(36).slice(2)}`
    const channelName = `attaform:sync:${formKey}:${hashStableString(fingerprintZodSchema(schema))}`
    const persistKey = `attaform:${formKey}:${hashStableString(fingerprintZodSchema(schema))}`

    localStorage.removeItem(persistKey)

    const handle: { api?: Api; el?: HTMLInputElement } = {}
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 5 },
          defaultValues: { name: '', email: '' },
        })
        handle.api = api
        return () =>
          h(
            'div',
            withDirectives(
              h('input', {
                ref: (el: unknown): void => {
                  if (el !== null) handle.el = el as HTMLInputElement
                },
              }),
              [[vRegister, api.register('name', { persist: true })]]
            )
          )
      },
    })
    const app = createApp(App).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    const api = handle.api as Api

    await waitForSyncEstablished(app, formKey)

    // Type locally first to ensure persistence is live + the writer fires.
    const el = handle.el as HTMLInputElement
    el.value = 'local-typed'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await waitUntil(() => (localStorage.getItem(persistKey) !== null ? true : null))
    expect(api.values.name).toBe('local-typed')

    // Wipe storage to a sentinel, then push a sibling-driven write.
    const sentinel = JSON.stringify({ v: 4, data: { form: { name: 'sentinel' } } })
    localStorage.setItem(persistKey, sentinel)

    const external = new BroadcastChannel(channelName)
    external.postMessage({
      v: 1,
      kind: 'patches',
      senderId: 'external-tab',
      formPatches: [
        { kind: 'changed', path: ['name'], oldValue: 'local-typed', newValue: 'from-tab-B' },
      ],
      blankPathsAdded: [],
      blankPathsRemoved: [],
    })
    await waitUntil(() => (api.values.name === 'from-tab-B' ? true : null), 500)

    // Persistence listener skipped on crossTab apply — the sentinel
    // we set above is untouched.
    await wait(100)
    expect(localStorage.getItem(persistKey)).toBe(sentinel)

    external.close()
    app.unmount()
    document.body.removeChild(root)
    localStorage.removeItem(persistKey)
  })

  it('DEFAULT_SENSITIVE_NAMES — exported and frozen', async () => {
    const { DEFAULT_SENSITIVE_NAMES } = await import('../../src/index')
    expect(Array.isArray(DEFAULT_SENSITIVE_NAMES)).toBe(true)
    expect(DEFAULT_SENSITIVE_NAMES.length).toBeGreaterThan(20)
    expect(Object.isFrozen(DEFAULT_SENSITIVE_NAMES)).toBe(true)
    // Type-level pin — readonly array of string.
    expectTypeOf(DEFAULT_SENSITIVE_NAMES).toEqualTypeOf<readonly string[]>()
  })

  it('custom `sensitiveNames` (global) — gates outbound + inbound multi-tab broadcasts', async () => {
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { DEFAULT_SENSITIVE_NAMES } = await import('../../src/index')
    const { wait } = await import('../utils/form-harness')
    const { z: zod } = await import('zod')

    const medSchema = zod.object({ name: zod.string(), mrn: zod.string() })
    type MedApi = UseFormReturnType<z.output<typeof medSchema>>

    const formKey = `b19-custom-sn-${Math.random().toString(36).slice(2)}`
    const channelName = `attaform:sync:${formKey}:${hashStableString(fingerprintZodSchema(medSchema))}`

    const handle: { api?: MedApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: medSchema,
          key: formKey,
          defaultValues: { name: '', mrn: '' },
        }) as MedApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(
      createAttaform({
        defaults: { sensitiveNames: [...DEFAULT_SENSITIVE_NAMES, 'mrn'] },
      })
    )
    app.mount(document.createElement('div'))
    const api = handle.api as MedApi
    await waitForSyncEstablished(app, formKey)

    const external = new BroadcastChannel(channelName)
    external.postMessage({
      v: 1,
      kind: 'patches',
      senderId: 'external-tab',
      formPatches: [
        { kind: 'changed', path: ['mrn'], oldValue: '', newValue: 'P-12345' },
        { kind: 'changed', path: ['name'], oldValue: '', newValue: 'Alice' },
      ],
      blankPathsAdded: [],
      blankPathsRemoved: [],
    })
    await wait(100)
    // Custom global sensitiveNames added `'mrn'` → filtered. `name`
    // passes through.
    expect(api.values.mrn).toBe('')
    expect(api.values.name).toBe('Alice')

    external.close()
    app.unmount()
  })
})
