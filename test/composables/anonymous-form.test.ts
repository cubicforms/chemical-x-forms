// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { useForm, injectForm } from '../../src'
import { ANONYMOUS_FORM_KEY_PREFIX, RESERVED_KEY_PREFIX } from '../../src/runtime/core/defaults'
import { ReservedFormKeyError } from '../../src/runtime/core/errors'
import { createDecant } from '../../src/runtime/core/plugin'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Semantic coverage for anonymous (key-less) forms.
 *
 * The post-0.8.3 contract treats `key` as optional and allocates a
 * synthetic `__cx:anon:<id>` id via Vue's `useId()` when absent. That
 * shifts two behaviours relative to the old "key required" contract:
 *
 *   1. Two sibling `useForm({ schema })` calls no longer share
 *      state. Each call resolves to its own `__cx:anon:` id and
 *      therefore its own FormStore.
 *   2. Descendant-only access still works via ambient
 *      `injectForm<F>()`, which resolves through `provide`/
 *      `inject` and doesn't touch the registry's key space.
 *   3. SSR/hydration remains deterministic because `useId()` is
 *      positional — the server and client trees allocate matching
 *      ids at the same tree location.
 */

type Form = { name: string }
const defaults: Form = { name: '' }

describe('anonymous useForm — independent state per setup call', () => {
  it('two sibling components get distinct FormStores', async () => {
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

    const app = createApp(App).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(captured.a?.key).not.toBe(captured.b?.key)
    expect(captured.a?.key.startsWith(ANONYMOUS_FORM_KEY_PREFIX)).toBe(true)
    expect(captured.b?.key.startsWith(ANONYMOUS_FORM_KEY_PREFIX)).toBe(true)

    // Writing to one form must not leak into the other.
    captured.a?.setValue('name', 'Alice')
    expect(captured.a?.values.name).toBe('Alice')
    expect(captured.b?.values.name).toBe('')

    app.unmount()
  })
})

describe('anonymous useForm — ambient injectForm access', () => {
  it('descendant composable reads the same FormStore via provide/inject', async () => {
    type Api = ReturnType<typeof useForm<Form>>
    const captured: { owner?: Api; consumer?: Api | null } = {}

    const Child = defineComponent({
      setup() {
        // Ambient mode — no key passed, resolves via `inject(kFormContext)`.
        captured.consumer = injectForm<Form>()
        return () => h('span', 'child')
      },
    })
    const Parent = defineComponent({
      setup() {
        captured.owner = useForm<Form>({ schema: fakeSchema<Form>(defaults) })
        return () => h('div', [h(Child)])
      },
    })

    const app = createApp(Parent).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    // Same synthetic key.
    expect(captured.consumer?.key).toBe(captured.owner?.key)

    // Writes land on the same form.
    captured.owner?.setValue('name', 'Bob')
    expect(captured.consumer?.values.name).toBe('Bob')

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
  // The warning fires LAZILY from injectForm<F>() (no key) — not
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
    // Two useForm calls + NO keyless injectForm consumer = no warn.
    // This is the spike-page case: author knows what they're doing,
    // lib should not spam.
    const App = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        useForm({ schema: fakeSchema<Form>(defaults) })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).not.toHaveBeenCalled()

    app.unmount()
  })

  it('warns when a descendant reaches for ambient context against a duplicate-provide parent', () => {
    const Child = defineComponent({
      setup() {
        injectForm<Form>()
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
    const app = createApp(App).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '')
    expect(message).toContain('injectForm<F>() (no key)')
    expect(message).toContain('multiple anonymous useForm() calls')

    app.unmount()
  })

  it('lists source frames rather than synthetic cx:anon keys', () => {
    // The synthetic `__cx:anon:<id>` keys carry no signal for authors —
    // they never typed them. The warning should show call sites (click-
    // through in DevTools) and stay silent about the anon-key space.
    const Child = defineComponent({
      setup() {
        injectForm<Form>()
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
    const app = createApp(App).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '')
    expect(message.includes(ANONYMOUS_FORM_KEY_PREFIX)).toBe(false)
    // Source frames are normalised to `<path>:<line>:<col>` — no
    // `at fn (URL:l:c)` wrapper, no `https://`/`http://` prefix, no
    // Vite/Nuxt `_nuxt/` dev-server segment. Click-through stays
    // available via console.warn's auto-rendered stack trace below
    // the message; the inline list is for readability.
    expect(message).not.toMatch(/https?:\/\//)
    expect(message).not.toMatch(/\bat \w+ \(/)
    expect(message).not.toMatch(/\b_nuxt\//)
    // Three bullet lines, one per useForm() call.
    const bulletCount = (message.match(/^ {2}- /gm) ?? []).length
    expect(bulletCount).toBe(3)

    app.unmount()
  })

  it('keyed siblings do NOT appear in the warning (they bypass the ambient slot)', () => {
    // Keyed useForm() calls don't fill the ambient slot — they're
    // addressable explicitly via injectForm('key'). They must not
    // appear in this warning, which is specifically about anonymous
    // ambient collisions.
    const Child = defineComponent({
      setup() {
        injectForm<Form>()
        return () => h('span', 'child')
      },
    })
    const App = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        useForm({ schema: fakeSchema<Form>(defaults) })
        useForm({ schema: fakeSchema<Form>(defaults), key: 'my-named-form' })
        return () => h('div', [h(Child)])
      },
    })
    const app = createApp(App).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '')
    expect(message).not.toContain('my-named-form')
    expect(message).not.toMatch(/\[key:/)
    // Exactly two bullet lines — one per anonymous useForm. The keyed
    // call is filtered out entirely.
    const bulletCount = (message.match(/^ {2}- /gm) ?? []).length
    expect(bulletCount).toBe(2)

    app.unmount()
  })

  it('stays quiet when only one anonymous useForm sits beside any number of keyed ones', () => {
    // A parent with N keyed + 1 anonymous useForm + an ambient consumer:
    // the keyed forms don't enter the ambient slot, so the consumer sees
    // a single anonymous form unambiguously. No warning.
    const Child = defineComponent({
      setup() {
        injectForm<Form>()
        return () => h('span', 'child')
      },
    })
    const App = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults), key: 'a' })
        useForm({ schema: fakeSchema<Form>(defaults), key: 'b' })
        useForm({ schema: fakeSchema<Form>(defaults), key: 'c' })
        useForm({ schema: fakeSchema<Form>(defaults) }) // the only anon
        return () => h('div', [h(Child)])
      },
    })
    const app = createApp(App).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(warnSpy).not.toHaveBeenCalled()

    app.unmount()
  })

  it('stays quiet when the ambient-provider only registered ONE form', () => {
    // Single useForm + keyless descendant consumer = intended ambient
    // usage; no warn.
    const Child = defineComponent({
      setup() {
        injectForm<Form>()
        return () => h('span', 'child')
      },
    })
    const App = defineComponent({
      setup() {
        useForm({ schema: fakeSchema<Form>(defaults) })
        return () => h('div', [h(Child)])
      },
    })
    const app = createApp(App).use(createDecant())
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
    const app = createApp(App).use(createDecant())
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
        injectForm<Form>()
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
    serverApp.use(createDecant({ override: true }))
    await renderToString(serverApp)

    expect(warnSpy).not.toHaveBeenCalled()

    const clientApp = createApp(App).use(createDecant())
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
    serverApp.use(createDecant({ override: true }))
    await renderToString(serverApp)

    // Client-side mount of the same tree shape — useId() must match
    // what the server produced so hydration can find the registry
    // entry. We simulate the client by creating a fresh app (new
    // registry, fresh id allocator) and confirming the same position
    // resolves to the same id.
    const clientApp = createApp(App((api) => (clientApi = api))).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    clientApp.mount(root)

    expect(serverApi?.key).toBeDefined()
    expect(clientApi?.key).toBe(serverApi?.key)

    clientApp.unmount()
  })
})

