// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { useForm } from '../../src/zod'
import { z } from 'zod'
import { parseApiErrors } from '../../src/runtime/core/parse-api-errors'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * `form.errors` is a leaf-aware drillable callable Proxy. At leaf paths
 * it terminates with `ValidationError[] | undefined`; at container
 * paths it descends without exposing leaf-keys. The "give me every
 * error" need is served by `form.meta.errors` (flat array).
 *
 *   <template>
 *     {{ form.errors.email?.[0]?.message }}        ✅ leaf access
 *     {{ form.errors('email')?.[0]?.message }}     ✅ callable form
 *     {{ form.errors['nested.path'] }}             ❌ NOT supported (single-bracket dotted)
 *     {{ form.errors.nested.path }}                ✅ chained access
 *     {{ form.errors.value.email }}                ❌ no `.value` — proxy unwraps automatically
 *   </template>
 */

const schema = z.object({
  email: z.string().email('bad email'),
  password: z.string().min(8, 'min 8 chars'),
})

type Api = ReturnType<typeof useForm<typeof schema>>

function mount(): { app: App; api: Api } {
  const handle: { api?: Api } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({ schema, key: 'fielderrs-view', validationMode: 'lax' })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as Api }
}

describe('form.errors — leaf-aware drillable proxy', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('reads errors via direct dot-access at a leaf path', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])

    expect(api.errors.email?.[0]?.message).toBe('bad email')
  })

  it('returns undefined at a leaf with no errors', () => {
    const { app, api } = mount()
    apps.push(app)

    expect(api.errors.email).toBeUndefined()
  })

  it('reflects updates after setFieldErrors / clearFieldErrors', () => {
    const { app, api } = mount()
    apps.push(app)

    expect(api.errors.email).toBeUndefined()

    api.setFieldErrors([
      { path: ['email'], message: 'taken', formKey: api.key, code: 'api:validation' },
    ])
    expect(api.errors.email?.[0]?.message).toBe('taken')

    api.clearFieldErrors('email')
    expect(api.errors.email).toBeUndefined()
  })

  it('container paths materialise the underlying error tree (not opaque {})', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])

    // Model shape: the root container emits a nested map keyed by leaf path.
    const root = JSON.parse(JSON.stringify(api.errors))
    expect(root).toMatchObject({
      email: [{ message: 'bad email', path: ['email'] }],
    })
    // Sanity: the same data also surfaces flat through `form.meta.errors`.
    expect(api.meta.errors).toHaveLength(1)
    expect(api.meta.errors[0]?.message).toBe('bad email')
  })
})

describe('form.errors — callable form', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('callable with a dotted-string path returns the same as dot-access', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])

    const dotted = api.errors.email
    const called = (api.errors as unknown as (p: string) => unknown)('email')
    expect(called).toEqual(dotted)
  })

  it('callable with no arg returns the root proxy', () => {
    const { app, api } = mount()
    apps.push(app)

    const root = (api.errors as unknown as () => unknown)()
    // Root proxy is itself drillable and JSON-stringifies to {}.
    expect(JSON.parse(JSON.stringify(root))).toEqual({})
  })

  it('callable with an array path resolves the same as dotted-string', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])

    const fromArray = (api.errors as unknown as (p: readonly string[]) => unknown)(['email'])
    const fromDotted = (api.errors as unknown as (p: string) => unknown)('email')
    expect(fromArray).toEqual(fromDotted)
  })
})

describe('form.errors — readonly contract', () => {
  const apps: App[] = []

  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('rejects direct property assignment at a leaf', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])

    // Strict mode (ESM): the `set` trap returning false throws TypeError.
    expect(() => {
      // @ts-expect-error — runtime proves the trap matches the type promise.
      api.errors.email = []
    }).toThrow(TypeError)

    // Underlying entry survives.
    expect(api.errors.email?.[0]?.message).toBe('bad email')
  })

  it('rejects delete at a leaf', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])

    expect(() => {
      // @ts-expect-error — runtime proves the trap matches the type promise.
      delete api.errors.email
    }).toThrow(TypeError)

    expect(api.errors.email?.[0]?.message).toBe('bad email')
  })
})

describe('form.errors — reactivity in render scope', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a component reading form.errors.email re-renders when the entry changes', async () => {
    let api!: Api
    let renderedMessage = ''
    const Reader = defineComponent({
      setup() {
        api = useForm({ schema, key: 'fielderrs-reactive', validationMode: 'lax' })
        return () => {
          renderedMessage = api.errors.email?.[0]?.message ?? ''
          return h('div', renderedMessage)
        }
      },
    })
    const app = createApp(Reader).use(createChemicalXForms({ override: true }))
    apps.push(app)
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(renderedMessage).toBe('')

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])
    await nextTick()
    expect(renderedMessage).toBe('bad email')

    api.clearFieldErrors('email')
    await nextTick()
    expect(renderedMessage).toBe('')
  })

  // End-to-end coverage for the spike's "Simulate API 400" flow:
  // parseApiErrors → setFieldErrors → form.errors.<path> read. Pre-fix
  // the bare-string Rails / DRF / Laravel shape (`{ field: ["msg"] }`)
  // returned `result.ok === false`, the `if (result.ok) ...` guard
  // skipped, and the form rendered no error messages even though the
  // API response carried valid information. Now both shapes flow
  // through end-to-end.
  it('parseApiErrors → setFieldErrors → form.errors renders the messages (Rails-style payload)', () => {
    const { app, api } = mount()
    apps.push(app)

    const result = parseApiErrors(
      {
        email: ['Email is reserved.'],
        password: ['Profanity filter rejected this.'],
      },
      { formKey: api.key }
    )
    expect(result.ok).toBe(true)
    if (result.ok) api.setFieldErrors(result.errors)

    expect(api.errors.email?.[0]?.message).toBe('Email is reserved.')
    expect(api.errors.email?.[0]?.code).toBe('api:unknown')
    expect(api.errors.password?.[0]?.message).toBe('Profanity filter rejected this.')
  })

  it('parseApiErrors honors a custom defaultCode end-to-end', () => {
    const { app, api } = mount()
    apps.push(app)

    const result = parseApiErrors(
      { email: 'taken' },
      { formKey: api.key, defaultCode: 'api:server-validation' }
    )
    expect(result.ok).toBe(true)
    if (result.ok) api.setFieldErrors(result.errors)

    expect(api.errors.email?.[0]?.code).toBe('api:server-validation')
  })

  it('getter-form `watch` fires on entry changes', async () => {
    const { app, api } = mount()
    apps.push(app)

    const observed: (string | undefined)[] = []
    const stop = vi.fn()
    const { watch } = await import('vue')
    const watcher = watch(
      () => api.errors.email?.[0]?.message,
      (next) => {
        observed.push(next)
      }
    )

    api.setFieldErrors([
      { path: ['email'], message: 'first', formKey: api.key, code: 'api:validation' },
    ])
    await nextTick()

    api.setFieldErrors([
      { path: ['email'], message: 'second', formKey: api.key, code: 'api:validation' },
    ])
    await nextTick()

    api.clearFieldErrors('email')
    await nextTick()

    watcher()
    stop()

    expect(observed).toEqual(['first', 'second', undefined])
  })
})
