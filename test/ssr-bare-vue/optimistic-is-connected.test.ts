import { baseCompile } from '@vue/compiler-core'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { createSSRApp, defineComponent } from 'vue'
import { useForm } from '../../src'
import { createAttaform } from '../../src/runtime/core/plugin'
import { getRegistryFromApp } from '../../src/runtime/core/registry'
import { renderAttaformState } from '../../src/runtime/core/serialize'
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

type TransformMode = 'none' | 'hint-only' | 'preamble+hint'

function compileTemplate(
  template: string,
  mode: TransformMode
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

function makeAppWithTemplate(template: string, mode: TransformMode) {
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
  app.use(createAttaform({ override: true /* SSR */ }))
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
    app.use(createAttaform({ override: true }))
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
    const payload = renderAttaformState(app)
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
      <span class="readout">{{ JSON.stringify(form.fields.password) }}</span>
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
      <span class="readout">{{ JSON.stringify(form.fields.password) }}</span>
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

  it('the data-atta-pre-mark attribute is dropped from the output (undefined → no attr)', async () => {
    // The preamble's binding evaluates to undefined so Vue's SSR
    // renderer omits the attribute. The user-visible HTML is unchanged
    // — only the side effects of evaluating the binding (the marks)
    // remain.
    const template = `<div><input v-register="form.register('password')" /></div>`
    const app = makeAppWithTemplate(template, 'preamble+hint')
    const html = await renderToString(app)
    expect(html).not.toContain('data-atta-pre-mark')
  })
})

describe('SSR isConnected — fields the template never binds', () => {
  it('a schema field with no matching v-register stays isConnected: false', async () => {
    // The schema declares both `email` and `password`, but the
    // template only renders `<input v-register="form.register('email')">`.
    // The transforms (preamble + hint) have NO way to know about
    // `password` — there's no binding to capture, no IIFE to evaluate.
    // Result: email is optimistically marked, password is correctly
    // left at its init-time `false`.
    //
    // Why this matters: marking a path as connected when no DOM
    // element will ever back it is a lie. A later read of
    // `getFieldState('password').isConnected` would mislead a
    // consumer into thinking the field is rendered when it isn't.
    const template = `<div>
      <input v-register="form.register('email')" />
    </div>`
    const app = makeAppWithTemplate(template, 'preamble+hint')
    await renderToString(app)
    const registry = getRegistryFromApp(app)
    const state = registry.forms.get('connected-test')
    expect(state).toBeDefined()
    if (state === undefined) return
    expect(state.getFieldRecord(['email'])?.isConnected).toBe(true)
    expect(state.getFieldRecord(['password'])?.isConnected).toBe(false)
  })
})

