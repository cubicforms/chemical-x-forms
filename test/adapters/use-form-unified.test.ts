// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, createApp, type App } from 'vue'
import { z as z4 } from 'zod'
import { z as z3 } from 'zod-v3'

import { useForm } from '../../src/zod'

/**
 * The unified `attaform/zod` entry runs only when the `attaform/vite`
 * plugin's build-time alias is bypassed (other bundlers, or the
 * plugin disabled). It dispatches on the schema's runtime shape.
 *
 * v4 schemas (`def.type` truthy) take the v4 codepath; v3 schemas
 * (`_def.typeName` truthy without `def.type`) take the v3 codepath.
 */

const mountedHosts: HTMLElement[] = []
const mountedApps: App[] = []

function mountWithSetup(setup: () => unknown): { app: App } {
  const Probe = defineComponent({
    setup,
    render: () => h('div'),
  })
  const app = createApp(Probe)
  const host = document.createElement('div')
  app.mount(host)
  mountedHosts.push(host)
  mountedApps.push(app)
  return { app }
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  for (const host of mountedHosts.splice(0)) host.remove()
})

describe('attaform/zod — unified entry runtime dispatch', () => {
  it('routes a Zod v4 schema through the v4 adapter (parses v4-only output)', () => {
    let captured: unknown
    mountWithSetup(() => {
      // z4.email() is a v4-only refinement constructor. Routing through
      // the v3 wrapper would fail to validate `'a@b.co'` correctly
      // because v3 doesn't recognise the v4 schema's internal layout.
      const form = useForm({
        schema: z4.object({ email: z4.email() }),
        defaultValues: { email: 'a@b.co' },
        key: 'unified-v4',
      })
      captured = form.values.email
    })
    expect(captured).toBe('a@b.co')
  })

  it('routes a Zod v3 schema through the v3 wrapper (parses v3 input)', () => {
    let captured: unknown
    mountWithSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const form = (useForm as any)({
        schema: z3.object({ name: z3.string() }),
        defaultValues: { name: 'hello' },
        key: 'unified-v3',
      })
      captured = form.values.name
    })
    expect(captured).toBe('hello')
  })

  it('throws InvalidUseFormConfigError for invalid configurations', () => {
    let outcome: 'threw' | 'no-throw' = 'no-throw'
    mountWithSetup(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(useForm as any)({ schema: undefined })
      } catch {
        outcome = 'threw'
      }
    })
    expect(outcome).toBe('threw')
  })
})
