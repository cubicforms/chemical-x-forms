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
 * Regression: when an async-defaults factory settles, the resulting
 * `applyFormReplacement` carries `meta: { hydration: true }`. The
 * undo/redo `history` module's `meta.hydration === true` guard
 * (`history.ts:256`) must skip recording this as a user mutation, so
 * the consumer can't undo "back through" the hydration to the
 * transient slim defaults.
 *
 * If this regresses, `form.history.canUndo` will flip true immediately
 * after async resolution, exposing the intermediate state.
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
        key: `history-skip-${Math.random().toString(36).slice(2)}`,
        defaultValues,
        history: { max: 20 },
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

describe('default-values hydration skips history', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  const schema = z.object({ email: z.string(), name: z.string() })

  it('async resolution does not push an undo entry', async () => {
    const { app, api } = mountForm(schema, () => Promise.resolve({ email: 'a@b.c', name: 'Ada' }))
    apps.push(app)
    await waitUntil(() => (api.isHydrating.value === false ? true : null))
    expect(api.values.email).toBe('a@b.c')
    // Despite the apply that just landed, history must remain clean —
    // undo would otherwise expose the transient slim-default state.
    expect(api.history.canUndo).toBe(false)
  })

  it('user mutations after hydration record normally', async () => {
    const { app, api } = mountForm(schema, () => Promise.resolve({ email: 'a@b.c', name: 'Ada' }))
    apps.push(app)
    await waitUntil(() => (api.isHydrating.value === false ? true : null))
    expect(api.history.canUndo).toBe(false)

    api.setValue('email', 'updated@example.com')
    await waitUntil(() => (api.history.canUndo ? true : null))
    expect(api.history.canUndo).toBe(true)
  })
})
