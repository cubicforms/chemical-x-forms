// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'
import { waitUntil } from '../utils/form-harness'

/**
 * `form.rehydrate()` re-fires the captured `defaultValues` factory and
 * re-applies the resolved payload. Useful when the upstream source
 * changed (the user picked a different draft from a list, the
 * background sync indicates fresh server data, etc.).
 *
 * Contract:
 *  - Returns a promise that resolves AFTER `isHydrating` flips back to
 *    `false`.
 *  - Re-fires the captured factory each call (so consumers don't have
 *    to maintain their own loader).
 *  - Throws synchronously if the form was constructed with a
 *    plain-value `defaultValues` (no factory to invoke).
 *  - Leaves dirty/touched/submit state alone — chain `form.reset()`
 *    for a clean baseline.
 */

type Defaults = { email: string; name: string }
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
        key: `rehydrate-${Math.random().toString(36).slice(2)}`,
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

describe('form.rehydrate', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  const schema = z.object({ email: z.string(), name: z.string() })

  it('re-fires the captured factory and applies the new payload', async () => {
    let calls = 0
    const factory = (): Promise<Defaults> => {
      calls += 1
      return Promise.resolve(
        calls === 1
          ? { email: 'first@example.com', name: 'Ada' }
          : { email: 'second@example.com', name: 'Hopper' }
      )
    }
    const { app, api } = mountForm(schema, factory)
    apps.push(app)
    await waitUntil(() => (api.isHydrating.value === false ? true : null))
    expect(calls).toBe(1)
    expect(api.values.email).toBe('first@example.com')

    await api.rehydrate()
    expect(calls).toBe(2)
    expect(api.values.email).toBe('second@example.com')
    expect(api.values.name).toBe('Hopper')
  })

  it('resolves only after isHydrating flips back to false', async () => {
    let resolveFactory!: (value: Defaults) => void
    let calls = 0
    const factory = (): Promise<Defaults> => {
      calls += 1
      if (calls === 1) return Promise.resolve({ email: 'first@example.com', name: 'Ada' })
      return new Promise<Defaults>((r) => {
        resolveFactory = r
      })
    }
    const { app, api } = mountForm(schema, factory)
    apps.push(app)
    await waitUntil(() => (api.isHydrating.value === false ? true : null))

    const promise = api.rehydrate()
    expect(api.isHydrating.value).toBe(true)
    resolveFactory({ email: 'second@example.com', name: 'Hopper' })
    await promise
    expect(api.isHydrating.value).toBe(false)
    expect(api.values.email).toBe('second@example.com')
  })

  it('throws synchronously when no factory was captured', () => {
    const { app, api } = mountForm(schema, { email: 'a@b.c', name: 'Ada' })
    apps.push(app)
    expect(() => api.rehydrate()).toThrow()
  })

  it('reports a rejected factory through hydrateError', async () => {
    let calls = 0
    const factory = (): Promise<Defaults> => {
      calls += 1
      if (calls === 1) return Promise.resolve({ email: 'first@example.com', name: 'Ada' })
      return Promise.reject(new Error('rehydrate failed'))
    }
    const { app, api } = mountForm(schema, factory)
    apps.push(app)
    await waitUntil(() => (api.isHydrating.value === false ? true : null))
    expect(api.hydrateError.value).toBeNull()

    await api.rehydrate()
    expect(api.hydrateError.value).toBeInstanceOf(Error)
    expect((api.hydrateError.value as Error).message).toBe('rehydrate failed')
    expect(api.isHydrating.value).toBe(false)
  })
})
