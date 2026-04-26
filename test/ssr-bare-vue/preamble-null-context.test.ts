import { baseCompile } from '@vue/compiler-core'
import { renderToString } from '@vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { createSSRApp, defineComponent } from 'vue'
import { useFormContext } from '../../src'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { vRegisterHintTransform } from '../../src/runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from '../../src/runtime/lib/core/transforms/v-register-preamble-transform'

/**
 * SSR null-safety for the v-register preamble.
 *
 * The preamble transform hoists every captured `v-register` expression
 * to a `:data-cx-pre-mark` directive on the first root element so the
 * mark fires before any descendant template expression evaluates.
 * That hoist runs unconditionally — a `v-if` guard on the input itself
 * fires LATER in render order, so a nullable `useFormContext()`
 * return that the consumer guarded around the input would still
 * dereference null in the preamble.
 *
 * Each preamble entry is therefore wrapped in a try/catch IIFE: if the
 * underlying expression throws (e.g. `null.register('foo')`), the
 * catch absorbs it and the rest of the preamble + the surrounding
 * render still proceeds. Documented contract on the transform is
 * "best-effort optimisation"; the catch encodes that.
 *
 * These tests prove the encoding holds end-to-end through
 * @vue/server-renderer with realistic v-if + null-context shapes.
 */

type Form = { name: string }

function compileTemplate(template: string): (this: unknown, ctx: unknown) => unknown {
  const result = baseCompile(template, {
    nodeTransforms: [vRegisterPreambleTransform, vRegisterHintTransform],
    mode: 'function',
    prefixIdentifiers: true,
    hoistStatic: false,
  })
  const fn = new Function('Vue', `${result.code}\nreturn render`)
  return fn(Vue) as (this: unknown, ctx: unknown) => unknown
}

describe('SSR preamble null-safety', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('SSR does not throw when an input is gated by v-if against a null useFormContext', async () => {
    // Mirror the spike pattern: <SpikeCxChild form-key="totally-fake" />
    // resolves to null; the input is wrapped in v-if="ctx" so the v-if
    // branch never runs, but the preamble's hoisted call would still
    // try `ctx.register(...)` on null without the try/catch fix.
    const render = compileTemplate(
      `<div>
         <p>before</p>
         <input v-if="ctx" v-register="ctx.register('name')" />
         <p>after</p>
       </div>`
    )
    const App = defineComponent({
      setup() {
        const ctx = useFormContext<Form>('this-key-was-never-registered')
        return { ctx }
      },
      render,
    })
    const app = createSSRApp(App)
    app.use(createChemicalXForms({ override: true }))

    // The catchable failure mode pre-fix was an unhandled rejection
    // bubbling out of `_sfc_ssrRender`. If that ever returns, this
    // resolves to a thrown Error and the test fails noisily.
    const html = await renderToString(app)
    expect(html).toContain('before')
    expect(html).toContain('after')
    // The v-if guard meant the input never entered the rendered tree.
    expect(html).not.toContain('<input')
  })

  it('SSR continues evaluating later preamble entries even when an earlier one throws', async () => {
    // Two v-register sites in one template: the first against a null
    // context, the second against a (parent-provided) form context. The
    // try/catch must absorb the first throw without preventing the
    // second mark from firing — the per-entry isolation is the whole
    // point of wrapping each call individually rather than the whole
    // chain in one try.
    //
    // We don't introspect the field record here (that's covered by
    // optimistic-is-connected.test.ts); the load-bearing assertion is
    // that renderToString completes and the surrounding HTML renders.
    const render = compileTemplate(
      `<div>
         <input v-if="bad" v-register="bad.register('name')" />
         <input v-register="good.register('name')" />
       </div>`
    )
    const App = defineComponent({
      setup() {
        return {
          bad: useFormContext<Form>('totally-fake'),
          good: { register: () => ({ markConnectedOptimistically: () => undefined }) },
        }
      },
      render,
    })
    const app = createSSRApp(App)
    app.use(createChemicalXForms({ override: true }))

    const html = await renderToString(app)
    expect(html).toContain('<input')
  })
})
