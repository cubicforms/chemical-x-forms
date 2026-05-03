// @vitest-environment jsdom
//
// Test #10 from the transforms plan: smoke test that the same transforms
// pipeline applies uniformly across all four `v-register` element variants —
// text input, select, checkbox, radio. They each route through
// `el[assignKey]?.(value)` (text→515, checkbox→693+, radio→772, select→813
// in directive.ts). If a future refactor splits the assigner path per
// element type, this test catches the divergence.
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createAttaform } from '../../src/runtime/core/plugin'

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('register({ transforms }) — applies to all four element variants', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('text, select, checkbox, radio all route writes through the transform pipeline', async () => {
    // Per-variant transform: tag the value so we can assert the pipeline
    // ran for each. The body branches by input type because the four
    // variants extract different value shapes (string / array<string> /
    // boolean / string).
    const tag = (v: unknown): unknown => {
      if (typeof v === 'string') return `tagged:${v}`
      if (Array.isArray(v)) return v.map((x) => `tagged:${String(x)}`)
      if (typeof v === 'boolean') return !v // flip — anything we can detect
      return v
    }

    const schema = z.object({
      text: z.string(),
      pick: z.enum(['a', 'b', 'c']),
      box: z.boolean(),
      radio: z.string(),
    })

    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { text: '', pick: 'a', box: false, radio: '' },
          key: `all-elements-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rvText = api.register('text', { transforms: [tag] })
        const rvPick = api.register('pick', { transforms: [tag] })
        const rvBox = api.register('box', { transforms: [tag] })
        const rvRadio = api.register('radio', { transforms: [tag] })
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'text', 'data-field': 'text' }), [
              [vRegister, rvText],
            ]),
            withDirectives(
              h('select', { 'data-field': 'pick' }, [
                h('option', { value: 'a' }, 'a'),
                h('option', { value: 'b' }, 'b'),
                h('option', { value: 'c' }, 'c'),
              ]),
              [[vRegister, rvPick]]
            ),
            withDirectives(h('input', { type: 'checkbox', 'data-field': 'box' }), [
              [vRegister, rvBox],
            ]),
            withDirectives(h('input', { type: 'radio', value: 'one', 'data-field': 'radio' }), [
              [vRegister, rvRadio],
            ]),
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (handle.api === undefined) throw new Error('api never set')

    // Text — input event with value 'abc' → transform tags → 'tagged:abc'.
    const text = root.querySelector('[data-field="text"]') as HTMLInputElement
    text.value = 'abc'
    text.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(handle.api.values.text).toBe('tagged:abc')

    // Select — change event after picking 'b' → transform tags → 'tagged:b'.
    // The slim-primitive gate checks JS type (string), not enum
    // membership; refinement-level violations surface via field
    // validation on submit, not at the write boundary. So the post-
    // transform value lands in storage and proves the pipeline ran.
    const pick = root.querySelector('[data-field="pick"]') as HTMLSelectElement
    pick.value = 'b'
    pick.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(handle.api.values.pick).toBe('tagged:b')

    // Checkbox — clicking flips storage from false → true; transform's
    // boolean-flip turns it back to false at write time.
    const box = root.querySelector('[data-field="box"]') as HTMLInputElement
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(handle.api.values.box).toBe(false)

    // Radio — clicking dispatches change; transform tags 'one' → 'tagged:one'.
    const radio = root.querySelector('[data-field="radio"]') as HTMLInputElement
    radio.checked = true
    radio.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(handle.api.values.radio).toBe('tagged:one')
  })
})
