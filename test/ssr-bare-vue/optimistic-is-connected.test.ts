import { baseCompile } from '@vue/compiler-core'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { createSSRApp, defineComponent } from 'vue'
import { useForm } from '../../src'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { getRegistryFromApp } from '../../src/runtime/core/registry'
import { renderChemicalXState } from '../../src/runtime/core/serialize'
import { vRegisterHintTransform } from '../../src/runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from '../../src/runtime/lib/core/transforms/v-register-preamble-transform'
import { fakeSchema } from '../utils/fake-schema'

/**
 * End-to-end proof that the `vRegisterHintTransform` resolves the
 * SSR `isConnected` flicker. Compiles a real template through
 * @vue/compiler-core's `baseCompile` with the hint transform
 * registered, evaluates the resulting render function, mounts it
 * via createSSRApp, runs @vue/server-renderer over it, and asserts
 * that the FormStore's field record landed at `isConnected: true`
 * server-side — the same state that gets serialized into the
 * hydration payload and read by `getFieldState()` on the client's
 * first paint.
 *
 * Without the transform applied, the same template would leave
 * `isConnected: false` server-side (Vue skips directive lifecycle
 * during SSR), which is exactly the flicker we're closing.
 */

type Form = { email: string; password: string }

type CxTransformMode = 'none' | 'hint-only' | 'preamble+hint'

function compileTemplate(
  template: string,
  mode: CxTransformMode
): (this: unknown, ctx: unknown) => unknown {
  // baseCompile (compiler-core) is sufficient for our directive-only
  // templates — we don't need the DOM-specific transforms (class/style
  // normalisation, v-html, etc.) that @vue/compiler-dom layers on top.
  // mode: 'function' produces a `const { … } = Vue ... return function render(...)`
  // string we evaluate in a scope where Vue resolves to the runtime module.
  const transforms =
    mode === 'none'
      ? []
      : mode === 'hint-only'
        ? [vRegisterHintTransform]
        : [vRegisterPreambleTransform, vRegisterHintTransform]
  const result = baseCompile(template, {
    nodeTransforms: transforms,
    mode: 'function',
    prefixIdentifiers: true,
    hoistStatic: false,
  })
  const fn = new Function('Vue', `${result.code}\nreturn render`)
  return fn(Vue) as (this: unknown, ctx: unknown) => unknown
}

function makeAppWithTemplate(template: string, mode: CxTransformMode) {
  const render = compileTemplate(template, mode)
  const App = defineComponent({
    setup() {
      const form = useForm<Form>({
        schema: fakeSchema<Form>({ email: '', password: '' }),
        key: 'connected-test',
      })
      return { form }
    },
    render,
  })
  const app = createSSRApp(App)
  app.use(createChemicalXForms({ override: true /* SSR */ }))
  return app
}

describe('SSR isConnected via vRegisterHintTransform', () => {
  it('marks v-register-bound fields as isConnected: true server-side', async () => {
    const app = makeAppWithTemplate(
      `<div>
         <input v-register="form.register('email')" />
         <input v-register="form.register('password')" />
       </div>`,
      'hint-only'
    )
    await renderToString(app)
    const registry = getRegistryFromApp(app)
    const state = registry.forms.get('connected-test')
    expect(state).toBeDefined()
    if (state === undefined) return
    expect(state.getFieldRecord(['email'])?.isConnected).toBe(true)
    expect(state.getFieldRecord(['password'])?.isConnected).toBe(true)
  })

  it('without the transform, the same template leaves isConnected: false (regression baseline)', async () => {
    // This is the bug the transform fixes. If this test ever flips to
    // `true` without the transform, it means Vue started running
    // directive lifecycle in SSR and the transforms aren't load-bearing
    // anymore — at which point we can rip them out.
    const app = makeAppWithTemplate(
      `<div><input v-register="form.register('email')" /></div>`,
      'none'
    )
    await renderToString(app)
    const registry = getRegistryFromApp(app)
    const state = registry.forms.get('connected-test')
    expect(state?.getFieldRecord(['email'])?.isConnected).toBe(false)
  })

  it('paths register()ed in setup but not bound to v-register stay isConnected: false', async () => {
    // Negative case: a setup-only register() call (e.g. exploratory
    // code, devtools) doesn't render an element. The transform never
    // sees that call and the optimistic mark never fires — the field
    // record correctly reports "not connected" because there's no
    // DOM element to back the claim.
    const App = defineComponent({
      setup() {
        const form = useForm<Form>({
          schema: fakeSchema<Form>({ email: '', password: '' }),
          key: 'setup-only',
        })
        // Reach into register() but never bind it to v-register.
        form.register('email')
        return () => Vue.h('div', 'no inputs here')
      },
    })
    const app = createSSRApp(App)
    app.use(createChemicalXForms({ override: true }))
    await renderToString(app)
    const registry = getRegistryFromApp(app)
    const state = registry.forms.get('setup-only')
    expect(state?.getFieldRecord(['email'])?.isConnected).toBe(false)
  })

  it('isConnected survives serialize → JSON round-trip', async () => {
    // Last gate: the optimistic flag has to actually ride the
    // hydration payload. If it gets lost in serialize.ts, the client
    // will reset to false and the flicker comes back.
    const app = makeAppWithTemplate(
      `<div><input v-register="form.register('email')" /></div>`,
      'hint-only'
    )
    await renderToString(app)
    const payload = renderChemicalXState(app)
    const serialised = JSON.parse(JSON.stringify(payload)) as typeof payload
    const formEntry = serialised.forms.find(([k]) => k === 'connected-test')
    expect(formEntry).toBeDefined()
    if (formEntry === undefined) return
    const [, data] = formEntry
    type FieldRow = readonly [string, { readonly isConnected: boolean }]
    const emailField = (data.fields as ReadonlyArray<FieldRow>).find(([key]) =>
      key.includes('email')
    )
    expect(emailField).toBeDefined()
    expect(emailField?.[1].isConnected).toBe(true)
  })
})

