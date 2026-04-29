// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { useForm } from '../../src/zod'
import { z } from 'zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * `fieldErrors` is a Proxy that wraps a ComputedRef. The wrapper
 * exists to fix a longstanding template footgun:
 *
 *   <template>
 *     {{ form.fieldErrors.email }}        ✅ works (this file proves it)
 *     {{ form.fieldErrors.value.email }}  ❌ no longer compiles, no .value
 *   </template>
 *
 * Vue auto-unwraps refs when they are TOP-LEVEL setup-return bindings.
 * Refs nested inside an API object (like `useForm()`'s return) do NOT
 * auto-unwrap, so the previous `Readonly<ComputedRef<…>>` shape forced
 * authors to write `.value` in templates — surprising, since every
 * other "looks reactive in the template" thing they touch in Vue is
 * auto-unwrapped.
 *
 * The Proxy delegates property access to the underlying ComputedRef so
 * Vue's reactivity tracking still fires (template re-renders on error
 * changes, watch effects re-run). The readonly contract is preserved
 * via `set` / `deleteProperty` traps that reject writes at runtime.
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
      // Pin lax: this file tests the fieldErrors Proxy view, not the
      // construction-time strict-mode seed. Lax keeps the form mount-
      // clean so each test can assert the user-error round-trip
      // without the schema seed pre-populating entries.
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

describe('fieldErrors — template-friendly Proxy view', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('reads errors via direct dot-access (no .value)', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])

    // The whole point of this change: dot-access returns the array directly.
    expect(api.fieldErrors.email?.[0]?.message).toBe('bad email')
  })

  it('reflects updates after setFieldErrors / clearFieldErrors', () => {
    const { app, api } = mount()
    apps.push(app)

    expect(api.fieldErrors.email).toBeUndefined()

    api.setFieldErrors([
      { path: ['email'], message: 'taken', formKey: api.key, code: 'api:validation' },
    ])
    expect(api.fieldErrors.email?.[0]?.message).toBe('taken')

    api.clearFieldErrors('email')
    expect(api.fieldErrors.email).toBeUndefined()
  })

  it('exposes only the keys present in the underlying record', () => {
    const { app, api } = mount()
    apps.push(app)

    expect(Object.keys(api.fieldErrors)).toEqual([])

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
      { path: ['password'], message: 'min 8', formKey: api.key, code: 'api:validation' },
    ])

    // Object.keys traverses the Proxy's ownKeys + getOwnPropertyDescriptor
    // traps; the result must match the underlying record exactly.
    expect(new Set(Object.keys(api.fieldErrors))).toEqual(new Set(['email', 'password']))
  })

  it('JSON.stringify produces the same shape as the underlying record', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])

    const serialised = JSON.parse(JSON.stringify(api.fieldErrors))
    expect(serialised).toEqual({
      email: [{ path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' }],
    })
  })

  it('`in` operator delegates to the underlying record', () => {
    const { app, api } = mount()
    apps.push(app)

    expect('email' in api.fieldErrors).toBe(false)

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])
    expect('email' in api.fieldErrors).toBe(true)
    expect('password' in api.fieldErrors).toBe(false)
  })
})

describe('fieldErrors — readonly contract', () => {
  const apps: App[] = []
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    warnSpy.mockRestore()
  })

  it('rejects direct property assignment + warns in dev', () => {
    const { app, api } = mount()
    apps.push(app)

    // The Proxy's `set` trap returns false. In sloppy mode the assignment
    // is silently ignored; in strict mode (where ESM lives by default,
    // including Vitest test files), the trap throws TypeError.
    expect(() => {
      // @ts-expect-error — fieldErrors is Readonly at the type level;
      // we're proving the runtime trap matches the type promise.
      api.fieldErrors.email = [
        { path: ['email'], message: 'mutated directly', formKey: api.key, code: 'api:validation' },
      ]
    }).toThrow(TypeError)

    // Underlying record must remain empty.
    expect(api.fieldErrors.email).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('rejects delete + warns in dev', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: api.key, code: 'api:validation' },
    ])

    expect(() => {
      // @ts-expect-error — see above.
      delete api.fieldErrors.email
    }).toThrow(TypeError)

    // Entry survives the rejected delete.
    expect(api.fieldErrors.email?.[0]?.message).toBe('bad email')
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('fieldErrors — reactivity in render scope', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a component reading fieldErrors.email re-renders when the entry changes', async () => {
    let api!: Api
    let renderedMessage = ''
    const Reader = defineComponent({
      setup() {
        api = useForm({ schema, key: 'fielderrs-reactive', validationMode: 'lax' })
        return () => {
          renderedMessage = api.fieldErrors.email?.[0]?.message ?? ''
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

  it('getter-form `watch` fires on entry changes', async () => {
    const { app, api } = mount()
    apps.push(app)

    const observed: (string | undefined)[] = []
    const stop = vi.fn()
    const { watch } = await import('vue')
    const watcher = watch(
      () => api.fieldErrors.email?.[0]?.message,
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

    // First (undefined → 'first'), second ('first' → 'second'), third ('second' → undefined).
    expect(observed).toEqual(['first', 'second', undefined])
  })
})
