// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useStepper } from '../../src/runtime/composables/use-stepper'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `getServerActiveStep()` is the framework-agnostic SSR active-step
 * source. The consumer reads route state from their framework
 * (vue-router, Nuxt route, custom) and returns the active step key.
 * The stepper uses the return value to seed `current.value` BEFORE
 * any form-store settle microtask fires, so the active step's
 * `onServerPrefetch` runs and non-active steps stay deferred.
 *
 * Priority order for initial step selection:
 *   1. `getServerActiveStep()` if it returns a known key.
 *   2. URL `?step=<knownKey>` via the history primitive.
 *   3. `forms[0]` fallback.
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

describe('useStepper — getServerActiveStep', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a known key from the getter seeds initial current', () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'gs-known-a' })
      const b = useForm({ schema: schemaB, key: 'gs-known-b' })
      const c = useForm({ schema: schemaC, key: 'gs-known-c' })
      return useStepper([a, b, c], {
        getServerActiveStep: () => 'gs-known-b',
      })
    })
    apps.push(app)
    expect(result.current.value).toBe('gs-known-b')
  })

  it('an unknown key from the getter falls through to forms[0]', () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'gs-unk-a' })
      const b = useForm({ schema: schemaB, key: 'gs-unk-b' })
      // Cast to bypass the literal-narrow getter type — simulates a
      // stale URL value reaching the getter. Runtime fallback should
      // catch it.
      return useStepper([a, b], {
        getServerActiveStep: (() => 'gs-unk-zzz') as unknown as () =>
          | 'gs-unk-a'
          | 'gs-unk-b'
          | undefined,
      })
    })
    apps.push(app)
    expect(result.current.value).toBe('gs-unk-a')
  })

  it('undefined return falls through to URL/forms[0]', () => {
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'gs-undef-a' })
      const b = useForm({ schema: schemaB, key: 'gs-undef-b' })
      return useStepper([a, b], {
        getServerActiveStep: () => undefined,
      })
    })
    apps.push(app)
    expect(result.current.value).toBe('gs-undef-a')
  })

  it('getter takes priority over `?step=` URL param when both name known keys', () => {
    window.history.replaceState(null, '', 'http://localhost:3000/wizard?step=gs-prio-b')
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'gs-prio-a' })
      const b = useForm({ schema: schemaB, key: 'gs-prio-b' })
      const c = useForm({ schema: schemaC, key: 'gs-prio-c' })
      return useStepper([a, b, c], {
        getServerActiveStep: () => 'gs-prio-c',
      })
    })
    apps.push(app)
    expect(result.current.value).toBe('gs-prio-c')
  })

  it('the chosen step is the current claim in the stepper registry', () => {
    // The deferral lifecycle is driven by `stepperRegistry.claim(key,
    // isCurrent)`. If the getter's choice doesn't get the current
    // claim, its async factory would be deferred and never fire on
    // server. We assert the right step gets the current claim by
    // checking that `next()` from the seeded step lands on the
    // following form in the array — proving the seeded step is the
    // active one in the registry's view.
    const { app, result } = mountHarness(() => {
      const a = useForm({ schema: schemaA, key: 'gs-claim-a' })
      const b = useForm({ schema: schemaB, key: 'gs-claim-b' })
      const c = useForm({ schema: schemaC, key: 'gs-claim-c' })
      return useStepper([a, b, c], {
        getServerActiveStep: () => 'gs-claim-b',
      })
    })
    apps.push(app)
    expect(result.current.value).toBe('gs-claim-b')
    result.next()
    expect(result.current.value).toBe('gs-claim-c')
    result.back()
    result.back()
    expect(result.current.value).toBe('gs-claim-a')
  })
})
