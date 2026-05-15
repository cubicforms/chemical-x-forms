// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, type App } from 'vue'
import { useForm } from '../../src/zod'
import type { UseFormReturn } from '../../src/zod'
import { z } from 'zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `form.errors(path)` (call-form) returns every error whose path IS
 * the given path OR descends from it. Aggregates schema + blank +
 * user errors in the same order as `meta.errors`. The three
 * surfaces — `form.errors(path)`, `form.fields(path).errors`, and
 * `form.meta.errors` — share one aggregation helper, so reads at
 * any prefix never disagree.
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

type Api = UseFormReturn<typeof schema>
type ErrorsCallForm = (path?: string | readonly (string | number)[]) =>
  | readonly {
      message: string
      path: readonly (string | number)[]
    }[]
  | undefined

function callErrors(api: Api): ErrorsCallForm {
  return api.errors as unknown as ErrorsCallForm
}

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
  const app = createApp(App).use(createAttaform())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as Api }
}

describe('form.errors(path) — aggregation at any depth', () => {
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

    const cargo = callErrors(api)('cargo') ?? []
    expect(cargo.map((e) => e.message).sort()).toEqual(
      ['cargo invalid', 'items invalid', 'sku bad'].sort()
    )
    for (const e of cargo) {
      expect(e.path[0]).toBe('cargo')
    }
  })

  it('narrows further as the prefix deepens', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    const items = callErrors(api)('cargo.items') ?? []
    expect(items.map((e) => e.message).sort()).toEqual(['items invalid', 'sku bad'].sort())

    const itemZero = callErrors(api)('cargo.items.0') ?? []
    expect(itemZero.map((e) => e.message)).toEqual(['sku bad'])
  })

  it('accepts segment-array form equivalent to dotted-string', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    const dotted = (callErrors(api)('cargo.items.0') ?? []).map((e) => e.message)
    const segments = (callErrors(api)(['cargo', 'items', 0]) ?? []).map((e) => e.message)
    expect(segments).toEqual(dotted)
  })

  it('root array prefix [] matches every error including form-level', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    const noArg = (callErrors(api)() ?? []).map((e) => e.message).sort()
    const allSegments = (callErrors(api)([]) ?? []).map((e) => e.message).sort()
    expect(noArg).toEqual(allSegments)
    expect(allSegments).toEqual(
      ['airline bad', 'capacity full', 'cargo invalid', 'items invalid', 'sku bad'].sort()
    )
  })

  it("dotted-string '' is the form-level path, not the root subtree", () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    // `''` is one segment (the empty-string key), distinct from
    // root `[]`. Form-level errors live at this PathKey, so the
    // call returns ONLY the form-level bucket.
    const formLevel = (callErrors(api)('') ?? []).map((e) => e.message)
    expect(formLevel).toEqual(['capacity full'])
  })

  it('returns undefined for a path with no matching errors', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    expect(callErrors(api)('reference')).toBeUndefined()
  })

  it('preserves the meta.errors ordering at every prefix', () => {
    const { app, api } = mount()
    apps.push(app)
    seedAllErrors(api)

    const metaCargoOrder = api.meta.errors
      .filter((e) => e.path[0] === 'cargo')
      .map((e) => e.message)
    expect((callErrors(api)('cargo') ?? []).map((e) => e.message)).toEqual(metaCargoOrder)
  })

  it('reactively updates inside a computed wrapping the call', async () => {
    const { app, api } = mount()
    apps.push(app)

    const stepInvalid = computed(() => (callErrors(api)('cargo') ?? []).length > 0)

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