describe('SSR isConnected — cross-component sync via shared form key', () => {
  /**
   * Two sibling components consume the same FormStore by key. One
   * binds a field via `v-register`; the other reads `getFieldState`
   * for that field. The optimistic mark fires on the SHARED store
   * during the writer's render, and the reader's render — happening
   * later in template-traversal order — sees the marked state.
   *
   * This is the proof that attaform's by-key sharing semantics actually
   * round-trip the optimistic mark correctly: the FormStore
   * registered under `key: 'shared'` is one object across every
   * `useForm` / `injectForm` consumer in the app, so any mark
   * fired by one consumer is visible to every other.
   *
   * Render-order caveat: Vue's SSR is single-pass top-to-bottom, so
   * if the parent template rendered the reader BEFORE the writer,
   * the reader's read would happen against an unmarked store. That's
   * the same render-order limitation the preamble transform fixes
   * within a SINGLE template — across components it's still up to
   * the parent to render the writer first. We use that order here
   * (writer → reader) because it's the natural composition.
   */
  it('reader sees isConnected: true when writer is rendered first under the same form key', async () => {
    type SharedForm = { email: string; password: string }
    const sharedSchema = () => fakeSchema<SharedForm>({ email: '', password: '' })
    const SHARED_KEY = 'shared-form'

    const writerRender = compileTemplate(
      `<div><input v-register="form.register('email')" /></div>`,
      'preamble+hint'
    )
    const Writer = defineComponent({
      name: 'Writer',
      setup() {
        const form = useForm<SharedForm>({ schema: sharedSchema(), key: SHARED_KEY })
        return { form }
      },
      render: writerRender,
    })

    const readerRender = compileTemplate(
      `<div class="reader">{{ JSON.stringify(form.fields.email) }}</div>`,
      'preamble+hint'
    )
    const Reader = defineComponent({
      name: 'Reader',
      setup() {
        // Same key → useForm returns the existing FormStore. The
        // schema fingerprint matches (factory returns an equivalent
        // shape) so no warning fires.
        const form = useForm<SharedForm>({ schema: sharedSchema(), key: SHARED_KEY })
        return { form }
      },
      render: readerRender,
    })

    const Parent = defineComponent({
      name: 'Parent',
      components: { Writer, Reader },
      setup() {
        return {}
      },
      // Render writer FIRST so its preamble has fired before the
      // reader's render evaluates getFieldState. Reverse order would
      // surface a stale `false` — that's a render-order limitation
      // across components, not a sync problem.
      render: compileTemplate(`<div><Writer /><Reader /></div>`, 'preamble+hint'),
    })
    const app = createSSRApp(Parent)
    app.use(createAttaform({ override: true }))

    const html = await renderToString(app)
    // Reader's div serialises the email field state. Both forms are
    // backed by the shared FormStore, so the writer's optimistic
    // mark is visible here.
    const readerMatch = html.match(/<div class="reader">([\s\S]*?)<\/div>/)
    expect(readerMatch).not.toBeNull()
    if (readerMatch === null) return
    const readerBody = readerMatch[1] ?? ''
    const containsTrue =
      readerBody.includes('"isConnected":true') || readerBody.includes('isConnected&quot;:true')
    expect(containsTrue).toBe(true)

    // Both consumers point at the same FormStore — a single registry
    // entry under SHARED_KEY, with email marked.
    const registry = getRegistryFromApp(app)
    expect(registry.forms.size).toBe(1)
    const state = registry.forms.get(SHARED_KEY)
    expect(state?.getFieldRecord(['email'])?.isConnected).toBe(true)
    // Password is in the schema but never bound — stays false (and
    // both Writer and Reader observe the same false here, because
    // there's only one store).
    expect(state?.getFieldRecord(['password'])?.isConnected).toBe(false)
  })

  /**
   * Case A: a sibling component does setup-only `register('email')`
   * (no template binding) AND another sibling has the v-register
   * binding. Sharing a form key means there's exactly one
   * FormStore; the binding sibling's preamble fires the mark on the
   * shared store, and the setup-only sibling — even though IT
   * never called the optimistic mark itself — observes
   * `isConnected: true`. This is the "implicit cross-component
   * acknowledgement" working as the user intuited: not because
   * setup-only register() has any opinion of its own, but because
   * the store is genuinely shared and someone else established
   * the DOM presence.
   */
  it('Case A: setup-only register() in one SFC sees isConnected: true when a sibling SFC v-registers the same path', async () => {
    type SharedForm = { email: string }
    const sharedSchema = () => fakeSchema<SharedForm>({ email: '' })
    const SHARED_KEY = 'case-a-shared'

    // Sibling 1: v-registers email in its template (the "real"
    // binding — its preamble fires the mark on the shared store).
    const Binder = defineComponent({
      name: 'Binder',
      setup() {
        const form = useForm<SharedForm>({ schema: sharedSchema(), key: SHARED_KEY })
        return { form }
      },
      render: compileTemplate(
        `<div><input v-register="form.register('email')" /></div>`,
        'preamble+hint'
      ),
    })

    // Sibling 2: calls `register('email')` from setup (creates a
    // RegisterValue) and reads getFieldState in its template, but
    // never binds via v-register. With cross-component store
    // sharing, this sibling's read of `isConnected` reflects the
    // OTHER sibling's binding state.
    const SetupOnlyReader = defineComponent({
      name: 'SetupOnlyReader',
      setup() {
        const form = useForm<SharedForm>({ schema: sharedSchema(), key: SHARED_KEY })
        // Setup-only register call. On its own this does NOT mark
        // anything (it just constructs a RegisterValue closure). But
        // because the Binder sibling's preamble already fired the
        // mark on the shared store, when the template below reads
        // getFieldState, it observes the marked value.
        form.register('email')
        return { form }
      },
      render: compileTemplate(
        `<div class="setup-only-reader">{{ JSON.stringify(form.fields.email) }}</div>`,
        'preamble+hint'
      ),
    })

    const Parent = defineComponent({
      name: 'Parent',
      components: { Binder, SetupOnlyReader },
      setup() {
        return {}
      },
      // Binder must render first so its preamble has fired before
      // SetupOnlyReader's getFieldState evaluates.
      render: compileTemplate(`<div><Binder /><SetupOnlyReader /></div>`, 'preamble+hint'),
    })
    const app = createSSRApp(Parent)
    app.use(createAttaform({ override: true }))

    const html = await renderToString(app)
    const readerMatch = html.match(/<div class="setup-only-reader">([\s\S]*?)<\/div>/)
    expect(readerMatch).not.toBeNull()
    if (readerMatch === null) return
    const readerBody = readerMatch[1] ?? ''
    const containsTrue =
      readerBody.includes('"isConnected":true') || readerBody.includes('isConnected&quot;:true')
    expect(containsTrue).toBe(true)

    // One shared store, mark recorded once on it.
    const registry = getRegistryFromApp(app)
    expect(registry.forms.size).toBe(1)
    const state = registry.forms.get(SHARED_KEY)
    expect(state?.getFieldRecord(['email'])?.isConnected).toBe(true)
  })

  /**
   * Case B: every SFC that touches the path uses setup-only
   * `register()`, and NOT ONE binds via v-register. There's no DOM
   * element anywhere — `isConnected: true` would be a lie. Multiple
   * components agreeing in setup doesn't add up to a real DOM
   * presence; the flag has to stay `false`.
   *
   * This guards the invariant that `markConnectedOptimistically`
   * only fires from the AST-visible v-register binding path. If a
   * future change starts marking on `register()` invocation
   * (the path that was tempting in early design discussions),
   * this test would catch the regression.
   */
  it('Case B: multiple SFCs all calling setup-only register() with no template binding stays isConnected: false', async () => {
    type SharedForm = { email: string }
    const sharedSchema = () => fakeSchema<SharedForm>({ email: '' })
    const SHARED_KEY = 'case-b-shared'

    const SetupOnlyA = defineComponent({
      name: 'SetupOnlyA',
      setup() {
        const form = useForm<SharedForm>({ schema: sharedSchema(), key: SHARED_KEY })
        form.register('email')
        return { form }
      },
      render: compileTemplate(`<div class="a">A</div>`, 'preamble+hint'),
    })

    const SetupOnlyB = defineComponent({
      name: 'SetupOnlyB',
      setup() {
        const form = useForm<SharedForm>({ schema: sharedSchema(), key: SHARED_KEY })
        form.register('email')
        return { form }
      },
      render: compileTemplate(`<div class="b">B</div>`, 'preamble+hint'),
    })

    // Reader reads the shared store's email field — should observe
    // `isConnected: false` because nobody v-registered it.
    const Reader = defineComponent({
      name: 'Reader',
      setup() {
        const form = useForm<SharedForm>({ schema: sharedSchema(), key: SHARED_KEY })
        return { form }
      },
      render: compileTemplate(
        `<div class="case-b-reader">{{ JSON.stringify(form.fields.email) }}</div>`,
        'preamble+hint'
      ),
    })

    const Parent = defineComponent({
      name: 'Parent',
      components: { SetupOnlyA, SetupOnlyB, Reader },
      setup() {
        return {}
      },
      render: compileTemplate(`<div><SetupOnlyA /><SetupOnlyB /><Reader /></div>`, 'preamble+hint'),
    })
    const app = createSSRApp(Parent)
    app.use(createAttaform({ override: true }))

    const html = await renderToString(app)
    const readerMatch = html.match(/<div class="case-b-reader">([\s\S]*?)<\/div>/)
    expect(readerMatch).not.toBeNull()
    if (readerMatch === null) return
    const readerBody = readerMatch[1] ?? ''
    const containsFalse =
      readerBody.includes('"isConnected":false') || readerBody.includes('isConnected&quot;:false')
    expect(containsFalse).toBe(true)

    // Direct assertion on the shared store: no marker fired, flag
    // stays at the init-time default. This is the canonical "no
    // implicit registration" invariant.
    const registry = getRegistryFromApp(app)
    expect(registry.forms.size).toBe(1)
    const state = registry.forms.get(SHARED_KEY)
    expect(state?.getFieldRecord(['email'])?.isConnected).toBe(false)
  })
})
