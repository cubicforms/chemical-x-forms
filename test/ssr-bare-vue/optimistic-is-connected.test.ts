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

function compileTemplate(
  template: string,
  withHintTransform: boolean
): (this: unknown, ctx: unknown) => unknown {
  // baseCompile (compiler-core) is sufficient for our directive-only
  // templates — we don't need the DOM-specific transforms (class/style
  // normalisation, v-html, etc.) that @vue/compiler-dom layers on top.
  // mode: 'function' produces a `const { … } = Vue ... return function render(...)`
  // string we evaluate in a scope where Vue resolves to the runtime module.
  const result = baseCompile(template, {
    nodeTransforms: withHintTransform ? [vRegisterHintTransform] : [],
    mode: 'function',
    prefixIdentifiers: true,
    hoistStatic: false,
  })
  const fn = new Function('Vue', `${result.code}\nreturn render`)
  return fn(Vue) as (this: unknown, ctx: unknown) => unknown
}

function makeAppWithTemplate(template: string, withHintTransform: boolean) {
  const render = compileTemplate(template, withHintTransform)
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
      /* withHintTransform */ true
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
    // directive lifecycle in SSR and the transform isn't load-bearing
    // anymore — at which point we can rip it out.
    const app = makeAppWithTemplate(
      `<div><input v-register="form.register('email')" /></div>`,
      /* withHintTransform */ false
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
      /* withHintTransform */ true
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
