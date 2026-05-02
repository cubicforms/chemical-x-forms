// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * `<input type="checkbox" v-register>` end-to-end coverage.
 *
 * The directive variant `vRegisterCheckbox` mirrors Vue's
 * `vModelCheckbox` and supports three shapes:
 *
 *   1. **Single boolean** — `z.boolean()`. Checked → `true`, unchecked
 *      → `false`. No `value=""` attribute needed.
 *   2. **Array group** — `z.array(<primitive>)`. Each checkbox shares
 *      the same register binding and has a unique `value="..."`. The
 *      directive adds/removes that value from the array on toggle.
 *   3. **Set group** — `z.set(<primitive>)`. Same as array but the
 *      state is a `Set`. The directive add/deletes via Set semantics.
 *
 * The `:true-value` / `:false-value` props let a single checkbox bind
 * to a non-boolean state (e.g. `'subscribe'` / `'unsubscribe'`) — Vue
 * sets `el._trueValue` / `el._falseValue` from those bindings, and
 * the directive's `getCheckboxValue` reads them through.
 */

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

function dispatchChange(el: HTMLInputElement): void {
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('<input type="checkbox" v-register> — single boolean', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('checking the box writes true; unchecking writes false', async () => {
    const schema = z.object({ agreed: z.boolean() })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'cb-bool', strict: false })
        captured.api = form
        return () =>
          withDirectives(h('input', { type: 'checkbox', class: 'agreed' }), [
            [vRegister, form.register('agreed')],
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')
    const cb = root.querySelector('input.agreed') as HTMLInputElement
    expect(cb.checked).toBe(false)
    expect(captured.api.values.agreed).toBe(false)

    cb.checked = true
    dispatchChange(cb)
    await flush()
    expect(captured.api.values.agreed).toBe(true)

    cb.checked = false
    dispatchChange(cb)
    await flush()
    expect(captured.api.values.agreed).toBe(false)
  })

  it('mounts with el.checked synced to the form value', async () => {
    const schema = z.object({ agreed: z.boolean() })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'cb-bool-init',
          defaultValues: { agreed: true },
          strict: false,
        })
        captured.api = form
        return () =>
          withDirectives(h('input', { type: 'checkbox', class: 'agreed' }), [
            [vRegister, form.register('agreed')],
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const cb = root.querySelector('input.agreed') as HTMLInputElement
    expect(cb.checked).toBe(true)
  })
})

