// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Mid-flight popstate safety. The stepper registry's one-shot
 * activation contract must hold even when the user pops back-and-
 * forth between steps while a step's async factory is in flight:
 *
 *   1. Activate step B → factory starts firing (once).
 *   2. Pop back to A before B's factory resolves.
 *   3. Factory eventually resolves; values apply to B's form.
 *   4. Pop forward to B again — factory MUST NOT re-fire.
 *
 * `pendingActivations.delete(nextKey)` in `markCurrent` is what
 * enforces step 4; this probe locks that contract from the consumer
 * surface so a future refactor can't reintroduce double-firing.
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

describe('useStepper — popstate mid-flight safety', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('async factory fires exactly once across back-and-forth popstate', async () => {
    let factoryCalls = 0
    let resolveFactory: ((value: { b: string }) => void) | undefined
    const factoryPromise = new Promise<{ b: string }>((resolve) => {
      resolveFactory = resolve
    })
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'mf-a', defaultValues: { a: 'a-set' } })
      const b = useForm({
        schema: schemaB,
        key: 'mf-b',
        defaultValues: () => {
          factoryCalls += 1
          return factoryPromise
        },
      })
      return { stepper: useStepper([a, b], {}), a, b }
    })
    apps.push(app)
    expect(factoryCalls).toBe(0)

    // Activate B — factory starts (one call).
    result.stepper.next()
    await nextTick()
    expect(factoryCalls).toBe(1)
    expect(result.b.isHydrating.value).toBe(true)

    // Pop back to A via popstate (silent setCurrent).
    window.history.back()
    await new Promise((r) => setTimeout(r, 20))
    expect(result.stepper.current.value).toBe('mf-a')

    // Resolve the factory; values apply to B even though it's not current.
    resolveFactory!({ b: 'fetched' })
    await factoryPromise
    for (let i = 0; i < 16; i += 1) {
      await Promise.resolve()
      await nextTick()
      if (!result.b.isHydrating.value) break
    }
    expect(result.b.isHydrating.value).toBe(false)

    // Pop forward to B — factory MUST NOT re-fire.
    window.history.forward()
    await new Promise((r) => setTimeout(r, 20))
    expect(result.stepper.current.value).toBe('mf-b')
    expect(factoryCalls).toBe(1)
  })

  it('does not deref unresolved factory when popping past it', async () => {
    let factoryCalls = 0
    const factoryPromise = new Promise<{ b: string }>(() => {
      // Never resolves — we want to prove popping doesn't affect the
      // factory's promise state. The form stays in `isHydrating: true`
      // throughout this probe.
    })
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'mf-deref-a', defaultValues: { a: 'a' } })
      const b = useForm({
        schema: schemaB,
        key: 'mf-deref-b',
        defaultValues: () => {
          factoryCalls += 1
          return factoryPromise
        },
      })
      return { stepper: useStepper([a, b], {}), a, b }
    })
    apps.push(app)
    result.stepper.next()
    await nextTick()
    expect(factoryCalls).toBe(1)
    result.stepper.back()
    result.stepper.next()
    result.stepper.back()
    result.stepper.next()
    expect(factoryCalls).toBe(1)
  })
})
