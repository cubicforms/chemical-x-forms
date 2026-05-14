// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Regression guard: the defer-claim hookup must NOT intercept
 * sync `defaultValues` on the active step (or any step). Sync
 * values resolve at `buildFreshState` — before any microtask
 * flush — so they are already in `form.values` by the time
 * `useStepper` claims keys. The claim is a no-op for sync forms.
 *
 * Without this guard, refactoring the trichotomy branch later could
 * accidentally route sync paths through the deferral signal.
 */

const schemaA = z.object({ a: z.string() })
const schemaB = z.object({ b: z.string() })

function mountHarness<R>(setup: () => R): { app: App; result: R } {
  const handle: { result?: R } = {}
  const App = defineComponent({
    setup() {
      handle.result = setup()
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  app.config.warnHandler = () => {}
  app.config.errorHandler = () => {}
  app.mount(document.createElement('div'))
  return { app, result: handle.result as R }
}

describe('useStepper — active form with sync defaults', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('sync defaults on step 0 are visible at construction', () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({
        schema: schemaA,
        key: 'stepper-sync-a',
        defaultValues: { a: 'A-sync' },
      })
      const b = useForm({ schema: schemaB, key: 'stepper-sync-b' })
      return { stepper: useStepper([a, b], {}), a, b }
    })
    apps.push(app)
    expect(result.a.values.a).toBe('A-sync')
    expect(result.a.isHydrating.value).toBe(false)
  })

  it('sync defaults on a non-current step are visible at construction', () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'stepper-sync-2-a' })
      const b = useForm({
        schema: schemaB,
        key: 'stepper-sync-2-b',
        defaultValues: { b: 'B-sync' },
      })
      return { stepper: useStepper([a, b], {}), a, b }
    })
    apps.push(app)
    expect(result.b.values.b).toBe('B-sync')
    expect(result.b.isHydrating.value).toBe(false)
  })
})
