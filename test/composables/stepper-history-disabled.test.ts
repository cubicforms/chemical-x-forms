// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `history: false` opts out of `window.history` integration entirely.
 * Useful for embedded wizards where the host shell already owns the
 * URL, or for stepper instances rendered inside dialogs / drawers
 * where a fresh history entry per step would be surprising.
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

describe('useStepper — history disabled', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('history: false does not call pushState or replaceState on nav', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'hd-nav-a' })
      const b = useForm({ schema: schemaB, key: 'hd-nav-b' })
      return useStepper([a, b], { history: false })
    })
    apps.push(app)
    pushSpy.mockClear()
    replaceSpy.mockClear()
    result.next()
    result.back()
    expect(pushSpy).not.toHaveBeenCalled()
    expect(replaceSpy).not.toHaveBeenCalled()
    pushSpy.mockRestore()
    replaceSpy.mockRestore()
  })

  it('history: false does not seed initial step from `?step=<key>`', () => {
    window.history.replaceState(null, '', 'http://localhost:3000/wizard?step=hd-seed-b')
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'hd-seed-a' })
      const b = useForm({ schema: schemaB, key: 'hd-seed-b' })
      return useStepper([a, b], { history: false })
    })
    apps.push(app)
    expect(result.current.value).toBe('hd-seed-a')
  })

  it('history: false leaves the URL untouched on mount', () => {
    window.history.replaceState(null, '', 'http://localhost:3000/wizard?other=stay')
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'hd-url-a' })
      const b = useForm({ schema: schemaB, key: 'hd-url-b' })
      return useStepper([a, b], { history: false })
    })
    apps.push(app)
    expect(replaceSpy).not.toHaveBeenCalled()
    expect(new URL(window.location.href).searchParams.get('step')).toBeNull()
    expect(new URL(window.location.href).searchParams.get('other')).toBe('stay')
    expect(result.current.value).toBe('hd-url-a')
    replaceSpy.mockRestore()
  })

  it('history: false ignores popstate (current does not change)', async () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'hd-pop-a' })
      const b = useForm({ schema: schemaB, key: 'hd-pop-b' })
      return useStepper([a, b], { history: false })
    })
    apps.push(app)
    result.next()
    expect(result.current.value).toBe('hd-pop-b')
    // Simulate a navigation event by manually replacing the URL and
    // dispatching popstate. With history: false the stepper isn't
    // listening, so `current` should stay put.
    window.history.replaceState(null, '', 'http://localhost:3000/wizard?step=hd-pop-a')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.value).toBe('hd-pop-b')
  })
})
