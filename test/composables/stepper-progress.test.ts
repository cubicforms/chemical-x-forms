// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `stepper.progress` is a normalised [0, 1] indicator. Default
 * implementation is `valid_form_count / count`. Consumers can pass
 * a custom \`progress(forms)\` for weighted progress, skip-aware
 * progress, etc.
 */

const okSchema = z.object({ value: z.string() })
const reqSchema = z.object({ value: z.string().min(1, 'required') })

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

describe('useStepper — progress', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('default is 0 when no forms are valid', () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: reqSchema, key: 'pg-default-a' })
      const b = useForm({ schema: reqSchema, key: 'pg-default-b' })
      return useStepper([a, b], {})
    })
    apps.push(app)
    expect(result.progress.value).toBe(0)
  })

  it('default tracks valid_count / total_count', async () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({
        schema: okSchema,
        key: 'pg-half-a',
        defaultValues: { value: 'ready' },
      })
      const b = useForm({ schema: reqSchema, key: 'pg-half-b' })
      return { stepper: useStepper([a, b], {}), a, b }
    })
    apps.push(app)
    await result.a.validate()
    for (let i = 0; i < 16; i += 1) {
      await Promise.resolve()
      await nextTick()
      if (!result.a.meta.validating) break
    }
    expect(result.stepper.progress.value).toBeCloseTo(0.5, 5)
  })

  it('override receives forms tuple and is the source of truth', () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: okSchema, key: 'pg-over-a' })
      const b = useForm({ schema: okSchema, key: 'pg-over-b' })
      return useStepper([a, b], {
        progress: (forms) => forms.length / 100,
      })
    })
    apps.push(app)
    expect(result.progress.value).toBeCloseTo(0.02, 5)
  })

  it('override is reactive — re-evaluates when underlying statuses change', async () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({
        schema: okSchema,
        key: 'pg-reactive-a',
        defaultValues: { value: 'ready' },
      })
      const b = useForm({ schema: reqSchema, key: 'pg-reactive-b' })
      return {
        stepper: useStepper([a, b], {
          progress: (forms) =>
            forms.filter((f) => {
              const meta = (f as unknown as { meta: { valid: boolean } }).meta
              return meta?.valid === true
            }).length,
        }),
        a,
        b,
      }
    })
    apps.push(app)
    await result.a.validate()
    for (let i = 0; i < 16; i += 1) {
      await Promise.resolve()
      await nextTick()
      if (!result.a.meta.validating) break
    }
    expect(result.stepper.progress.value).toBe(1)
    result.b.setValue('value', 'ok')
    await result.b.validate()
    for (let i = 0; i < 16; i += 1) {
      await Promise.resolve()
      await nextTick()
      if (!result.b.meta.validating) break
    }
    expect(result.stepper.progress.value).toBe(2)
  })
})
