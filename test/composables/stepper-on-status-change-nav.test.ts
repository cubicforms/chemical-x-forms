// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { FormStatus } from '../../src/runtime/types/types-stepper'

/**
 * `onStatusChange` synthetic invocation on navigation. Whenever
 * `next` / `back` / `goTo` changes the current form, the handler
 * fires for the form being LEFT — current status, regardless of
 * whether anything materially changed. Useful for autosave-on-leave
 * patterns: the consumer persists step N's state at the moment the
 * wizard moves off it.
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

describe('useStepper — onStatusChange nav-away firing', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('fires for the form being left on next()', () => {
    const events: Array<{ formKey: string; reason: 'leave' | 'change' }> = []
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'navup-a' })
      const b = useForm({ schema: schemaB, key: 'navup-b' })
      return {
        stepper: useStepper([a, b], {
          onStatusChange: (_status, form) => {
            events.push({ formKey: form.key, reason: 'leave' })
          },
        }),
        a,
        b,
      }
    })
    apps.push(app)
    const baseline = events.length
    result.stepper.next()
    expect(events.length).toBeGreaterThan(baseline)
    expect(events[events.length - 1]!.formKey).toBe('navup-a')
  })

  it('fires for the form being left on back()', () => {
    const events: string[] = []
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'navback-a' })
      const b = useForm({ schema: schemaB, key: 'navback-b' })
      return {
        stepper: useStepper([a, b], { onStatusChange: (_s, f) => events.push(f.key) }),
        a,
        b,
      }
    })
    apps.push(app)
    result.stepper.next()
    events.length = 0
    result.stepper.back()
    expect(events.some((k) => k === 'navback-b')).toBe(true)
  })

  it('fires for the form being left on goTo()', () => {
    const events: string[] = []
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'navgoto-a' })
      const b = useForm({ schema: schemaB, key: 'navgoto-b' })
      const c = useForm({ schema: schemaC, key: 'navgoto-c' })
      return {
        stepper: useStepper([a, b, c], { onStatusChange: (_s, f) => events.push(f.key) }),
        a,
        b,
        c,
      }
    })
    apps.push(app)
    result.stepper.goTo('navgoto-c')
    expect(events).toContain('navgoto-a')
  })

  it('does not fire on no-op nav (next at end / back at start)', () => {
    const events: string[] = []
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'navnoop-a' })
      const b = useForm({ schema: schemaB, key: 'navnoop-b' })
      return {
        stepper: useStepper([a, b], { onStatusChange: (_s, f) => events.push(f.key) }),
        a,
        b,
      }
    })
    apps.push(app)
    // Silence the dev-warn from next-past-end.
    const originalWarn = console.warn
    console.warn = () => {}
    try {
      result.stepper.back()
      result.stepper.next()
      const baseline = events.length
      result.stepper.next()
      expect(events.length).toBe(baseline)
    } finally {
      console.warn = originalWarn
    }
  })

  it("payload reflects the leaving-form's current status", () => {
    const events: Array<{ formKey: string; status: FormStatus }> = []
    const { app, result } = mountHarness(() => {
      const a = useForm({
        schema: schemaA,
        key: 'navpayload-a',
        defaultValues: { a: 'a-set' },
      })
      const b = useForm({ schema: schemaB, key: 'navpayload-b' })
      return {
        stepper: useStepper([a, b], {
          onStatusChange: (status, form) => {
            events.push({ formKey: form.key, status })
          },
        }),
        a,
        b,
      }
    })
    apps.push(app)
    const baseline = events.length
    result.stepper.next()
    const leaveEvents = events.slice(baseline).filter((e) => e.formKey === 'navpayload-a')
    expect(leaveEvents.length).toBeGreaterThan(0)
  })
})