describe('SSR isConnected — read-before-input (preamble) via both transforms', () => {
  /**
   * The hint transform alone fires marks at v-register evaluation
   * time. If a template reads `getFieldState(path)` BEFORE the bound
   * input renders (single-pass top-to-bottom SSR), the read still
   * captures `isConnected: false` — the user observes a `false → true`
   * flicker on hydration when the post-render steady state corrects.
   *
   * The preamble transform hoists the marks to the root element's
   * props, which Vue evaluates BEFORE recursing into children. With
   * both transforms registered, every static v-register-bound path
   * is `isConnected: true` before the first descendant template
   * expression runs.
   */
  it('serializes the read-before-input value as true with both transforms', async () => {
    // Component reads its own field's state via a setup-returned ref
    // (the ref reads getFieldState at render time). With the preamble,
    // by the time the render expression evaluates, the mark has fired.
    // We capture what the SSR-rendered HTML serialises by reading the
    // FormStore's record directly after renderToString — which is
    // exactly the state that gets serialised into the hydration
    // payload.
    const template = `<div>
      <span class="readout">{{ JSON.stringify(form.getFieldState('password').value) }}</span>
      <input v-register="form.register('password')" />
    </div>`
    const app = makeAppWithTemplate(template, 'preamble+hint')
    const html = await renderToString(app)
    // The text inside <span> goes through Vue's HTML escaping, so the
    // JSON's quotes are entity-encoded. Match against either form to
    // stay robust if Vue ever changes the escape policy.
    const containsTrue =
      html.includes('"isConnected":true') || html.includes('isConnected&quot;:true')
    const containsFalse =
      html.includes('"isConnected":false') || html.includes('isConnected&quot;:false')
    expect(containsTrue).toBe(true)
    expect(containsFalse).toBe(false)
  })

  it('without the preamble, the same template serialises false in the read-before-input span', async () => {
    // Regression baseline: this is the flicker case the preamble
    // fixes. Hint-only correctly marks the field by render-end, but
    // an expression that reads the field state earlier in the
    // top-to-bottom render pass captures the still-false value.
    const template = `<div>
      <span class="readout">{{ JSON.stringify(form.getFieldState('password').value) }}</span>
      <input v-register="form.register('password')" />
    </div>`
    const app = makeAppWithTemplate(template, 'hint-only')
    const html = await renderToString(app)
    // The readout span captures the field BEFORE the input below
    // renders, so without the preamble it serialises false.
    const containsFalse =
      html.includes('"isConnected":false') || html.includes('isConnected&quot;:false')
    expect(containsFalse).toBe(true)
  })

  it('the data-cx-pre-mark attribute is dropped from the output (undefined → no attr)', async () => {
    // The preamble's binding evaluates to undefined so Vue's SSR
    // renderer omits the attribute. The user-visible HTML is unchanged
    // — only the side effects of evaluating the binding (the marks)
    // remain.
    const template = `<div><input v-register="form.register('password')" /></div>`
    const app = makeAppWithTemplate(template, 'preamble+hint')
    const html = await renderToString(app)
    expect(html).not.toContain('data-cx-pre-mark')
  })
})
