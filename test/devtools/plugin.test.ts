// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { setupAttaformDevtools } from '../../src/runtime/core/devtools'
import { createAttaform } from '../../src/runtime/core/plugin'
import { createRegistry, attachRegistryToApp } from '../../src/runtime/core/registry'
import { useForm } from '../../src/zod'

/**
 * Phase 5.10 — Vue DevTools plugin contract tests.
 *
 * We mock `@vue/devtools-api`'s `setupDevtoolsPlugin` via vi.mock so
 * the setup callback fires synchronously against a spied-upon
 * DevTools API surface. The tests then:
 *  - assert addInspector / addTimelineLayer are registered,
 *  - feed synthetic getInspectorTree / getInspectorState events and
 *    verify the payload is filled with the registered forms,
 *  - verify timeline events fire on submit / reset.
 */

type CapturedEvent = {
  layerId: string
  event: {
    time: number
    title: string
    subtitle?: string
    data?: Record<string, unknown>
  }
}

type MockDevtoolsApi = {
  addInspector: ReturnType<typeof vi.fn>
  addTimelineLayer: ReturnType<typeof vi.fn>
  addTimelineEvent: ReturnType<typeof vi.fn>
  sendInspectorTree: ReturnType<typeof vi.fn>
  sendInspectorState: ReturnType<typeof vi.fn>
  _events: CapturedEvent[]
  _handlers: {
    getInspectorTree:
      | ((p: {
          inspectorId: string
          filter: string
          rootNodes: Array<{ id: string; label: string }>
        }) => void)
      | null
    getInspectorState:
      | ((p: {
          inspectorId: string
          nodeId: string
          state: Record<string, Array<{ key: string; value: unknown; editable?: boolean }>>
        }) => void)
      | null
    editInspectorState:
      | ((p: {
          inspectorId: string
          nodeId: string
          path: string[]
          state: { value: unknown }
        }) => void)
      | null
  }
  on: {
    getInspectorTree: (h: MockDevtoolsApi['_handlers']['getInspectorTree']) => void
    getInspectorState: (h: MockDevtoolsApi['_handlers']['getInspectorState']) => void
    editInspectorState: (h: MockDevtoolsApi['_handlers']['editInspectorState']) => void
  }
}

function createMockApi(): MockDevtoolsApi {
  const mock: MockDevtoolsApi = {
    addInspector: vi.fn(),
    addTimelineLayer: vi.fn(),
    addTimelineEvent: vi.fn((payload: CapturedEvent) => {
      mock._events.push(payload)
    }),
    sendInspectorTree: vi.fn(),
    sendInspectorState: vi.fn(),
    _events: [],
    _handlers: {
      getInspectorTree: null,
      getInspectorState: null,
      editInspectorState: null,
    },
    on: {
      getInspectorTree: (h) => {
        mock._handlers.getInspectorTree = h
      },
      getInspectorState: (h) => {
        mock._handlers.getInspectorState = h
      },
      editInspectorState: (h) => {
        mock._handlers.editInspectorState = h
      },
    },
  }
  return mock
}

// Shared holder the mock writes to before each test.
const currentMock: { api: MockDevtoolsApi | null } = { api: null }

vi.mock('@vue/devtools-api', () => ({
  setupDevtoolsPlugin: (
    _descriptor: { id: string; label: string; app: App },
    setup: (api: unknown) => void
  ) => {
    if (currentMock.api !== null) setup(currentMock.api)
  },
}))

describe('DevTools plugin — inspector + timeline wiring', () => {
  const apps: App[] = []

  beforeEach(() => {
    currentMock.api = createMockApi()
  })

  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    currentMock.api = null
  })

  it('registers inspector + timeline layer on setup', async () => {
    const app = createApp(defineComponent({ setup: () => () => h('div') }))
    const registry = createRegistry({})
    attachRegistryToApp(app, registry)
    const ok = await setupAttaformDevtools(app, registry)
    expect(ok).toBe(true)
    expect(currentMock.api!.addInspector).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'attaform' })
    )
    expect(currentMock.api!.addTimelineLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'attaform:events' })
    )
  })

  it('exposes registered forms as root nodes in the inspector tree', async () => {
    // Bare app — no plugin install — so we can attach a registry we
    // fully control without double-provide warnings.
    const regApp = createApp(defineComponent({ setup: () => () => h('div') }))
    const registry = createRegistry({})
    attachRegistryToApp(regApp, registry)
    // Seed a form into the bare registry by hand (simulates useForm).
    const { createFormStore } = await import('../../src/runtime/core/create-form-store')
    const { fakeSchema } = await import('../utils/fake-schema')
    const state = createFormStore<{ email: string }>({
      formKey: 'dev-tree',
      schema: fakeSchema<{ email: string }>({ email: '' }),
    })
    registry.forms.set('dev-tree', state)

    await setupAttaformDevtools(regApp, registry)

    const payload = {
      inspectorId: 'attaform',
      filter: '',
      rootNodes: [] as Array<{ id: string; label: string }>,
    }
    currentMock.api!._handlers.getInspectorTree!(payload)
    expect(payload.rootNodes).toContainEqual(
      expect.objectContaining({ id: 'form:dev-tree', label: 'dev-tree' })
    )
  })

  it('emits a timeline event on submit success', async () => {
    const handle: { api?: ReturnType<typeof useForm<z.ZodObject<{ email: z.ZodString }>>> } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: z.object({ email: z.string() }),
          key: 'dev-timeline',
          // Explicit defaults opt out of construction-time auto-mark so
          // handleSubmit can succeed without a synthesized "Required" error.
          defaultValues: { email: '' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform({ devtools: false }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)

    // Register the devtools against the app's own registry.
    const { getRegistryFromApp } = await import('../../src/runtime/core/registry')
    const registry = getRegistryFromApp(app)
    await setupAttaformDevtools(app, registry)
    // Drain microtasks so the devtools subscriber has subscribed.
    await Promise.resolve()
    await Promise.resolve()

    const handler = handle.api!.handleSubmit(async () => {})
    await handler()
    await Promise.resolve()
    await Promise.resolve()

    const submitEvents = currentMock.api!._events.filter((e) => e.event.title === 'submit.success')
    // Single handleSubmit() invocation ⇒ exactly one submit.success
    // event. Pre-fix `> 0` would mask a duplicate-emit regression.
    expect(submitEvents).toHaveLength(1)
    expect(submitEvents[0]?.event.subtitle).toBe('dev-timeline')
  })
})

