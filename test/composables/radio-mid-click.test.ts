// @vitest-environment jsdom
//
// Mirrors `multi-select-cmd-click.test.ts` for `<input type="radio">`.
// Pre-fix `vRegisterRadio.beforeUpdate` gated on
// `value.innerRef.value !== oldValue`, comparing a primitive scalar
// against the wrapper RegisterValue object — always !==, so the
// guard was a silent no-op and `el.checked = …` re-applied on
// every parent re-render. A sibling's reactive write between the
// user's click and the browser's `change` decision triggers
// `beforeUpdate` and writes back the prior model state, clobbering
// the in-flight selection.
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

const schema = z.object({
  flavor: z.string(),
  note: z.string(),
})

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('<input type="radio" v-register> — sibling re-render mid-click', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('a sibling re-render between mousedown and change MUST NOT clobber the user-selected radio', async () => {
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { flavor: 'vanilla', note: '' },
          key: `radio-mid-click-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rvFlavor = api.register('flavor')
        const rvNote = api.register('note')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'radio', name: 'flavor', value: 'vanilla' }), [
              [vRegister, rvFlavor],
            ]),
            withDirectives(h('input', { type: 'radio', name: 'flavor', value: 'chocolate' }), [
              [vRegister, rvFlavor],
            ]),
            withDirectives(h('input', { type: 'radio', name: 'flavor', value: 'strawberry' }), [
              [vRegister, rvFlavor],
            ]),
            withDirectives(h('input', { type: 'text', 'data-field': 'note' }), [
              [vRegister, rvNote],
            ]),
            h('pre', null, JSON.stringify(api.values.flavor)),
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (handle.api === undefined) throw new Error('api never set')

    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    const [vanilla, chocolate, strawberry] = radios as [
      HTMLInputElement,
      HTMLInputElement,
      HTMLInputElement,
    ]
    const note = root.querySelector('[data-field="note"]') as HTMLInputElement

    // Mount-time DOM reflects the default model.
    expect(vanilla.checked).toBe(true)
    expect(chocolate.checked).toBe(false)
    expect(strawberry.checked).toBe(false)

    // Step 1: simulate the browser's native click handling — user
    // clicked strawberry. Browser flipped strawberry's `checked` IDL
    // state and (per radio-group exclusivity) cleared vanilla's.
    // Model is still 'vanilla' (change has NOT fired yet).
    vanilla.checked = false
    strawberry.checked = true
    expect(handle.api.values.flavor).toBe('vanilla')

    // Step 2: sibling reactive write. Typing into `note` queues a
    // parent re-render; the microtask flush runs `beforeUpdate` on
    // every radio.
    //
    // EXPECTATION: `strawberry.checked` must remain `true` and
    // `vanilla.checked` must remain `false` so the browser's
    // subsequent `change` event sees the real selection change.
    note.value = 'x'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(strawberry.checked).toBe(true)
    expect(vanilla.checked).toBe(false)
    expect(chocolate.checked).toBe(false)

    // Step 3: fire the change event the browser would have fired.
    strawberry.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()

    expect(handle.api.values.flavor).toBe('strawberry')
    expect(strawberry.checked).toBe(true)
    expect(vanilla.checked).toBe(false)
    expect(chocolate.checked).toBe(false)
  })

  it('subsequent renders with model-identity-unchanged are no-ops on the DOM (skip path)', async () => {
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { flavor: 'vanilla', note: '' },
          key: `radio-skip-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rvFlavor = api.register('flavor')
        const rvNote = api.register('note')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'radio', name: 'flavor', value: 'vanilla' }), [
              [vRegister, rvFlavor],
            ]),
            withDirectives(h('input', { type: 'text', 'data-field': 'note' }), [
              [vRegister, rvNote],
            ]),
            h('pre', null, JSON.stringify(api.values.flavor)),
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const vanilla = root.querySelector<HTMLInputElement>('input[type="radio"]')
    if (vanilla === null) throw new Error('radio missing')
    const note = root.querySelector('[data-field="note"]') as HTMLInputElement

    // Instrument `vanilla.checked`'s setter to count post-mount writes.
    let writes = 0
    const proto = Object.getPrototypeOf(vanilla) as object
    const desc = Object.getOwnPropertyDescriptor(proto, 'checked')
    if (desc?.set === undefined || desc.get === undefined) {
      throw new Error('cannot find checked descriptor on prototype')
    }
    const origSet = desc.set
    const origGet = desc.get
    Object.defineProperty(vanilla, 'checked', {
      configurable: true,
      get() {
        return origGet.call(this)
      },
      set(v) {
        writes++
        origSet.call(this, v)
      },
    })

    note.value = 'a'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    note.value = 'ab'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    note.value = 'abc'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(writes).toBe(0)
  })

  it('a real model change still drives the DOM (post-skip resync)', async () => {
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { flavor: 'vanilla', note: '' },
          key: `radio-resync-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rvFlavor = api.register('flavor')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'radio', name: 'flavor', value: 'vanilla' }), [
              [vRegister, rvFlavor],
            ]),
            withDirectives(h('input', { type: 'radio', name: 'flavor', value: 'chocolate' }), [
              [vRegister, rvFlavor],
            ]),
            h('pre', null, JSON.stringify(api.values.flavor)),
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (handle.api === undefined) throw new Error('api never set')
    const [vanilla, chocolate] = Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    ) as [HTMLInputElement, HTMLInputElement]

    expect(vanilla.checked).toBe(true)
    expect(chocolate.checked).toBe(false)

    handle.api.setValue('flavor', 'chocolate')
    await flush()

    expect(vanilla.checked).toBe(false)
    expect(chocolate.checked).toBe(true)
  })
})
