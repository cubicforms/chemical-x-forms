// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'
import { waitUntil } from '../utils/form-harness'

/**
 * `form.meta.errorCount` is a scalar mirror of `form.meta.errors.length`,
 * exposed as a top-level meta field so consumers can read it in
 * templates and `watch(form.meta, ...)` without indexing an array. PR 3
 * (`useStepper`) consumes this through `FormStatus`; PR 1 ships it as a
 * standalone meta extension so the friction is fixed for non-stepper
 * forms too.
 *
 * Contract: `errorCount === errors.length` across every reactive
 * mutation. Reactivity follows the same graph as `errors`, so a single
 * `watch(form.meta.errorCount, ...)` fires exactly when a meaningful
 * error change has happened.
 */

type ApiFor<Schema extends z.ZodObject> = Omit<UseFormReturnType<z.output<Schema>>, 'setValue'> & {
  setValue: (path: string, value: unknown) => boolean
}

function mountForm<Schema extends z.ZodObject>(
  schema: Schema,
  defaultValues: NonNullable<Parameters<typeof useForm<Schema>>[0]['defaultValues']>
): { app: App; api: ApiFor<Schema> } {
  const handle: { api?: ApiFor<Schema> } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: `error-count-${Math.random().toString(36).slice(2)}`,
        defaultValues,
        validateOn: 'change',
        debounceMs: 0,
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

describe('form.meta.errorCount', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  const schema = z.object({
    email: z.email(),
    password: z.string().min(8, 'At least 8 characters.'),
  })

  it('starts equal to errors.length after construction-time validation', async () => {
    const { app, api } = mountForm(schema, { email: '', password: '' })
    apps.push(app)
    await waitUntil(() => api.meta.errors.length > 0)
    expect(api.meta.errorCount).toBe(api.meta.errors.length)
    expect(api.meta.errorCount).toBe(2)
  })

  it('tracks errors.length as fields become valid', async () => {
    const { app, api } = mountForm(schema, { email: '', password: '' })
    apps.push(app)
    await waitUntil(() => api.meta.errorCount === 2)

    // Drive validation by submitting — re-runs the whole schema and
    // re-sorts the aggregate. The invariant `errorCount === errors.length`
    // must hold at every reactive frame, regardless of WHICH path
    // triggers the recomputation.
    api.setValue('email', 'user@example.com')
    await api.handleSubmit(async () => {})(new Event('submit'))
    expect(api.meta.errorCount).toBe(api.meta.errors.length)
    expect(api.meta.errorCount).toBe(1)

    api.setValue('password', 'longenough')
    await api.handleSubmit(async () => {})(new Event('submit'))
    expect(api.meta.errorCount).toBe(api.meta.errors.length)
    expect(api.meta.errorCount).toBe(0)
  })

  it('tracks errors.length as valid fields become invalid', async () => {
    const { app, api } = mountForm(schema, {
      email: 'user@example.com',
      password: 'longenough',
    })
    apps.push(app)
    expect(api.meta.errorCount).toBe(api.meta.errors.length)

    api.setValue('email', 'not-an-email')
    await api.handleSubmit(async () => {})(new Event('submit'))
    expect(api.meta.errorCount).toBe(api.meta.errors.length)
    expect(api.meta.errorCount).toBe(1)
  })
})
