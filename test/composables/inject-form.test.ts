// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { useForm } from '../../src'
import { injectForm } from '../../src/runtime/composables/use-form-context'
import { ANONYMOUS_FORM_KEY_PREFIX } from '../../src/runtime/core/defaults'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { fakeSchema } from '../utils/fake-schema'

const NULL_WARN_MARKER = '[@chemical-x/forms] injectForm'

type Form = {
  email: string
  profile: { name: string }
}

const defaults: Form = { email: '', profile: { name: '' } }

/**
 * jsdom is required because injectForm's consumer ref-counting hook
 * runs inside `mount()`, which touches the DOM (even if the component
 * itself doesn't render anything interesting).
 */
describe('injectForm — ambient provide/inject', () => {
  it('resolves the nearest ancestor anonymous form and shares state with it', () => {
    const shared: {
      parent?: ReturnType<typeof useForm<Form>>
      child?: ReturnType<typeof injectForm<Form>>
    } = {}

    const Child = defineComponent({
      setup() {
        shared.child = injectForm<Form>()
        return () => h('div')
      },
    })

    // Anonymous useForm — no key — fills the ambient slot. Keyed forms
    // are not addressable via ambient `injectForm()`; descendants
    // must call `injectForm<F>('that-key')` instead.
    const Parent = defineComponent({
      setup() {
        shared.parent = useForm<Form>({ schema: fakeSchema(defaults) })
        return () => h(Child)
      },
    })

    const app = createApp(Parent).use(createChemicalXForms({ override: true }))
    const root = document.createElement('div')
    app.mount(root)

    // Both APIs must reflect the same underlying FormStore — writing via
    // the parent's setValue should surface in the child's getValue.
    expect(shared.parent).toBeDefined()
    expect(shared.child).toBeDefined()
    shared.parent?.setValue('email', 'first@x')
    expect(shared.child?.values.email).toBe('first@x')
    shared.child?.setValue('profile.name', 'alice')
    expect(shared.parent?.values.profile.name).toBe('alice')

    app.unmount()
  })

  it('parent and child handles share the same synthetic key', () => {
    const shared: { parent?: string; child?: string | undefined } = {}

    const Child = defineComponent({
      setup() {
        shared.child = injectForm<Form>()?.key
        return () => h('div')
      },
    })
    const Parent = defineComponent({
      setup() {
        // Anonymous form. The runtime allocates a `__cx:anon:<id>` key
        // via Vue's `useId()`; both handles must surface the SAME id.
        shared.parent = useForm<Form>({ schema: fakeSchema(defaults) }).key
        return () => h(Child)
      },
    })

    const app = createApp(Parent).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    expect(shared.parent).toBeDefined()
    expect(shared.parent?.startsWith(ANONYMOUS_FORM_KEY_PREFIX)).toBe(true)
    expect(shared.child).toBe(shared.parent)
    app.unmount()
  })

  describe('miss modes — return null + dev warn', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    })
    afterEach(() => {
      warnSpy.mockRestore()
    })

    const matchingWarnCalls = (): readonly unknown[][] =>
      warnSpy.mock.calls.filter((args: readonly unknown[]) =>
        String(args[0] ?? '').includes(NULL_WARN_MARKER)
      )

    it('returns null and warns when there is no ancestor form', () => {
      let captured: ReturnType<typeof injectForm<Form>> | undefined
      const Child = defineComponent({
        setup() {
          captured = injectForm<Form>()
          return () => h('div')
        },
      })

      // No `override: true` — the warn is suppressed in SSR mode (see
      // warnMiss in use-form-context.ts). JSDOM has `window`, so the
      // default detectSSR resolves to false and the warn fires as
      // intended for client-side coverage.
      const app = createApp(Child).use(createChemicalXForms())
      app.mount(document.createElement('div'))
      expect(captured).toBeNull()
      const calls = matchingWarnCalls()
      expect(calls).toHaveLength(1)
      expect(String(calls[0]?.[0] ?? '')).toMatch(/no ambient form context/)
      app.unmount()
    })

    it('returns null and warns when the only ancestor form is keyed', () => {
      // Keyed useForm() does NOT fill the ambient slot — descendants must
      // address it explicitly by key. A naive `injectForm()` (no key)
      // call inside such a subtree gets the same "no ambient" warn + null
      // it would get with no parent at all.
      let captured: ReturnType<typeof injectForm<Form>> | undefined
      const Child = defineComponent({
        setup() {
          captured = injectForm<Form>()
          return () => h('div')
        },
      })
      const Parent = defineComponent({
        setup() {
          useForm<Form>({ schema: fakeSchema(defaults), key: 'named-only' })
          return () => h(Child)
        },
      })
      const app = createApp(Parent).use(createChemicalXForms())
      app.mount(document.createElement('div'))
      expect(captured).toBeNull()
      const calls = matchingWarnCalls()
      expect(calls).toHaveLength(1)
      expect(String(calls[0]?.[0] ?? '')).toMatch(/no ambient form context/)
      app.unmount()
    })

    it("warning message names the missing key when it's an explicit-key miss", () => {
      let captured: ReturnType<typeof injectForm<Form>> | undefined
      const Orphan = defineComponent({
        setup() {
          captured = injectForm<Form>('never-registered')
          return () => h('div')
        },
      })
      const app = createApp(Orphan).use(createChemicalXForms())
      app.mount(document.createElement('div'))
      expect(captured).toBeNull()
      const calls = matchingWarnCalls()
      expect(calls).toHaveLength(1)
      const message = String(calls[0]?.[0] ?? '')
      expect(message).toMatch(/no form registered/)
      expect(message).toContain("'never-registered'")
      app.unmount()
    })

    // The warn embeds a `(<path>:<line>)` user call-site frame via
    // `captureUserCallSite()`. We don't unit-test that here: the
    // capture's regex deliberately skips any frame matching
    // `/chemical-x[/-]forms?/i`, which includes this very test file
    // — there's no "user frame" outside the lib workspace to attach.
    // End-to-end verification lives in the cubic-forms spike, where
    // the warn renders as e.g. `(.../SpikeCxChild.vue:19)`.
  })

  it('mixed keyed + anonymous: ambient resolves to the (only) anonymous form', () => {
    // A parent that mixes keyed and anonymous useForm() calls: the keyed
    // ones bypass ambient entirely, so a descendant's `injectForm()`
    // sees only the (single) anonymous form and resolves to it.
    const shared: { childKey?: string | undefined } = {}
    const Child = defineComponent({
      setup() {
        shared.childKey = injectForm<Form>()?.key
        return () => h('div')
      },
    })
    const Parent = defineComponent({
      setup() {
        useForm<Form>({ schema: fakeSchema(defaults), key: 'named-a' })
        useForm<Form>({ schema: fakeSchema(defaults), key: 'named-b' })
        useForm<Form>({ schema: fakeSchema(defaults) }) // the only anon
        return () => h(Child)
      },
    })
    const app = createApp(Parent).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    expect(shared.childKey).toBeDefined()
    expect(shared.childKey?.startsWith(ANONYMOUS_FORM_KEY_PREFIX)).toBe(true)
    app.unmount()
  })
})

