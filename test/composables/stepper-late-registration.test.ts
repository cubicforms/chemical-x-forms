// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'
import { StepperLateRegistrationError } from '../../src/runtime/core/errors'
import { useRegistry } from '../../src/runtime/core/registry'

/**
 * Runtime guard for the activation-lifecycle defer contract.
 *
 * `useStepper` must be called in the same synchronous `setup()` as
 * its participating `useForm` calls — the defer-claim relies on
 * winning the race against a microtask-deferred factory settle.
 * Calling `useStepper` AFTER any participating form's async factory
 * has already started settling makes the defer impossible to honor,
 * so we throw `StepperLateRegistrationError` with a clear message
 * instead of silently letting the privacy contract slip.
 *
 * The white-box test below simulates a race-loss by flipping
 * `state.factorySettleStarted` directly. In practice this can occur
 * across component-tree boundaries — e.g. a parent component runs
 * `useForm({ key: 'b', defaultValues: () => Promise.resolve(...) })`,
 * the factory settles between parent and child setup, then the
 * child calls `useStepper([..., bFromParent])`.
 */

const schemaA = z.object({ a: z.string() })
const schemaB = z.object({ b: z.string() })

function mountAndCaptureSetupError(setup: () => unknown): unknown {
  let captured: unknown
  const App = defineComponent({
    setup() {
      try {
        setup()
      } catch (error) {
        captured = error
      }
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  app.config.warnHandler = () => {}
  app.config.errorHandler = () => {}
  app.mount(document.createElement('div'))
  app.unmount()
  return captured
}

describe('useStepper — late-registration guard', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('throws StepperLateRegistrationError when a participating async factory has already settled', () => {
    const result = mountAndCaptureSetupError(() => {
      const a = useForm({ schema: schemaA, key: 'late-reg-a' })
      const b = useForm({
        schema: schemaB,
        key: 'late-reg-b',
        defaultValues: () => Promise.resolve({ b: 'B' }),
      })
      // Simulate the race-loss: the factory's settle body has
      // already started running before the useStepper call below.
      const registry = useRegistry()
      const bStore = registry.forms.get('late-reg-b')
      if (bStore === undefined) throw new Error('bStore missing')
      bStore.factorySettleStarted.value = true
      return useStepper([a, b], {})
    })
    expect(result).toBeInstanceOf(StepperLateRegistrationError)
    expect(String(result)).toMatch(/late-reg-b/)
  })

  it('does not throw when no participating form has an async factory', () => {
    const result = mountAndCaptureSetupError(() => {
      const a = useForm({ schema: schemaA, key: 'late-reg-sync-a' })
      const b = useForm({ schema: schemaB, key: 'late-reg-sync-b' })
      return useStepper([a, b], {})
    })
    expect(result).toBeUndefined()
  })

  it('does not throw when factorySettleStarted is true but no factory is captured', () => {
    // Sync `defaultValues` produces no factory; the flag would
    // never flip under normal flow, but we verify the AND guard
    // correctly skips when only the flag is set.
    const result = mountAndCaptureSetupError(() => {
      const a = useForm({ schema: schemaA, key: 'late-reg-no-factory-a' })
      const b = useForm({
        schema: schemaB,
        key: 'late-reg-no-factory-b',
        defaultValues: { b: 'B-sync' },
      })
      const registry = useRegistry()
      const bStore = registry.forms.get('late-reg-no-factory-b')
      if (bStore === undefined) throw new Error('bStore missing')
      bStore.factorySettleStarted.value = true
      return useStepper([a, b], {})
    })
    expect(result).toBeUndefined()
  })
})
