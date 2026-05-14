// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, type App } from 'vue'
import { useForm } from '../../src/zod'
import type { UseFormReturn } from '../../src/zod'
import { z } from 'zod'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import { canonicalizePath } from '../../src/runtime/core/paths'
import type { FormStore } from '../../src/runtime/core/create-form-store'
import type { GenericForm } from '../../src/runtime/types/types-core'

/**
 * Per-prefix validity gating via `form.fields(path).valid`. The
 * container call-form aggregates over descendants (errors empty +
 * no in-flight per-field validation), with a per-prefix
 * `firstValidationDone` gate for sub-schemas declaring async work.
 *
 * Multi-path "all of these subtrees valid" reads as
 * `paths.every(p => form.fields(p).valid)`.
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

type FieldStateLike = {
  valid: boolean
  errors: readonly unknown[]
  validating: boolean
}
function fieldsCall(api: Api): (p: string | readonly (string | number)[]) => FieldStateLike {
  return api.fields as unknown as (p: string | readonly (string | number)[]) => FieldStateLike
}
function allValid(api: Api, paths: ReadonlyArray<string | readonly (string | number)[]>): boolean {
  const f = fieldsCall(api)
  return paths.every((p) => f(p).valid)
}

function mount(): { app: App; api: Api; store: FormStore<GenericForm> } {
  const handle: { api?: Api } = {}
  const registry = createRegistry()
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: 'is-valid',
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
  const app = createApp(App)
  attachRegistryToApp(app, registry)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  const store = registry.forms.get('is-valid')
  if (!store) throw new Error('FormStore not registered — test setup broken')
  return { app, api: handle.api as Api, store }
}

describe('per-prefix validity via form.fields(path).valid', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('returns true when no errors and no in-flight validation', () => {
    const { app, api } = mount()
    apps.push(app)
    expect(allValid(api, ['reference', 'cargo', 'service'])).toBe(true)
  })

  it('returns false when an error sits at one of the prefixes', () => {
    const { app, api } = mount()
    apps.push(app)
    api.setFieldErrors([
      { path: ['cargo', 'items', 0, 'sku'], message: 'sku bad', formKey: api.key, code: 'x' },
    ])
    expect(allValid(api, ['cargo'])).toBe(false)
    expect(allValid(api, ['service'])).toBe(true)
  })

  it('returns false when an error descends from one of the prefixes', () => {
    const { app, api } = mount()
    apps.push(app)
    api.setFieldErrors([
      { path: ['cargo', 'items'], message: 'items bad', formKey: api.key, code: 'x' },
    ])
    expect(allValid(api, ['cargo'])).toBe(false)
  })

  it('multi-path: false when ANY supplied prefix matches an error', () => {
    const { app, api } = mount()
    apps.push(app)
    api.setFieldErrors([
      { path: ['service', 'airline'], message: 'airline bad', formKey: api.key, code: 'x' },
    ])
    expect(allValid(api, ['cargo', 'service'])).toBe(false)
    expect(allValid(api, ['cargo'])).toBe(true)
    expect(allValid(api, ['service'])).toBe(false)
  })

  it('returns false when a field-level validation is in flight under a prefix', async () => {
    const { app, api, store } = mount()
    apps.push(app)
    const skuKey = canonicalizePath(['cargo', 'items', 0, 'sku']).key
    store.fieldValidationCounts.set(skuKey, 1)
    await nextTick()
    expect(allValid(api, ['cargo'])).toBe(false)
    expect(allValid(api, ['service'])).toBe(true)
    store.fieldValidationCounts.delete(skuKey)
    await nextTick()
    expect(allValid(api, ['cargo'])).toBe(true)
  })

  it('reactively updates inside a computed wrapping the call', async () => {
    const { app, api } = mount()
    apps.push(app)

    const cargoOk = computed(() => allValid(api, ['cargo']))
    expect(cargoOk.value).toBe(true)

    api.setFieldErrors([
      { path: ['cargo', 'items', 0, 'sku'], message: 'sku bad', formKey: api.key, code: 'x' },
    ])
    await nextTick()
    expect(cargoOk.value).toBe(false)

    api.clearFieldErrors(['cargo', 'items', 0, 'sku'])
    await nextTick()
    expect(cargoOk.value).toBe(true)
  })

  it('reactively flips on per-field validating change', async () => {
    const { app, api, store } = mount()
    apps.push(app)

    const cargoOk = computed(() => allValid(api, ['cargo']))
    expect(cargoOk.value).toBe(true)

    const skuKey = canonicalizePath(['cargo', 'items', 0, 'sku']).key
    store.fieldValidationCounts.set(skuKey, 1)
    await nextTick()
    expect(cargoOk.value).toBe(false)

    store.fieldValidationCounts.delete(skuKey)
    await nextTick()
    expect(cargoOk.value).toBe(true)
  })

  it('empty paths array: vacuously true', () => {
    const { app, api } = mount()
    apps.push(app)
    expect(allValid(api, [])).toBe(true)
  })

  it('root prefix matches every error including form-level', () => {
    const { app, api } = mount()
    apps.push(app)
    api.setFormErrors([{ message: 'capacity full' }])
    expect(allValid(api, [[]])).toBe(false)
    // A scoped prefix doesn't see the form-level error.
    expect(allValid(api, ['cargo'])).toBe(true)
  })
})
