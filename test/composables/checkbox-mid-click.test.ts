// @vitest-environment jsdom
//
// Mirrors `multi-select-cmd-click.test.ts` for `<input type="checkbox">`
// bound to an Array model. Pre-fix `setChecked`'s scalar branch gated
// on `originalValue === oldValue`, comparing a primitive scalar against
// the wrapper RegisterValue object — the comparison was always false,
// so the guard was a silent no-op and `el.checked = …` re-applied on
// every parent re-render. Array / Set branches lacked the guard
// entirely. The per-render re-apply mirrors the multi-select shape:
// a sibling's reactive write between the user's click and the
// browser's `change` decision triggers `beforeUpdate`, which writes
// back the prior model state and clobbers the in-flight toggle.
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createAttaform } from '../../src/runtime/core/plugin'

const schema = z.object({
  items: z.array(z.string()),
  note: z.string(),
})

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('<input type="checkbox" v-register> — sibling re-render mid-click', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('a sibling re-render between mousedown and change MUST NOT clobber the user-toggled checkbox (array model)', async () => {
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { items: ['apple'], note: '' },
          key: `cb-mid-click-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rvItems = api.register('items')
        const rvNote = api.register('note')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'checkbox', value: 'apple' }), [
              [vRegister, rvItems],
            ]),
            withDirectives(h('input', { type: 'checkbox', value: 'banana' }), [
              [vRegister, rvItems],
            ]),
            withDirectives(h('input', { type: 'checkbox', value: 'cherry' }), [
              [vRegister, rvItems],
            ]),
            withDirectives(h('input', { type: 'text', 'data-field': 'note' }), [
              [vRegister, rvNote],
            ]),
            // Reactive readout — re-renders the parent on every mutation
            // (including the `note` keystroke below). This is what
            // exercises the directive's `beforeUpdate` mid-click.
            h('pre', null, JSON.stringify(api.values.items)),
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (handle.api === undefined) throw new Error('api never set')

    const checkboxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    const [apple, banana, cherry] = checkboxes as [
      HTMLInputElement,
      HTMLInputElement,
      HTMLInputElement,
    ]
    const note = root.querySelector('[data-field="note"]') as HTMLInputElement

    // Mount-time DOM reflects the default model.
    expect(apple.checked).toBe(true)
    expect(banana.checked).toBe(false)
    expect(cherry.checked).toBe(false)

    // Step 1: simulate the browser's native click handling — the user
    // clicked cherry, browser flipped its `checked` IDL state. Model
    // is still ['apple'] (change has NOT fired yet).
    cherry.checked = true
    expect(handle.api.values.items).toEqual(['apple'])

    // Step 2: sibling reactive write before the browser's change
    // decision. Typing into `note` queues a parent re-render; the
    // microtask flush runs `beforeUpdate` on every checkbox.
    //
    // EXPECTATION: the directive must NOT re-apply `setChecked` from
    // a stale model — `cherry.checked` must remain `true` so the
    // browser's subsequent `change` event sees a real toggle and
    // writes ['apple','cherry'] to the model.
    note.value = 'x'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(cherry.checked).toBe(true)
    expect(apple.checked).toBe(true)
    expect(banana.checked).toBe(false)

    // Step 3: fire the change event the browser would have fired.
    cherry.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()

    expect(handle.api.values.items).toEqual(['apple', 'cherry'])
    expect(apple.checked).toBe(true)
    expect(banana.checked).toBe(false)
    expect(cherry.checked).toBe(true)
  })

  it('subsequent renders with model-identity-unchanged are no-ops on the DOM (skip path)', async () => {
    // Direct proof of the identity guard: after mount, repeatedly
    // type into a sibling field. The checkbox model is unchanged the
    // entire time, so `setChecked` should never re-write `el.checked`.
    // We instrument `el.checked`'s setter with `Object.defineProperty`
    // to count writes — pre-fix the count grew with every sibling
    // keystroke; post-fix it stays at zero after mount.
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { items: ['apple'], note: '' },
          key: `cb-skip-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rvItems = api.register('items')
        const rvNote = api.register('note')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'checkbox', value: 'apple' }), [
              [vRegister, rvItems],
            ]),
            withDirectives(h('input', { type: 'text', 'data-field': 'note' }), [
              [vRegister, rvNote],
            ]),
            h('pre', null, JSON.stringify(api.values.items)),
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const apple = root.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (apple === null) throw new Error('checkbox missing')
    const note = root.querySelector('[data-field="note"]') as HTMLInputElement

    // Instrument `apple.checked`'s setter to count post-mount writes.
    let writes = 0
    const proto = Object.getPrototypeOf(apple) as object
    const desc = Object.getOwnPropertyDescriptor(proto, 'checked')
    if (desc?.set === undefined || desc.get === undefined) {
      throw new Error('cannot find checked descriptor on prototype')
    }
    const origSet = desc.set
    const origGet = desc.get
    Object.defineProperty(apple, 'checked', {
      configurable: true,
      get() {
        return origGet.call(this)
      },
      set(v) {
        writes++
        origSet.call(this, v)
      },
    })

    // Drive several sibling re-renders. The model identity for
    // `items` doesn't change, so `setChecked` must skip every time.
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
    // Counterpart to the skip test — confirm the identity guard
    // doesn't get stuck. After a programmatic `setValue` moves the
    // model, the next render must re-apply.
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { items: ['apple'], note: '' },
          key: `cb-resync-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rvItems = api.register('items')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'checkbox', value: 'apple' }), [
              [vRegister, rvItems],
            ]),
            withDirectives(h('input', { type: 'checkbox', value: 'banana' }), [
              [vRegister, rvItems],
            ]),
            h('pre', null, JSON.stringify(api.values.items)),
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (handle.api === undefined) throw new Error('api never set')
    const [apple, banana] = Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    ) as [HTMLInputElement, HTMLInputElement]

    expect(apple.checked).toBe(true)
    expect(banana.checked).toBe(false)

    handle.api.setValue('items', ['banana'])
    await flush()

    expect(apple.checked).toBe(false)
    expect(banana.checked).toBe(true)
  })
})
