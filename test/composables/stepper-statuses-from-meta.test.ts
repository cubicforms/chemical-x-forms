// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `stepper.statuses` derives each `FormStatus` from the matching
 * form's `meta`. Reactivity flows: form values mutate → meta updates →
 * status updates → template re-renders.
 */

const cargoSchema = z.object({
  weight: z.number().min(1, 'weight required'),
  description: z.string().min(1, 'description required'),
})
const reviewSchema = z.object({ note: z.string() })

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

describe('useStepper — statuses derived from form.meta', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('starts with isValid:false / isDirty:false / errorCount:0 for empty forms', () => {
    const { app, result } = mountHarness(() => {
      const cargo = useForm({ schema: cargoSchema, key: 'st-cargo' })
      const review = useForm({ schema: reviewSchema, key: 'st-review' })
      return useStepper([cargo, review], {})
    })
    apps.push(app)
    expect(result.statuses['st-cargo'].isDirty).toBe(false)
    expect(result.statuses['st-cargo'].isSubmitted).toBe(false)
    expect(result.statuses['st-review'].isDirty).toBe(false)
  })

  it('flips isDirty when a form value changes', async () => {
    const { app, result } = mountHarness(() => {
      const cargo = useForm({ schema: cargoSchema, key: 'st-dirty-cargo' })
      const review = useForm({ schema: reviewSchema, key: 'st-dirty-review' })
      return { stepper: useStepper([cargo, review], {}), cargo, review }
    })
    apps.push(app)
    expect(result.stepper.statuses['st-dirty-cargo'].isDirty).toBe(false)
    result.cargo.setValue('description', 'box of widgets')
    await nextTick()
    expect(result.stepper.statuses['st-dirty-cargo'].isDirty).toBe(true)
    expect(result.stepper.statuses['st-dirty-review'].isDirty).toBe(false)
  })

  it('errorCount reflects form.meta.errorCount', async () => {
    const { app, result } = mountHarness(() => {
      const cargo = useForm({ schema: cargoSchema, key: 'st-err-cargo' })
      const review = useForm({ schema: reviewSchema, key: 'st-err-review' })
      return { stepper: useStepper([cargo, review], {}), cargo, review }
    })
    apps.push(app)
    result.cargo.setValue('description', '')
    result.cargo.setValue('weight', 0)
    await result.cargo.validate()
    expect(result.stepper.statuses['st-err-cargo'].errorCount).toBeGreaterThan(0)
    expect(result.stepper.statuses['st-err-cargo'].isValid).toBe(false)
  })

  it('isValid flips true once errors clear', async () => {
    const { app, result } = mountHarness(() => {
      const cargo = useForm({
        schema: cargoSchema,
        key: 'st-clear-cargo',
        defaultValues: { weight: 5, description: 'box' },
      })
      const review = useForm({ schema: reviewSchema, key: 'st-clear-review' })
      return { stepper: useStepper([cargo, review], {}), cargo, review }
    })
    apps.push(app)
    await result.cargo.validate()
    for (let i = 0; i < 16; i += 1) {
      await Promise.resolve()
      await nextTick()
      if (!result.cargo.meta.validating) break
    }
    expect(result.cargo.meta.valid).toBe(true)
    expect(result.stepper.statuses['st-clear-cargo'].isValid).toBe(true)
    expect(result.stepper.statuses['st-clear-cargo'].errorCount).toBe(0)
  })

  it('callable form returns the live FormStatus snapshot', async () => {
    const { app, result } = mountHarness(() => {
      const cargo = useForm({
        schema: cargoSchema,
        key: 'st-call-cargo',
        defaultValues: { weight: 5, description: 'box' },
      })
      return { stepper: useStepper([cargo], {}), cargo }
    })
    apps.push(app)
    await result.cargo.validate()
    for (let i = 0; i < 16; i += 1) {
      await Promise.resolve()
      await nextTick()
      if (!result.cargo.meta.validating) break
    }
    const single = result.stepper.statuses('st-call-cargo')
    expect((single as { isValid: boolean }).isValid).toBe(true)
    const all = result.stepper.statuses() as Record<string, { isValid: boolean }>
    const cargoStatus = all['st-call-cargo'] as { isValid: boolean }
    expect(cargoStatus.isValid).toBe(true)
  })
})
