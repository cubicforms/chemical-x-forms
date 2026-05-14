// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'
import { waitUntil } from '../utils/form-harness'

/**
 * Activation-lifecycle contract for `useStepper`. A form's async
 * `defaultValues` factory does NOT fire on mount when the form is
 * claimed by a stepper as non-current. It fires on the first
 * navigation into that step. Re-activation does NOT re-fire (a
 * factory is a hydration source, not a refresh hook — chain
 * `form.rehydrate()` to force a re-load).
 *
 * The motivating privacy story: a 25-step public-housing form where
 * Step 14 needs SSN. The stepper guarantees Step 14's factory only
 * runs once the user reaches Step 14 — even if the consumer wires
 * all forms in setup.
 */

const schemaA = z.object({ a: z.string() })
const schemaB = z.object({ b: z.string() })
const schemaC = z.object({ c: z.string() })

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

describe('useStepper — async-defaults activation lifecycle', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does not fire a non-current form factory on mount', async () => {
    let aCalls = 0
    let bCalls = 0
    let cCalls = 0
    const { app, result } = mountHarness(() => {
      const a = useForm({
        schema: schemaA,
        key: 'stepper-act-a',
        defaultValues: () => {
          aCalls += 1
          return Promise.resolve({ a: 'A' })
        },
      })
      const b = useForm({
        schema: schemaB,
        key: 'stepper-act-b',
        defaultValues: () => {
          bCalls += 1
          return Promise.resolve({ b: 'B' })
        },
      })
      const c = useForm({
        schema: schemaC,
        key: 'stepper-act-c',
        defaultValues: () => {
          cCalls += 1
          return Promise.resolve({ c: 'C' })
        },
      })
      return { stepper: useStepper([a, b, c], {}), a, b, c }
    })
    apps.push(app)
    await waitUntil(() => (result.a.isHydrating.value === false ? true : null))
    expect(aCalls).toBe(1)
    expect(bCalls).toBe(0)
    expect(cCalls).toBe(0)
    expect(result.b.isHydrating.value).toBe(false)
    expect(result.c.isHydrating.value).toBe(false)
  })

  it('fires the factory on first activation', async () => {
    let bCalls = 0
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'stepper-act-2-a' })
      const b = useForm({
        schema: schemaB,
        key: 'stepper-act-2-b',
        defaultValues: () => {
          bCalls += 1
          return Promise.resolve({ b: 'B' })
        },
      })
      return { stepper: useStepper([a, b], {}), a, b }
    })
    apps.push(app)
    await waitUntil(() => (result.a.isHydrating.value === false ? true : null))
    expect(bCalls).toBe(0)

    result.stepper.next()
    await waitUntil(() => (result.b.isHydrating.value === false ? true : null))
    expect(bCalls).toBe(1)
    expect(result.b.values.b).toBe('B')
  })

  it('re-activation does NOT re-fire the factory', async () => {
    let bCalls = 0
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'stepper-react-a' })
      const b = useForm({
        schema: schemaB,
        key: 'stepper-react-b',
        defaultValues: () => {
          bCalls += 1
          return Promise.resolve({ b: 'B' })
        },
      })
      return { stepper: useStepper([a, b], {}), a, b }
    })
    apps.push(app)
    await waitUntil(() => (result.a.isHydrating.value === false ? true : null))
    result.stepper.next()
    await waitUntil(() => (result.b.isHydrating.value === false ? true : null))
    expect(bCalls).toBe(1)
    result.stepper.back()
    result.stepper.next()
    await Promise.resolve()
    expect(bCalls).toBe(1)
  })

  it('form.rehydrate() re-fires the factory even from a deferred form', async () => {
    let bCalls = 0
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'stepper-rehyd-a' })
      const b = useForm({
        schema: schemaB,
        key: 'stepper-rehyd-b',
        defaultValues: () => {
          bCalls += 1
          return Promise.resolve({ b: `B-${bCalls}` })
        },
      })
      return { stepper: useStepper([a, b], {}), a, b }
    })
    apps.push(app)
    await waitUntil(() => (result.a.isHydrating.value === false ? true : null))
    expect(bCalls).toBe(0)

    await result.b.rehydrate()
    expect(bCalls).toBe(1)
    expect(result.b.values.b).toBe('B-1')

    await result.b.rehydrate()
    expect(bCalls).toBe(2)
  })
})
