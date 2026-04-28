// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createApp, createSSRApp, defineComponent, h, nextTick, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { useForm } from '../../src'
import { ANONYMOUS_FORM_KEY_PREFIX } from '../../src/runtime/core/defaults'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { useFormContext } from '../../src/runtime/composables/use-form-context'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Coverage for `resolveFormKey` in use-abstract-form.ts.
 *
 * The post-0.8.3 contract treats `key` as optional: a missing /
 * nullish / empty-string key resolves to a synthetic `__cx:anon:<id>`
 * allocated via Vue's `useId()` (inside setup) or a module counter
 * (outside). These tests prove all four "anonymous" shapes produce a
 * working form and that an explicit key passes through unchanged.
 */

type Form = { name: string }
type ApiReturn = ReturnType<typeof useForm<Form>>

function mountWith(config: { keyValue?: unknown; provideKey: boolean }): Promise<ApiReturn> {
  return new Promise((resolve) => {
    const App = defineComponent({
      setup() {
        // Bypass the type-level `key?: FormKey` constraint so non-TS
        // paths (null from a dynamic input, `as` casts, literal '')
        // are exercised alongside the typed forms.
        const api = useForm<Form>({
          schema: fakeSchema<Form>({ name: '' }),
          ...(config.provideKey ? { key: config.keyValue as string } : {}),
        })
        resolve(api)
        return () => h('div')
      },
    })
    const app = createSSRApp(App)
    app.use(createChemicalXForms({ override: true }))
    void renderToString(app)
  })
}

describe('useForm — runtime key resolution', () => {
  it('allocates an anonymous key when `key` is omitted entirely', async () => {
    const api = await mountWith({ provideKey: false })
    expect(api.key.startsWith(ANONYMOUS_FORM_KEY_PREFIX)).toBe(true)
  })

  it('allocates an anonymous key when `key` is `undefined`', async () => {
    const api = await mountWith({ keyValue: undefined, provideKey: true })
    expect(api.key.startsWith(ANONYMOUS_FORM_KEY_PREFIX)).toBe(true)
  })

  it('allocates an anonymous key when `key` is `null`', async () => {
    const api = await mountWith({ keyValue: null, provideKey: true })
    expect(api.key.startsWith(ANONYMOUS_FORM_KEY_PREFIX)).toBe(true)
  })

  it('allocates an anonymous key when `key` is the empty string', async () => {
    const api = await mountWith({ keyValue: '', provideKey: true })
    expect(api.key.startsWith(ANONYMOUS_FORM_KEY_PREFIX)).toBe(true)
  })

  it('preserves an explicit key verbatim', async () => {
    const api = await mountWith({ keyValue: 'form-1', provideKey: true })
    expect(api.key).toBe('form-1')
  })
})

/**
 * `useForm({ key })` captures `key` once at setup-time. It is NOT a
 * reactive subscription: a consumer who reads a reactive source into
 * the configuration (`useForm({ key: someRef.value, schema })`) gets
 * the snapshot at that moment and the form stays bound to it for
 * its lifetime. The TypeScript signature `key?: FormKey` (where
 * `FormKey = string`) reinforces this — `Ref<string>` and getters
 * are not accepted.
 *
 * The idiomatic Vue pattern for "swap which form is bound" is
 * `<MyForm :key="formKey" />` on the parent: changing `formKey`
 * re-mounts the child, re-runs setup, and `useForm` is called
 * again with the new key.
 *
 * These tests pin the contract from both sides:
 *   1. Mutating the source ref after mount does NOT change `form.key`
 *      and does NOT migrate the form's identity in the registry.
 *   2. Vue's `:key` mechanism DOES create a fresh form when the parent
 *      re-mounts the child with a different key.
 *
 * A future refactor that accidentally introduced a `watch` on the
 * config's key would fail (1); a future refactor that broke
 * setup-time capture would fail (2).
 */
describe('useForm — key is captured once at setup', () => {
  it('mutating the source ref after mount does not change form.key', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const sourceKey = ref('form-original')
    let captured: { api: ApiReturn } | undefined

    const App = defineComponent({
      setup() {
        const api = useForm<Form>({
          schema: fakeSchema<Form>({ name: '' }),
          key: sourceKey.value,
        })
        captured = { api }
        return () => h('div')
      },
    })
    const app = createApp(App)
    app.use(createChemicalXForms({ override: false }))
    app.mount(root)

    if (captured === undefined) throw new Error('unreachable')
    expect(captured.api.key).toBe('form-original')

    sourceKey.value = 'form-mutated'
    await nextTick()

    // form.key is still the original snapshot.
    expect(captured.api.key).toBe('form-original')

    app.unmount()
  })

  it('useFormContext under the new key after mutation does not find the form', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const sourceKey = ref('form-original')
    const captured: {
      ownerApi?: ApiReturn
      lookupOriginal?: ReturnType<typeof useFormContext<Form>>
      lookupMutated?: ReturnType<typeof useFormContext<Form>>
    } = {}

    const Owner = defineComponent({
      setup() {
        captured.ownerApi = useForm<Form>({
          schema: fakeSchema<Form>({ name: '' }),
          key: sourceKey.value,
        })
        return () => h(Lookup)
      },
    })
    const Lookup = defineComponent({
      setup() {
        captured.lookupOriginal = useFormContext<Form>('form-original')
        captured.lookupMutated = useFormContext<Form>('form-mutated')
        return () => h('span')
      },
    })

    const app = createApp(Owner)
    app.use(createChemicalXForms({ override: false }))
    app.mount(root)

    // The owner's useForm bound to 'form-original'.
    expect(captured.ownerApi?.key).toBe('form-original')
    // Distant lookup under the same key resolves the same form.
    expect(captured.lookupOriginal).not.toBeNull()
    expect(captured.lookupOriginal?.key).toBe('form-original')
    // Lookup under the not-yet-existing 'form-mutated' key returns null.
    expect(captured.lookupMutated).toBeNull()

    sourceKey.value = 'form-mutated'
    await nextTick()

    // After mutation: the form's identity has not migrated.
    expect(captured.ownerApi?.key).toBe('form-original')

    app.unmount()
  })

  it("Vue's :key on the parent re-mounts the child and binds a fresh form", async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const formKey = ref('form-a')
    const apiHistory: Array<{ key: string }> = []

    const Child = defineComponent({
      setup(props: { formKey: string }) {
        const api = useForm<Form>({
          schema: fakeSchema<Form>({ name: '' }),
          key: props.formKey,
        })
        apiHistory.push({ key: api.key })
        return () => h('span')
      },
      props: ['formKey'],
    })
    const Parent = defineComponent({
      setup() {
        return () => h(Child, { key: formKey.value, formKey: formKey.value })
      },
    })

    const app = createApp(Parent)
    app.use(createChemicalXForms({ override: false }))
    app.mount(root)

    expect(apiHistory).toEqual([{ key: 'form-a' }])

    formKey.value = 'form-b'
    await nextTick()

    // The child remounted; a fresh useForm() ran with the new key.
    expect(apiHistory).toEqual([{ key: 'form-a' }, { key: 'form-b' }])

    app.unmount()
  })
})
