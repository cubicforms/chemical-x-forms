// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { useForm } from '../../src'
import { useFormContext } from '../../src/runtime/composables/use-form-context'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { fakeSchema } from '../utils/fake-schema'

type Form = {
  email: string
  profile: { name: string }
}

const defaults: Form = { email: '', profile: { name: '' } }

/**
 * jsdom is required because useFormContext's consumer ref-counting hook
 * runs inside `mount()`, which touches the DOM (even if the component
 * itself doesn't render anything interesting).
 */
describe('useFormContext — ambient provide/inject', () => {
  it('resolves the nearest ancestor form and shares state with it', () => {
    const shared: {
      parent?: ReturnType<typeof useForm<Form>>
      child?: ReturnType<typeof useFormContext<Form>>
    } = {}

    const Child = defineComponent({
      setup() {
        shared.child = useFormContext<Form>()
        return () => h('div')
      },
    })

    const Parent = defineComponent({
      setup() {
        shared.parent = useForm<Form>({ schema: fakeSchema(defaults), key: 'shared' })
        return () => h(Child)
      },
    })

    const app = createApp(Parent).use(createChemicalXForms({ override: true }))
    const root = document.createElement('div')
    app.mount(root)

    // Both APIs must reflect the same underlying FormState — writing via
    // the parent's setValue should surface in the child's getValue.
    expect(shared.parent).toBeDefined()
    expect(shared.child).toBeDefined()
    shared.parent?.setValue('email', 'first@x')
    expect(shared.child?.getValue('email').value).toBe('first@x')
    shared.child?.setValue('profile.name', 'alice')
    expect(shared.parent?.getValue('profile.name').value).toBe('alice')

    app.unmount()
  })

  it('exposes the same form key on both parent and child handles', () => {
    const shared: { parent?: string; child?: string } = {}

    const Child = defineComponent({
      setup() {
        shared.child = useFormContext<Form>().key
        return () => h('div')
      },
    })
    const Parent = defineComponent({
      setup() {
        shared.parent = useForm<Form>({ schema: fakeSchema(defaults), key: 'profile-form' }).key
        return () => h(Child)
      },
    })

    const app = createApp(Parent).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    expect(shared.parent).toBe('profile-form')
    expect(shared.child).toBe('profile-form')
    app.unmount()
  })

  it('throws a clear error when there is no ancestor form', () => {
    let captured: unknown
    const Child = defineComponent({
      setup() {
        try {
          useFormContext<Form>()
        } catch (err) {
          captured = err
        }
        return () => h('div')
      },
    })

    const app = createApp(Child).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    expect(captured).toBeInstanceOf(Error)
    expect((captured as Error).message).toMatch(/no ambient form context/)
    app.unmount()
  })
})

describe('useFormContext — explicit key resolution', () => {
  it('resolves a form by key even when the caller is not a descendant', () => {
    const shared: { sibling?: ReturnType<typeof useFormContext<Form>> } = {}

    const Sibling = defineComponent({
      setup() {
        // Not a child of Owner; reaches the form purely via the registry
        // lookup path.
        shared.sibling = useFormContext<Form>('owner-form')
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
    expect(shared.sibling?.getValue('email').value).toBe('from-sibling@x')
    app.unmount()
  })

  it('throws when the explicit key is not registered', () => {
    let captured: unknown
    const Orphan = defineComponent({
      setup() {
        try {
          useFormContext<Form>('never-registered')
        } catch (err) {
          captured = err
        }
        return () => h('div')
      },
    })
    const app = createApp(Orphan).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    expect(captured).toBeInstanceOf(Error)
    expect((captured as Error).message).toMatch(/no form registered under key 'never-registered'/)
    app.unmount()
  })
})

describe('useFormContext — consumer ref-counting', () => {
  it('keeps the form alive while any child holds it; evicts after last unmount', () => {
    // We ref-count via the trackConsumer path in useFormContext. Unmount
    // the parent after the child while the underlying form is still
    // needed — the registry must keep the state alive as long as any
    // consumer (direct or via context) is mounted.
    //
    // Vue's component teardown order is child-first-then-parent, so the
    // observable invariant is: while the tree is mounted, the form's
    // state is resolvable by key; after unmount, it's evicted.

    const Child = defineComponent({
      setup() {
        useFormContext<Form>()
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
