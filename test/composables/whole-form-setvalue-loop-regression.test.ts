// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, watch, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Regression: whole-form `setValue((v) => ({ ...v }))` fired from inside
 * a deep watch on a sibling subtree must NOT loop.
 *
 * Real-world repro: a "same as pickup" toggle on a shipping form mirrors
 * pickup → delivery. The watch tracks `[useSameDeliveryAddress, pickup]`
 * (deep) and calls `form.setValue((v) => ({ ...v, delivery: v.pickup }))`
 * inside the handler.
 *
 * Pre-fix bug: `walkUnsetSentinels` (in the setValue pipeline) deep-cloned
 * every nested object/array unconditionally, even when no unset substitution
 * happened. So the new whole-form value always had a fresh `pickup`
 * reference; Vue's deep watch saw pickup as changed; the handler re-fired;
 * the handler called setValue again; ∞. Browser tab freeze.
 *
 * Fix: walkUnsetSentinels now returns the original input reference when no
 * descendant changed (matching the reference-stable contract that
 * `mergeStructural` already provided). The watch sees pickup as
 * reference-equal across the setValue and stops firing.
 */

const schema = z.object({
  reference: z.string(),
  pickup: z.object({
    line1: z.string(),
    city: z.string(),
  }),
  delivery: z.object({
    line1: z.string(),
    city: z.string(),
  }),
})

type Api = ReturnType<typeof useForm<typeof schema>>

function mount(): { app: App; api: Api } {
  let captured: Api | undefined
  const App = defineComponent({
    setup() {
      captured = useForm({
        schema,
        key: `whole-form-setvalue-loop-${Math.random().toString(36).slice(2)}`,
        defaultValues: {
          reference: 'SHP-100001',
          pickup: { line1: '1 Main St', city: 'NYC' },
          delivery: { line1: '999 Far Rd', city: 'LA' },
        },
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  app.mount(document.createElement('div'))
  return { app, api: captured as Api }
}

describe('whole-form setValue from inside a deep watch', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does not infinite-loop when the watched subtree is unchanged by the write', async () => {
    const { app, api } = mount()
    apps.push(app)

    let handlerFires = 0
    const stop = watch(
      () => api.values.pickup,
      () => {
        handlerFires++
        // Bound the runaway: if the loop reappears, fail the test
        // before the browser would freeze rather than time out.
        if (handlerFires > 50) {
          throw new Error('infinite loop detected — handler fired >50 times')
        }
        api.setValue((v) => ({ ...v, delivery: v.pickup }))
      },
      { deep: true }
    )

    api.setValue('pickup.line1', '2 Park Ave')
    await nextTick()
    await nextTick()

    // Exactly one handler fire: pickup.line1 changed → watch fires →
    // setValue mirrors pickup into delivery without disturbing pickup's
    // own reactive subtree, so no re-fire.
    expect(handlerFires).toBeLessThanOrEqual(2)
    expect(api.values.delivery).toEqual(api.values.pickup)

    stop()
  })

  it('does not infinite-loop using PATH-FORM setValue inside a deep pickup watch', async () => {
    const { app, api } = mount()
    apps.push(app)

    let handlerFires = 0
    const stop = watch(
      () => api.values.pickup,
      () => {
        handlerFires++
        if (handlerFires > 50) {
          throw new Error('infinite loop detected — handler fired >50 times')
        }
        // Path-form setValue at the sibling — does this loop?
        api.setValue('delivery', { ...api.values.pickup })
      },
      { deep: true }
    )

    api.setValue('pickup.city', 'Boston')
    await nextTick()
    await nextTick()
    expect(api.values.delivery.city).toBe('Boston')
    expect(handlerFires).toBeLessThanOrEqual(2)

    stop()
  })
})
