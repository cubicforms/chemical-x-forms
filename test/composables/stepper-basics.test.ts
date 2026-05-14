// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseStepperReturnType, AnyForm } from '../../src/runtime/types/types-stepper'

/**
 * `useStepper` — basic navigation. Three forms keyed `a / b / c`,
 * mounted in setup order. The stepper records its forms and
 * exposes:
 *
 *   - `count`, `current`, `forms` (introspection)
 *   - `next()` / `back()` — silent no-op past ends with a dev-warn
 *   - `goTo(key)` — throws on unknown key
 *   - duplicate keys / empty forms — throws at construction
 *
 * The "no throw past ends" stance is deliberate: this would
 * otherwise crash a consumer who wires a button to `next()` without
 * also disabling it at the end of the wizard.
 */

const schema = z.object({ email: z.string() })

function mountStepperHarness<R>(setup: () => R): { app: App; result: R } {
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

/**
 * Like `mountStepperHarness`, but captures any error thrown inside
 * `setup` and re-throws it on the test thread. The app's
 * `errorHandler` otherwise swallows setup-time throws — we want
 * `expect(() => ...).toThrow()` to actually see them.
 */
function mountAndCaptureSetupError(setup: () => unknown): void {
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
  if (captured !== undefined) throw captured
}

type StepperWithForms<Keys extends readonly string[]> = UseStepperReturnType<
  ReadonlyArray<AnyForm & { readonly key: Keys[number] }>
>

describe('useStepper — basic navigation', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('exposes count, forms, and initial current', () => {
    const { app, result } = mountStepperHarness(() => {
      const a = useForm({ schema, key: 'a' })
      const b = useForm({ schema, key: 'b' })
      const c = useForm({ schema, key: 'c' })
      return useStepper([a, b, c], {}) as StepperWithForms<['a', 'b', 'c']>
    })
    apps.push(app)
    expect(result.count).toBe(3)
    expect(result.forms.length).toBe(3)
    expect(result.current.value).toBe('a')
  })

  it('next() advances and back() retreats', () => {
    const { app, result } = mountStepperHarness(() => {
      const a = useForm({ schema, key: 'a' })
      const b = useForm({ schema, key: 'b' })
      const c = useForm({ schema, key: 'c' })
      return useStepper([a, b, c], {}) as StepperWithForms<['a', 'b', 'c']>
    })
    apps.push(app)
    result.next()
    expect(result.current.value).toBe('b')
    result.next()
    expect(result.current.value).toBe('c')
    result.back()
    expect(result.current.value).toBe('b')
  })

  it('goTo(key) jumps directly', () => {
    const { app, result } = mountStepperHarness(() => {
      const a = useForm({ schema, key: 'a' })
      const b = useForm({ schema, key: 'b' })
      const c = useForm({ schema, key: 'c' })
      return useStepper([a, b, c], {}) as StepperWithForms<['a', 'b', 'c']>
    })
    apps.push(app)
    result.goTo('c')
    expect(result.current.value).toBe('c')
    result.goTo('a')
    expect(result.current.value).toBe('a')
  })

  it('next() at last step is a no-op and dev-warns', () => {
    const warnings: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })
    const { app, result } = mountStepperHarness(() => {
      const a = useForm({ schema, key: 'a' })
      const b = useForm({ schema, key: 'b' })
      return useStepper([a, b], {}) as StepperWithForms<['a', 'b']>
    })
    apps.push(app)
    result.next()
    expect(result.current.value).toBe('b')
    result.next()
    expect(result.current.value).toBe('b')
    warnSpy.mockRestore()
    expect(warnings.some((w) => w.includes('useStepper'))).toBe(true)
  })

  it('back() at first step is a no-op and dev-warns', () => {
    const warnings: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })
    const { app, result } = mountStepperHarness(() => {
      const a = useForm({ schema, key: 'a' })
      const b = useForm({ schema, key: 'b' })
      return useStepper([a, b], {}) as StepperWithForms<['a', 'b']>
    })
    apps.push(app)
    result.back()
    expect(result.current.value).toBe('a')
    warnSpy.mockRestore()
    expect(warnings.some((w) => w.includes('useStepper'))).toBe(true)
  })

  it('goTo(unknown) throws', () => {
    const { app, result } = mountStepperHarness(() => {
      const a = useForm({ schema, key: 'a' })
      const b = useForm({ schema, key: 'b' })
      return useStepper([a, b], {}) as StepperWithForms<['a', 'b']>
    })
    apps.push(app)
    expect(() => (result.goTo as (key: string) => void)('typo')).toThrow(/typo/)
  })

  it('throws at construction on empty forms array', () => {
    expect(() => {
      mountAndCaptureSetupError(() => useStepper([], {}))
    }).toThrow(/at least one form/i)
  })

  it('throws at construction on duplicate keys', () => {
    expect(() => {
      mountAndCaptureSetupError(() => {
        const a = useForm({ schema, key: 'a' })
        const b = useForm({ schema, key: 'a' })
        return useStepper([a, b], {})
      })
    }).toThrow(/duplicate/i)
  })
})
