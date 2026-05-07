// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, type App } from 'vue'
import { useForm } from '../../src/zod'
import { z } from 'zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `form.errorsAt(path)` returns every error whose path IS the given
 * path OR descends from it. Aggregates schema + blank + user errors
 * in the same order as `meta.errors`.
 */

const schema = z.object({
  reference: z.string().min(1, 'reference required'),
  cargo: z.object({
    items: z.array(
      z.object({
        sku: z.string().min(1, 'sku required'),
        qty: z.number().int().min(1, 'qty min 1'),
      })
    ),
  }),
  service: z.object({
    airline: z.string().min(2, 'airline min 2'),
  }),
})

type Api = ReturnType<typeof useForm<typeof schema>>

function mount(): { app: App; api: Api } {
  const handle: { api?: Api } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: 'errors-at',
        strict: false,
        defaultValues: {
          reference: 'SHP-1',
          cargo: { items: [{ sku: 'A', qty: 1 }] },
          service: { airline: 'XX' },
        },
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as Api }
}

describe('form.errorsAt', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  function seedAllErrors(api: Api): void {
    api.setFieldErrors([
      {
        path: ['cargo'],
        message: 'cargo invalid',
        formKey: api.key,
        code: 'api:cargo',
      },
      {
        path: ['cargo', 'items'],
        message: 'items invalid',
        formKey: api.key,
        code: 'api:items',
      },
      {
        path: ['cargo', 'items', 0, 'sku'],
        message: 'sku bad',
        formKey: api.key,
        code: 'api:sku',
      },
      {
        path: ['service', 'airline'],
        message: 'airline bad',
        formKey: api.key,
        code: 'api:airline',
      },
    ])
    api.setFormErrors([{ message: 'capacity full' }])
  }

  it('returns errors at the prefix and every descendant', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    const cargo = api.errorsAt('cargo')
    expect(cargo.map((e) => e.message).sort()).toEqual(
      ['cargo invalid', 'items invalid', 'sku bad'].sort()
    )
    // No service or form-level errors leak in.
    for (const e of cargo) {
      expect(e.path[0]).toBe('cargo')
    }
  })

  it('narrows further as the prefix deepens', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    const items = api.errorsAt('cargo.items')
    expect(items.map((e) => e.message).sort()).toEqual(['items invalid', 'sku bad'].sort())

    const itemZero = api.errorsAt('cargo.items.0')
    expect(itemZero.map((e) => e.message)).toEqual(['sku bad'])
  })

  it('accepts segment-array form equivalent to dotted-string', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    const dotted = api.errorsAt('cargo.items.0').map((e) => e.message)
    const segments = api.errorsAt(['cargo', 'items', 0]).map((e) => e.message)
    expect(segments).toEqual(dotted)
  })

  it('root prefix matches every error including form-level', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    const allDotted = api
      .errorsAt('')
      .map((e) => e.message)
      .sort()
    const allSegments = api
      .errorsAt([])
      .map((e) => e.message)
      .sort()
    expect(allDotted).toEqual(allSegments)
    expect(allDotted).toEqual(
      ['airline bad', 'capacity full', 'cargo invalid', 'items invalid', 'sku bad'].sort()
    )
  })

  it('returns empty array for a path with no matching errors', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    expect(api.errorsAt('reference')).toEqual([])
  })

  it('preserves the meta.errors ordering at every prefix', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    const metaCargoOrder = api.meta.errors
      .filter((e) => e.path[0] === 'cargo')
      .map((e) => e.message)
    expect(api.errorsAt('cargo').map((e) => e.message)).toEqual(metaCargoOrder)
  })

  it('reactively updates inside a computed wrapping the call', async () => {
    const { app, api } = mount()
    apps.push(app)

    const stepInvalid = computed(() => api.errorsAt('cargo').length > 0)

    expect(stepInvalid.value).toBe(false)

    api.setFieldErrors([
      {
        path: ['cargo', 'items', 0, 'sku'],
        message: 'sku bad',
        formKey: api.key,
        code: 'api:sku',
      },
    ])
    await nextTick()
    expect(stepInvalid.value).toBe(true)

    api.clearFieldErrors('cargo.items.0.sku')
    await nextTick()
    expect(stepInvalid.value).toBe(false)
  })
})