describe('injectForm — explicit key resolution', () => {
  it('resolves a form by key even when the caller is not a descendant', () => {
    const shared: { sibling?: ReturnType<typeof injectForm<Form>> } = {}

    const Sibling = defineComponent({
      setup() {
        // Not a child of Owner; reaches the form purely via the registry
        // lookup path.
        shared.sibling = injectForm<Form>('owner-form')
        return () => h('div')
      },
    })
    const Owner = defineComponent({
      setup() {
        useForm<Form>({ schema: fakeSchema(defaults), key: 'owner-form' })
        return () => h('div')
      },
    })
    const Root = defineComponent({
      setup() {
        return () => h('div', [h(Owner), h(Sibling)])
      },
    })

    const app = createApp(Root).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))

    expect(shared.sibling).toBeDefined()
    expect(shared.sibling?.key).toBe('owner-form')
    // Mutation round-trip — sibling's setValue must surface wherever else
    // the same key is read. We prove that by reading back via the same
    // sibling handle; the registry is a single source of truth.
    shared.sibling?.setValue('email', 'from-sibling@x')
    expect(shared.sibling?.values.email).toBe('from-sibling@x')
    app.unmount()
  })

  it('returns null and warns when the explicit key is not registered', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let captured: ReturnType<typeof injectForm<Form>> | undefined
    const Orphan = defineComponent({
      setup() {
        captured = injectForm<Form>('never-registered')
        return () => h('div')
      },
    })
    const app = createApp(Orphan).use(createChemicalXForms())
    app.mount(document.createElement('div'))
    expect(captured).toBeNull()
    const matching = warnSpy.mock.calls.filter((args: readonly unknown[]) =>
      String(args[0] ?? '').includes(NULL_WARN_MARKER)
    )
    expect(matching).toHaveLength(1)
    expect(String(matching[0]?.[0] ?? '')).toMatch(/no form registered/)
    app.unmount()
    warnSpy.mockRestore()
  })
})

describe('injectForm — consumer ref-counting', () => {
  it('keeps the form alive while any child holds it; evicts after last unmount', () => {
    // We ref-count via the trackConsumer path in injectForm. Unmount
    // the parent after the child while the underlying form is still
    // needed — the registry must keep the state alive as long as any
    // consumer (direct or via context) is mounted.
    //
    // Vue's component teardown order is child-first-then-parent, so the
    // observable invariant is: while the tree is mounted, the form's
    // state is resolvable by key; after unmount, it's evicted.

    const Child = defineComponent({
      setup() {
        injectForm<Form>('lifetime-form')
        return () => h('span')
      },
    })
    const Parent = defineComponent({
      setup() {
        useForm<Form>({ schema: fakeSchema(defaults), key: 'lifetime-form' })
        return () => h(Child)
      },
    })

    const app = createApp(Parent).use(createChemicalXForms({ override: true }))
    const root = document.createElement('div')
    app.mount(root)

    // While mounted: the form is in the registry.
    const registryApp = app as unknown as { _chemicalX: { forms: Map<string, unknown> } }
    expect(registryApp._chemicalX.forms.has('lifetime-form')).toBe(true)

    app.unmount()
    // After unmount: eviction has run.
    expect(registryApp._chemicalX.forms.has('lifetime-form')).toBe(false)
  })
})
