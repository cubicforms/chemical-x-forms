// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import type { UseFormConfigV4 } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'
import { waitUntil } from '../utils/form-harness'

/**
 * Function-form `defaultValues` — both sync and async factories.
 *
 * Memo (`project_use_stepper_design.md`): "Function (sync or async)
 * → defer until first needed." Both forms settle on a microtask after
 * construction, so the form starts with the schema's slim defaults
 * and `form.isHydrating` is `true` until the factory's result lands.
 *
 * SSR coverage moves to PR 1.6's `test/ssr.test.ts` extension. This
 * file covers the CSR path: microtask defer, reactive `isHydrating`,
 * resolved values overlay onto slim defaults.
 */

type ApiFor<Schema extends z.ZodObject> = UseFormReturnType<z.output<Schema>>

function mountForm<Schema extends z.ZodObject>(
  schema: Schema,
  defaultValues: NonNullable<UseFormConfigV4<Schema>['defaultValues']>
): { app: App; api: ApiFor<Schema> } {
  const handle: { api?: ApiFor<Schema> } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: `async-defaults-${Math.random().toString(36).slice(2)}`,
        defaultValues,
      }) as unknown as ApiFor<Schema>
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  app.config.warnHandler = () => {}
  app.config.errorHandler = () => {}
  app.mount(document.createElement('div'))
  return { app, api: handle.api as ApiFor<Schema> }
}

describe('useForm — function-form defaultValues', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  const schema = z.object({
    email: z.string(),
    name: z.string(),
  })

  it('plain-value defaultValues leaves isHydrating false', () => {
    const { app, api } = mountForm(schema, { email: 'a@b.c', name: 'Ada' })
    apps.push(app)
    expect(api.isHydrating.value).toBe(false)
    expect(api.hydrateError.value).toBeNull()
    expect(api.values.email).toBe('a@b.c')
  })

  it('sync function defaultValues settles on a microtask', async () => {
    let calls = 0
    const factory = () => {
      calls += 1
      return { email: 'sync@example.com', name: 'Grace' }
    }
    const { app, api } = mountForm(schema, factory)
    apps.push(app)
    // Microtask not yet flushed — factory has been queued but not
    // necessarily invoked. We assert behavior at the post-flush state.
    await waitUntil(() => (api.isHydrating.value === false ? true : null))
    expect(calls).toBe(1)
    expect(api.values.email).toBe('sync@example.com')
    expect(api.values.name).toBe('Grace')
    expect(api.hydrateError.value).toBeNull()
  })

  it('async function defaultValues flips isHydrating true → false', async () => {
    let resolveFactory!: (value: { email: string; name: string }) => void
    const promise = new Promise<{ email: string; name: string }>((r) => {
      resolveFactory = r
    })
    const { app, api } = mountForm(schema, () => promise)
    apps.push(app)
    expect(api.isHydrating.value).toBe(true)
    resolveFactory({ email: 'async@example.com', name: 'Lovelace' })
    await waitUntil(() => (api.isHydrating.value === false ? true : null))
    expect(api.values.email).toBe('async@example.com')
    expect(api.values.name).toBe('Lovelace')
    expect(api.hydrateError.value).toBeNull()
  })

  it('partial async resolution overlays onto schema slim defaults', async () => {
    // Factory returns only `email` — `name` should keep its schema
    // slim default (empty string for z.string()).
    const { app, api } = mountForm(schema, () => Promise.resolve({ email: 'partial@example.com' }))
    apps.push(app)
    await waitUntil(() => (api.isHydrating.value === false ? true : null))
    expect(api.values.email).toBe('partial@example.com')
    expect(api.values.name).toBe('')
  })
})
