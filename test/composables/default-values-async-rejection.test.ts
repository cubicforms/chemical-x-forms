// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'
import { waitUntil } from '../utils/form-harness'

/**
 * Function-form `defaultValues` — factory rejection path.
 *
 * When a factory throws or its promise rejects, the form keeps its
 * schema slim defaults and surfaces the error on `form.hydrateError`.
 * `isHydrating` still flips to `false` (the load attempt is done,
 * even if it failed). The form remains fully functional — consumers
 * can show an error banner, offer a retry button, and let users
 * proceed manually.
 */

type ApiFor<Schema extends z.ZodObject> = UseFormReturnType<z.output<Schema>>

function mountForm<Schema extends z.ZodObject>(
  schema: Schema,
  defaultValues: NonNullable<Parameters<typeof useForm<Schema>>[0]['defaultValues']>
): { app: App; api: ApiFor<Schema> } {
  const handle: { api?: ApiFor<Schema> } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: `async-defaults-rej-${Math.random().toString(36).slice(2)}`,
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

describe('useForm — function-form defaultValues, rejection path', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  const schema = z.object({
    email: z.string(),
    name: z.string(),
  })

  it('surfaces a thrown sync-factory error on hydrateError', async () => {
    const boom = new Error('fetch failed')
    const factory = (): { email: string; name: string } => {
      throw boom
    }
    const { app, api } = mountForm(schema, factory)
    apps.push(app)
    await waitUntil(() => (api.isHydrating.value === false ? true : null))
    expect(api.hydrateError.value).toBe(boom)
    expect(api.isHydrating.value).toBe(false)
  })

  it('surfaces a rejected async-factory promise on hydrateError', async () => {
    const boom = new Error('network down')
    const { app, api } = mountForm(schema, () => Promise.reject(boom))
    apps.push(app)
    await waitUntil(() => (api.isHydrating.value === false ? true : null))
    expect(api.hydrateError.value).toBe(boom)
  })

  it('leaves the form usable with schema slim defaults after rejection', async () => {
    const { app, api } = mountForm(schema, () => Promise.reject(new Error('boom')))
    apps.push(app)
    await waitUntil(() => (api.isHydrating.value === false ? true : null))
    expect(api.values.email).toBe('')
    expect(api.values.name).toBe('')
    // Consumers can still mutate the form post-rejection.
    api.setValue('email', 'recover@example.com')
    expect(api.values.email).toBe('recover@example.com')
  })
})
