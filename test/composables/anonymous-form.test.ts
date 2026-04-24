// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { useForm, useFormContext } from '../../src'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Semantic coverage for anonymous (key-less) forms.
 *
 * The post-0.8.3 contract treats `key` as optional and allocates a
 * synthetic `cx:anon:<id>` id via Vue's `useId()` when absent. That
 * shifts two behaviours relative to the old "key required" contract:
 *
 *   1. Two sibling `useForm({ schema })` calls no longer share
 *      state. Each call resolves to its own `cx:anon:` id and
 *      therefore its own FormState.
 *   2. Descendant-only access still works via ambient
 *      `useFormContext<F>()`, which resolves through `provide`/
 *      `inject` and doesn't touch the registry's key space.
 *   3. SSR/hydration remains deterministic because `useId()` is
 *      positional — the server and client trees allocate matching
 *      ids at the same tree location.
 */

type Form = { name: string }
const defaults: Form = { name: '' }

describe('anonymous useForm — independent state per setup call', () => {
  it('two sibling components get distinct FormStates', async () => {
    type Api = ReturnType<typeof useForm<Form>>
    const captured: { a?: Api; b?: Api } = {}

    const ChildA = defineComponent({
      setup() {
        captured.a = useForm<Form>({ schema: fakeSchema<Form>(defaults) })
        return () => h('div', 'a')
      },
    })
    const ChildB = defineComponent({
      setup() {
        captured.b = useForm<Form>({ schema: fakeSchema<Form>(defaults) })
        return () => h('div', 'b')
      },
    })
    const App = defineComponent({
      setup() {
        return () => h('div', [h(ChildA), h(ChildB)])
      },
    })

    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(captured.a?.key).not.toBe(captured.b?.key)
    expect(captured.a?.key).toMatch(/^cx:anon:/)
    expect(captured.b?.key).toMatch(/^cx:anon:/)

    // Writing to one form must not leak into the other.
    captured.a?.setValue('name', 'Alice')
    expect(captured.a?.getValue('name').value).toBe('Alice')
    expect(captured.b?.getValue('name').value).toBe('')

    app.unmount()
  })
})

describe('anonymous useForm — ambient useFormContext access', () => {
  it('descendant composable reads the same FormState via provide/inject', async () => {
    type Api = ReturnType<typeof useForm<Form>>
    const captured: { owner?: Api; consumer?: Api } = {}

    const Child = defineComponent({
      setup() {
        // Ambient mode — no key passed, resolves via `inject(kFormContext)`.
        captured.consumer = useFormContext<Form>()
        return () => h('span', 'child')
      },
    })
    const Parent = defineComponent({
      setup() {
        captured.owner = useForm<Form>({ schema: fakeSchema<Form>(defaults) })
        return () => h('div', [h(Child)])
      },
    })

    const app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    // Same synthetic key.
    expect(captured.consumer?.key).toBe(captured.owner?.key)

    // Writes land on the same form.
    captured.owner?.setValue('name', 'Bob')
    expect(captured.consumer?.getValue('name').value).toBe('Bob')

    app.unmount()
  })
})

