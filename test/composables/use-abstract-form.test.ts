import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { useForm } from '../../src'
import { ANONYMOUS_FORM_KEY_PREFIX } from '../../src/runtime/core/defaults'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
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
