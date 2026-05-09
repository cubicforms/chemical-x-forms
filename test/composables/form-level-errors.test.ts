// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { useForm } from '../../src/zod'
import { z } from 'zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { ValidationError } from '../../src/runtime/types/types-api'

/**
 * `form.setFormErrors` / `form.clearFormErrors` write and clear the
 * form-level errors — entries at the empty-string path `['']`,
 * stored in the `'[""]'` PathKey bucket — without disturbing any
 * field-level error. Form-level errors surface in `form.meta.errors`
 * and in `form.errors('')`; they're excluded from the path-keyed
 * `form.errors` drill proxy because no nested-object key represents
 * the empty-string path.
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
      handle.api = useForm({ schema, key: 'form-level-errors', strict: false })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as Api }
}

const formLevel = (errors: readonly ValidationError[]): readonly ValidationError[] =>
  errors.filter((e) => e.path.length === 1 && e.path[0] === '')

describe('form.setFormErrors / clearFormErrors', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writes a single form-level error with the default code', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFormErrors([{ message: 'Capacity exceeded' }])

    const entries = formLevel(api.meta.errors)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      message: 'Capacity exceeded',
      path: [''],
      formKey: api.key,
      code: 'atta:form-error',
    })
  })

  it('writes multiple form-level errors in order', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFormErrors([{ message: 'a' }, { message: 'b' }, { message: 'c' }])

    const entries = formLevel(api.meta.errors)
    expect(entries.map((e) => e.message)).toEqual(['a', 'b', 'c'])
    for (const e of entries) expect(e.path).toEqual([''])
  })

  it('replaces (does not append) on each call', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFormErrors([{ message: 'first' }])
    api.setFormErrors([{ message: 'second' }])

    const entries = formLevel(api.meta.errors)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.message).toBe('second')
  })

  it('does not disturb pre-existing field errors', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'taken', formKey: api.key, code: 'api:duplicate' },
    ])
    api.setFormErrors([{ message: 'Capacity exceeded' }])

    expect(api.errors.email?.[0]?.message).toBe('taken')
    expect(formLevel(api.meta.errors)).toHaveLength(1)
    expect(formLevel(api.meta.errors)[0]?.message).toBe('Capacity exceeded')
    // Two total: one field, one form-level.
    expect(api.meta.errors).toHaveLength(2)
  })

  it('setFormErrors([]) clears form-level errors only', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'taken', formKey: api.key, code: 'api:duplicate' },
    ])
    api.setFormErrors([{ message: 'Capacity exceeded' }])

    api.setFormErrors([])

    expect(formLevel(api.meta.errors)).toHaveLength(0)
    // Field error survives.
    expect(api.errors.email?.[0]?.message).toBe('taken')
  })

  it('clearFormErrors() is equivalent to setFormErrors([])', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFieldErrors([
      { path: ['email'], message: 'taken', formKey: api.key, code: 'api:duplicate' },
    ])
    api.setFormErrors([{ message: 'one' }, { message: 'two' }])

    api.clearFormErrors()

    expect(formLevel(api.meta.errors)).toHaveLength(0)
    expect(api.errors.email?.[0]?.message).toBe('taken')
  })

  it('per-entry code override propagates onto the ValidationError', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFormErrors([
      { message: 'a', code: 'capacity:exceeded' },
      { message: 'b' }, // default code
    ])

    const entries = formLevel(api.meta.errors)
    expect(entries[0]?.code).toBe('capacity:exceeded')
    expect(entries[1]?.code).toBe('atta:form-error')
  })

  it('form-level errors are excluded from form.errors proxy', () => {
    const { app, api } = mount()
    apps.push(app)

    api.setFormErrors([{ message: 'Capacity exceeded' }])

    // No key represents `[]` in the nested error tree — the proxy
    // intentionally skips form-level errors. They live on
    // `meta.errors` only.
    const tree = JSON.parse(JSON.stringify(api.errors))
    expect(tree).toEqual({})
    expect(api.meta.errors).toHaveLength(1)
  })

  it('accepts full ValidationError[] (e.g. from parseApiErrors)', () => {
    const { app, api } = mount()
    apps.push(app)

    // Caller-provided path / formKey are ignored — `setFormErrors`
    // forces the form-level path (['']) and the owning formKey, so
    // `parseApiErrors` output pipes in without mapping.
    api.setFormErrors([
      {
        path: ['ignored', 'on', 'purpose'],
        formKey: 'wrong-key',
        message: 'Capacity exceeded',
        code: 'api:capacity',
      },
    ])

    const entries = formLevel(api.meta.errors)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      message: 'Capacity exceeded',
      path: [''],
      formKey: api.key,
      code: 'api:capacity',
    })
  })
})