describe('anonymous useForm — ambient-overwrite dev warning', () => {
  // Two useForm calls in the same component overwrite each other's
  // ambient provide (Vue's provide/inject semantics — last write
  // wins). Under the optional-key contract the path of least resistance
  // (two anonymous forms in one parent) hits this footgun, so the
  // runtime emits a dev-mode warning.
  //
  // The warning fires LAZILY from useFormContext<F>() (no key) — not
  // eagerly from useForm() — so components with multiple forms but no
  // keyless consumer stay quiet. The eager version spammed on dev /
  // spike pages that piled forms into one component intentionally.
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('stays quiet when a component calls useForm twice but no descendant consumes ambient', () => {
    // Two useForm calls + NO keyless useFormContext consumer = no warn.
    // This is the spike-page case: author knows what they're doing,
    // lib should not spam.
    const App = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        useForm({ schema: fakeSchema<Form>(defaults) })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).not.toHaveBeenCalled()

    app.unmount()
  })

  it('warns when a descendant reaches for ambient context against a duplicate-provide parent', () => {
    const Child = defineComponent({
      setup() {
        useFormContext<Form>()
        return () => h('span', 'child')
      },
    })
    const App = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        useForm({ schema: fakeSchema<Form>(defaults) })
        return () => h('div', [h(Child)])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '')
    expect(message).toContain('useFormContext<F>() (no key)')
    expect(message).toContain('useForm() was called at:')

    app.unmount()
  })

  it('lists source frames rather than synthetic cx:anon keys', () => {
    // The synthetic `cx:anon:<id>` keys carry no signal for authors —
    // they never typed them. The warning should show call sites (click-
    // through in DevTools) and stay silent about the anon-key space.
    const Child = defineComponent({
      setup() {
        useFormContext<Form>()
        return () => h('span', 'child')
      },
    })
    const App = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        useForm({ schema: fakeSchema<Form>(defaults) })
        useForm({ schema: fakeSchema<Form>(defaults) })
        return () => h('div', [h(Child)])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '')
    expect(message).not.toMatch(/cx:anon:/)
    // Three bullet lines, one per useForm() call.
    const bulletCount = (message.match(/^ {2}- /gm) ?? []).length
    expect(bulletCount).toBe(3)

    app.unmount()
  })

  it('surfaces user-supplied keys in the bullet list (anonymous ones show only source)', () => {
    // Named keys ARE useful — the fix for a named form is
    // `useFormContext('that-key')`, so we show it. Anonymous forms
    // only get their source frame.
    const Child = defineComponent({
      setup() {
        useFormContext<Form>()
        return () => h('span', 'child')
      },
    })
    const App = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        useForm({ schema: fakeSchema<Form>(defaults), key: 'my-named-form' })
        return () => h('div', [h(Child)])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '')
    expect(message).toContain('[key: "my-named-form"]')
    // Exactly one named-key annotation (the anonymous form has no [key: ...] suffix).
    const keyAnnotations = (message.match(/\[key: "/g) ?? []).length
    expect(keyAnnotations).toBe(1)

    app.unmount()
  })

  it('stays quiet when the ambient-provider only registered ONE form', () => {
    // Single useForm + keyless descendant consumer = intended ambient
    // usage; no warn.
    const Child = defineComponent({
      setup() {
        useFormContext<Form>()
        return () => h('span', 'child')
      },
    })
    const App = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        return () => h('div', [h(Child)])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).not.toHaveBeenCalled()

    app.unmount()
  })

  it('stays quiet when sibling components each call useForm once', () => {
    const ChildA = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        return () => h('span')
      },
    })
    const ChildB = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        return () => h('span')
      },
    })
    const App = defineComponent({
      setup() {
        return () => h('div', [h(ChildA), h(ChildB)])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).not.toHaveBeenCalled()

    app.unmount()
  })

  it('warns once, not twice, across SSR + client mount', async () => {
    // The prior eager-warn version recorded ambient provides on BOTH
    // the SSR pass and the client hydration pass, so every collision
    // fired twice in Nuxt dev. `recordAmbientProvide` now skips SSR;
    // only the client warn reaches devtools.
    const Child = defineComponent({
      setup() {
        useFormContext<Form>()
        return () => h('span', 'child')
      },
    })
    const App = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        useForm({ schema: fakeSchema<Form>(defaults) })
        return () => h('div', [h(Child)])
      },
    })

    const serverApp = createSSRApp(App)
    serverApp.use(createChemicalXForms({ override: true }))
    await renderToString(serverApp)

    expect(warnSpy).not.toHaveBeenCalled()

    const clientApp = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    clientApp.mount(root)

    expect(warnSpy).toHaveBeenCalledTimes(1)

    clientApp.unmount()
  })
})

describe('anonymous useForm — SSR determinism', () => {
  it('server and client mounts allocate the same synthetic key', async () => {
    type Api = ReturnType<typeof useForm<Form>>
    let serverApi: Api | undefined
    let clientApi: Api | undefined

    const App = (onCaptured: (api: Api) => void) =>
      defineComponent({
        setup() {
          const api = useForm<Form>({ schema: fakeSchema<Form>(defaults) })
          onCaptured(api)
          return () => h('div')
        },
      })

    // Server-side render — useId() draws from Vue's SSR id allocator.
    const serverApp = createSSRApp(App((api) => (serverApi = api)))
    serverApp.use(createChemicalXForms({ override: true }))
    await renderToString(serverApp)

    // Client-side mount of the same tree shape — useId() must match
    // what the server produced so hydration can find the registry
    // entry. We simulate the client by creating a fresh app (new
    // registry, fresh id allocator) and confirming the same position
    // resolves to the same id.
    const clientApp = createApp(App((api) => (clientApi = api))).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    clientApp.mount(root)

    expect(serverApi?.key).toBeDefined()
    expect(clientApi?.key).toBe(serverApi?.key)

    clientApp.unmount()
  })
})
