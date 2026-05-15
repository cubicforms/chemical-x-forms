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
 * `form.meta.isSubmitted` is the boolean mirror of `submitCount > 0`,
 * surfaced so templates and `useStepper`'s `FormStatus` can read a
 * single scalar instead of comparing the counter against zero.
 *
 * Once a form has been submitted at all (success or failure), the flag
 * stays `true` — like `submitCount`, it's monotonically non-decreasing
 * over the form's lifetime. Resetting the form does not retroactively
 * un-submit it; if a consumer wants that semantic, they own it.
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
        key: `is-submitted-${Math.random().toString(36).slice(2)}`,
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

describe('form.meta.isSubmitted', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  const schema = z.object({
    email: z.email(),
  })

  it('starts false before any submit', () => {
    const { app, api } = mountForm(schema, { email: 'user@example.com' })
    apps.push(app)
    expect(api.meta.isSubmitted).toBe(false)
    expect(api.meta.submitCount).toBe(0)
  })

  it('flips true on the first successful submit', async () => {
    const { app, api } = mountForm(schema, { email: 'user@example.com' })
    apps.push(app)
    const handler = api.handleSubmit(async () => {})
    await handler(new Event('submit'))
    await waitUntil(() => api.meta.isSubmitted)
    expect(api.meta.isSubmitted).toBe(true)
    expect(api.meta.submitCount).toBe(1)
  })

  it('flips true on the first failed submit too (validation failure counts)', async () => {
    const { app, api } = mountForm(schema, { email: '' })
    apps.push(app)
    const handler = api.handleSubmit(async () => {})
    await handler(new Event('submit'))
    await waitUntil(() => api.meta.isSubmitted)
    expect(api.meta.isSubmitted).toBe(true)
    expect(api.meta.submitCount).toBe(1)
  })

  it('stays true across subsequent submits', async () => {
    const { app, api } = mountForm(schema, { email: 'user@example.com' })
    apps.push(app)
    const handler = api.handleSubmit(async () => {})
    await handler(new Event('submit'))
    await waitUntil(() => api.meta.submitCount === 1)
    await handler(new Event('submit'))
    await waitUntil(() => api.meta.submitCount === 2)
    expect(api.meta.isSubmitted).toBe(true)
  })
})