describe('<input type="checkbox" v-register> — array group', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('toggles add/remove the option value from the array', async () => {
    const schema = z.object({ fruits: z.array(z.string()) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'cb-array', strict: false })
        captured.api = form
        return () =>
          h('div', [
            withDirectives(h('input', { type: 'checkbox', value: 'apple', class: 'apple' }), [
              [vRegister, form.register('fruits')],
            ]),
            withDirectives(h('input', { type: 'checkbox', value: 'banana', class: 'banana' }), [
              [vRegister, form.register('fruits')],
            ]),
            withDirectives(h('input', { type: 'checkbox', value: 'cherry', class: 'cherry' }), [
              [vRegister, form.register('fruits')],
            ]),
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')
    expect(captured.api.values.fruits).toEqual([])

    const apple = root.querySelector('input.apple') as HTMLInputElement
    const banana = root.querySelector('input.banana') as HTMLInputElement
    const cherry = root.querySelector('input.cherry') as HTMLInputElement

    apple.checked = true
    dispatchChange(apple)
    await flush()
    expect(captured.api.values.fruits).toEqual(['apple'])

    banana.checked = true
    dispatchChange(banana)
    await flush()
    expect(captured.api.values.fruits).toEqual(['apple', 'banana'])

    apple.checked = false
    dispatchChange(apple)
    await flush()
    expect(captured.api.values.fruits).toEqual(['banana'])

    cherry.checked = true
    dispatchChange(cherry)
    await flush()
    expect(captured.api.values.fruits).toEqual(['banana', 'cherry'])
  })

  it('mounts with each checkbox checked iff its value is in the array', async () => {
    const schema = z.object({ fruits: z.array(z.string()) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'cb-array-init',
          defaultValues: { fruits: ['apple', 'cherry'] },
          strict: false,
        })
        captured.api = form
        return () =>
          h('div', [
            withDirectives(h('input', { type: 'checkbox', value: 'apple', class: 'apple' }), [
              [vRegister, form.register('fruits')],
            ]),
            withDirectives(h('input', { type: 'checkbox', value: 'banana', class: 'banana' }), [
              [vRegister, form.register('fruits')],
            ]),
            withDirectives(h('input', { type: 'checkbox', value: 'cherry', class: 'cherry' }), [
              [vRegister, form.register('fruits')],
            ]),
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    expect((root.querySelector('input.apple') as HTMLInputElement).checked).toBe(true)
    expect((root.querySelector('input.banana') as HTMLInputElement).checked).toBe(false)
    expect((root.querySelector('input.cherry') as HTMLInputElement).checked).toBe(true)
  })

  it('falls back to el.value when Vue did not set _value (hydration with static value="...")', async () => {
    // Repro for the playground bug: SSR renders <input value="apple">
    // as a static attribute, then on hydration Vue's static-attr fast
    // path skips patchProp, so `el._value` is never set. The directive's
    // change handler must still resolve the option-value from the DOM
    // attribute (el.value) rather than warn "missing value attribute".
    //
    // We simulate this by mounting the checkbox via h() (which DOES set
    // _value) and then deleting `_value` before dispatching change —
    // the post-hydration state in a real Nuxt app.
    const schema = z.object({ fruits: z.array(z.string()) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'cb-array-static-value', strict: false })
        captured.api = form
        return () =>
          withDirectives(h('input', { type: 'checkbox', value: 'apple', class: 'apple' }), [
            [vRegister, form.register('fruits')],
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')

    const apple = root.querySelector('input.apple') as HTMLInputElement
    // Strip the Vue-patched _value to mimic the hydrated-from-static-attr
    // shape the directive sees in production. el.value (the DOM property)
    // stays at 'apple' since that's set from the HTML value attribute.
    delete (apple as unknown as { _value?: unknown })._value

    apple.checked = true
    dispatchChange(apple)
    await flush()

    expect(captured.api.values.fruits).toEqual(['apple'])
  })

  it('warns once when an array-bound checkbox is missing a value attribute', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const schema = z.object({ fruits: z.array(z.string()) })
      const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

      const Parent = defineComponent({
        setup() {
          const form = useForm({ schema, key: 'cb-array-missing-value', strict: false })
          captured.api = form
          // Intentionally NO `value` prop on the checkbox.
          return () =>
            withDirectives(h('input', { type: 'checkbox', class: 'no-value' }), [
              [vRegister, form.register('fruits')],
            ])
        },
      })

      app = createApp(Parent).use(createChemicalXForms())
      const root = document.createElement('div')
      document.body.appendChild(root)
      app.mount(root)
      await flush()

      const cb = root.querySelector('input.no-value') as HTMLInputElement
      cb.checked = true
      dispatchChange(cb)
      await flush()

      if (captured.api === undefined) throw new Error('unreachable')
      // No state change — directive bailed at the missing-value check.
      expect(captured.api.values.fruits).toEqual([])

      const matched = warnSpy.mock.calls
        .map((args) => args.join(' '))
        .filter((m) => /missing a `value` attribute/.test(m))
      expect(matched).toHaveLength(1)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('<input type="checkbox" v-register> — Set group', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('toggles add/delete the option value through Set semantics', async () => {
    const schema = z.object({ tags: z.set(z.string()) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'cb-set',
          defaultValues: { tags: new Set<string>() },
          strict: false,
        })
        captured.api = form
        return () =>
          h('div', [
            withDirectives(h('input', { type: 'checkbox', value: 'red', class: 'red' }), [
              [vRegister, form.register('tags')],
            ]),
            withDirectives(h('input', { type: 'checkbox', value: 'green', class: 'green' }), [
              [vRegister, form.register('tags')],
            ]),
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')
    expect((captured.api.values.tags as Set<string>).size).toBe(0)

    const red = root.querySelector('input.red') as HTMLInputElement
    const green = root.querySelector('input.green') as HTMLInputElement

    red.checked = true
    dispatchChange(red)
    await flush()
    expect([...(captured.api.values.tags as Set<string>)]).toEqual(['red'])

    green.checked = true
    dispatchChange(green)
    await flush()
    expect([...(captured.api.values.tags as Set<string>)].sort()).toEqual(['green', 'red'])

    red.checked = false
    dispatchChange(red)
    await flush()
    expect([...(captured.api.values.tags as Set<string>)]).toEqual(['green'])
  })
})

describe('<input type="checkbox" v-register> — :true-value / :false-value', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('binds a single checkbox to one of two strings', async () => {
    const schema = z.object({ newsletter: z.enum(['subscribe', 'unsubscribe']) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'cb-true-false-value',
          // Explicit default: enum's first member is 'subscribe', which
          // would mount the checkbox already-checked. Setting
          // 'unsubscribe' isolates the toggle behavior.
          defaultValues: { newsletter: 'unsubscribe' },
          strict: false,
        })
        captured.api = form
        return () =>
          withDirectives(
            h('input', {
              type: 'checkbox',
              class: 'newsletter',
              // Vue propagates these as `el._trueValue` / `el._falseValue`,
              // which the directive's `getCheckboxValue` reads through.
              'true-value': 'subscribe',
              'false-value': 'unsubscribe',
            }),
            [[vRegister, form.register('newsletter')]]
          )
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')
    const cb = root.querySelector('input.newsletter') as HTMLInputElement
    expect(cb.checked).toBe(false)
    expect(captured.api.values.newsletter).toBe('unsubscribe')

    cb.checked = true
    dispatchChange(cb)
    await flush()
    expect(captured.api.values.newsletter).toBe('subscribe')

    cb.checked = false
    dispatchChange(cb)
    await flush()
    expect(captured.api.values.newsletter).toBe('unsubscribe')
  })
})

describe('checkbox slim-primitive gate interactions', () => {
  let app: App | undefined
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    app?.unmount()
    app = undefined
    warnSpy.mockRestore()
    document.body.innerHTML = ''
  })

  it('rejects a string write to a boolean checkbox path', async () => {
    const schema = z.object({ agreed: z.boolean() })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        captured.api = useForm({ schema, key: 'cb-gate-bool', strict: false })
        return () => h('div')
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')
    const setVal = captured.api.setValue as (path: 'agreed', value: unknown) => boolean
    expect(setVal('agreed', 'yes')).toBe(false)
    expect(captured.api.values.agreed).toBe(false)
  })

  it('rejects a string write to an array checkbox path', async () => {
    const schema = z.object({ fruits: z.array(z.string()) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        captured.api = useForm({ schema, key: 'cb-gate-array', strict: false })
        return () => h('div')
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')
    const setVal = captured.api.setValue as (path: 'fruits', value: unknown) => boolean
    // Wrong slim primitive: 'apple' is a string, but the path expects 'array'.
    expect(setVal('fruits', 'apple')).toBe(false)
    expect(captured.api.values.fruits).toEqual([])
  })
})