describe('DevTools plugin — sensitive-name redaction (B5)', () => {
  const apps: App[] = []

  beforeEach(() => {
    currentMock.api = createMockApi()
  })

  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    currentMock.api = null
  })

  it("redacts sensitive leaves in the inspector's Form value panel", async () => {
    const regApp = createApp(defineComponent({ setup: () => () => h('div') }))
    const registry = createRegistry({})
    attachRegistryToApp(regApp, registry)
    const { createFormStore } = await import('../../src/runtime/core/create-form-store')
    const { fakeSchema } = await import('../utils/fake-schema')
    const state = createFormStore<{ email: string; password: string; profile: { name: string } }>({
      formKey: 'redact-form',
      schema: fakeSchema({ email: '', password: '', profile: { name: '' } }),
    })
    state.applyFormReplacement({
      email: 'alice@example.com',
      password: 'super-secret',
      profile: { name: 'Alice' },
    })
    registry.forms.set('redact-form', state)

    await setupAttaformDevtools(regApp, registry)

    const payload = {
      inspectorId: 'attaform',
      nodeId: 'form:redact-form',
      state: {} as Record<string, Array<{ key: string; value: unknown; editable?: boolean }>>,
    }
    currentMock.api!._handlers.getInspectorState!(payload)
    const formEntry = payload.state['Form value']?.[0]
    expect(formEntry).toBeDefined()
    const value = formEntry?.value as {
      email: string
      password: string
      profile: { name: string }
    }
    expect(value.email).toBe('alice@example.com') // not sensitive
    expect(value.password).toBe('[redacted]') // sensitive — masked
    expect(value.profile.name).toBe('Alice') // nested but not sensitive
  })

  it('redacts sensitive leaves in form.change timeline events', async () => {
    const handle: {
      api?: ReturnType<typeof useForm<z.ZodObject<{ email: z.ZodString; password: z.ZodString }>>>
    } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: z.object({ email: z.string(), password: z.string() }),
          key: 'redact-timeline',
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform({ devtools: false }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)

    const { getRegistryFromApp } = await import('../../src/runtime/core/registry')
    const registry = getRegistryFromApp(app)
    await setupAttaformDevtools(app, registry)
    await Promise.resolve()

    handle.api!.setValue('password', 'super-secret')
    await Promise.resolve()

    const changes = currentMock.api!._events.filter((e) => e.event.title === 'form.change')
    // Single setValue() ⇒ exactly one form.change event. Tightened
    // from `> 0` so a duplicate-emit regression no longer hides.
    expect(changes).toHaveLength(1)
    const last = changes[changes.length - 1]!
    const form = last.event.data?.['form'] as { password?: unknown; email?: unknown }
    expect(form.password).toBe('[redacted]')
    expect(form.email).toBe('') // schema default; not sensitive
  })

  it('refuses sensitive-path edits via the inspector', async () => {
    const regApp = createApp(defineComponent({ setup: () => () => h('div') }))
    const registry = createRegistry({})
    attachRegistryToApp(regApp, registry)
    const { createFormStore } = await import('../../src/runtime/core/create-form-store')
    const { fakeSchema } = await import('../utils/fake-schema')
    const state = createFormStore<{ password: string }>({
      formKey: 'edit-block',
      schema: fakeSchema<{ password: string }>({ password: '' }),
    })
    state.applyFormReplacement({ password: 'original' })
    registry.forms.set('edit-block', state)

    await setupAttaformDevtools(regApp, registry)

    currentMock.api!._handlers.editInspectorState!({
      inspectorId: 'attaform',
      nodeId: 'form:edit-block',
      // path = ['Form value', 'form', 'password']
      path: ['Form value', 'form', 'password'],
      state: { value: '[redacted]' }, // simulating "user confirmed redacted view"
    })
    // The original value must NOT be overwritten by the redacted literal.
    expect(state.form.value.password).toBe('original')
  })
})
