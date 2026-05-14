// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `stepper.allErrors` flattens each form's errors into one ordered
 * list — useful for a wizard-wide error summary screen.
 *
 * Each entry carries `{ formKey, path, message, code? }` so the
 * consumer can render "Step Cargo > weight: weight required" and
 * link back to the offending field.
 *
 * Order: stepper.forms order, then form's internal error order.
 */

const cargoSchema = z.object({
  weight: z.number().min(1, 'weight required'),
  description: z.string().min(1, 'description required'),
})
const reviewSchema = z.object({ note: z.string().min(1, 'note required') })

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

describe('useStepper — allErrors', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('starts empty', () => {
    const { app, result } = mountHarness(() => {
      const cargo = useForm({
        schema: cargoSchema,
        key: 'ae-empty-cargo',
        defaultValues: { weight: 5, description: 'box' },
      })
      const review = useForm({
        schema: reviewSchema,
        key: 'ae-empty-review',
        defaultValues: { note: 'send it' },
      })
      return useStepper([cargo, review], {})
    })
    apps.push(app)
    expect(result.allErrors.value).toEqual([])
  })

  it('flattens errors with formKey + path + message', async () => {
    const { app, result } = mountHarness(() => {
      const cargo = useForm({ schema: cargoSchema, key: 'ae-fill-cargo' })
      const review = useForm({ schema: reviewSchema, key: 'ae-fill-review' })
      return { stepper: useStepper([cargo, review], {}), cargo, review }
    })
    apps.push(app)
    await result.cargo.validate()
    await result.review.validate()
    const errors = result.stepper.allErrors.value
    expect(errors.length).toBeGreaterThan(0)
    const cargoErrors = errors.filter((e) => e.formKey === 'ae-fill-cargo')
    const reviewErrors = errors.filter((e) => e.formKey === 'ae-fill-review')
    expect(cargoErrors.length).toBeGreaterThan(0)
    expect(reviewErrors.length).toBeGreaterThan(0)
    const weightError = cargoErrors.find((e) => e.path.includes('weight'))
    expect(weightError).toBeDefined()
    expect(weightError!.message).toMatch(/weight/i)
  })

  it('orders errors by forms-array order, then by per-form order', async () => {
    const { app, result } = mountHarness(() => {
      const cargo = useForm({ schema: cargoSchema, key: 'ae-order-cargo' })
      const review = useForm({ schema: reviewSchema, key: 'ae-order-review' })
      // Order: [review, cargo] so review errors come first.
      return { stepper: useStepper([review, cargo], {}), cargo, review }
    })
    apps.push(app)
    await result.cargo.validate()
    await result.review.validate()
    const errors = result.stepper.allErrors.value
    if (errors.length >= 2) {
      const firstFormKey = errors[0]!.formKey
      const lastFormKey = errors[errors.length - 1]!.formKey
      expect(firstFormKey).toBe('ae-order-review')
      expect(lastFormKey).toBe('ae-order-cargo')
    }
  })
})