/**
 * Reserved-namespace reject: any consumer-supplied key starting with
 * `__cx:` (the library's reserved internal-key namespace) throws
 * `ReservedFormKeyError` at construction time. This makes it
 * impossible by construction for a consumer key to collide with the
 * synthetic anonymous-form keys allocated under `__cx:anon:`.
 */
describe('reserved key namespace', () => {
  function mountWithKey(key: string): void {
    const App = defineComponent({
      setup() {
        useForm<{ name: string }>({ schema: fakeSchema<{ name: string }>(defaults), key })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createDecant({ override: true }))
    // The throw IS the test's signal — vitest captures it via
    // `.toThrow(...)`. Vue still emits a `[Vue warn]: Unhandled error
    // during execution of setup function` to stderr before re-throwing,
    // which makes CI output noisy and obscures real warnings in the
    // log. Silence the per-app handlers; the error continues to
    // propagate to the caller as expected (errorHandler re-throws,
    // matching Vue's default behaviour minus the warn).
    app.config.warnHandler = () => {}
    app.config.errorHandler = (err) => {
      throw err
    }
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
  }

  it('throws ReservedFormKeyError when consumer key matches the synthetic anon prefix', () => {
    expect(() => mountWithKey(`${ANONYMOUS_FORM_KEY_PREFIX}my-form`)).toThrow(ReservedFormKeyError)
  })

  it('throws on any consumer key in the broader __cx: namespace, not just __cx:anon:', () => {
    // Reserves the full __cx: prefix so future internal-key uses
    // (devtools-injected forms, alternative anon-key shapes, etc.)
    // can land without breaking consumers a second time.
    expect(() => mountWithKey(`${RESERVED_KEY_PREFIX}future-internal-thing`)).toThrow(
      ReservedFormKeyError
    )
  })

  it('does NOT throw when __cx: appears mid-key (only the prefix is reserved)', () => {
    expect(() => mountWithKey(`user-form-${RESERVED_KEY_PREFIX}should-be-fine`)).not.toThrow()
  })

  it('error message names the offending key so the developer can find it', () => {
    const offendingKey = `${ANONYMOUS_FORM_KEY_PREFIX}colliding-with-internal`
    try {
      mountWithKey(offendingKey)
    } catch (e) {
      expect(e).toBeInstanceOf(ReservedFormKeyError)
      expect((e as Error).message).toContain(offendingKey)
    }
  })
})
