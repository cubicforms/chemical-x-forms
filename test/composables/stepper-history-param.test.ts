// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `history: { param: '<name>' }` lets the consumer rename the URL
 * search-param key. Useful when `?step=...` collides with an
 * existing host-app query param, or when the stepper renders inside
 * a nested wizard that wants its own namespaced param.
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

describe('useStepper — history param customization', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writes to the custom param on next()', () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'hp-write-a' })
      const b = useForm({ schema: schemaB, key: 'hp-write-b' })
      return useStepper([a, b], { history: { param: 'wiz' } })
    })
    apps.push(app)
    result.next()
    const url = new URL(window.location.href)
    expect(url.searchParams.get('wiz')).toBe('hp-write-b')
    expect(url.searchParams.get('step')).toBeNull()
  })

  it('reads the custom param on mount to seed initial step', () => {
    window.history.replaceState(null, '', 'http://localhost:3000/wizard?wiz=hp-seed-b')
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'hp-seed-a' })
      const b = useForm({ schema: schemaB, key: 'hp-seed-b' })
      return useStepper([a, b], { history: { param: 'wiz' } })
    })
    apps.push(app)
    expect(result.current.value).toBe('hp-seed-b')
  })

  it('ignores the default `step` param when a custom param is set', () => {
    window.history.replaceState(null, '', 'http://localhost:3000/wizard?step=hp-isol-b')
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'hp-isol-a' })
      const b = useForm({ schema: schemaB, key: 'hp-isol-b' })
      return useStepper([a, b], { history: { param: 'wiz' } })
    })
    apps.push(app)
    expect(result.current.value).toBe('hp-isol-a')
  })
})
