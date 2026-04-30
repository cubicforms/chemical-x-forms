// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * `<input type="radio" v-register>` end-to-end coverage.
 *
 * Radio model is always SCALAR — the option-value of the currently
 * checked radio. Every radio in a group shares one register binding
 * and carries a distinct `value="..."`. The directive reflects model
 * changes onto `el.checked` and writes the selected option-value back
 * on change events.
 *
 * Mirror of `checkbox.test.ts` for symmetry; coverage targets the
 * same regression classes (initial-state hydration, static-attr
 * hydration, slim-gate interactions).
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

describe('<input type="radio" v-register> — single-group selection', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('selecting a radio writes its option-value to the model', async () => {
    const schema = z.object({ tier: z.enum(['free', 'pro', 'enterprise']) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'radio-select',
          // z.enum's slim default is the first member ('free') — opt
          // into 'pro' as the construction-time selection so the test
          // exercises a real user choice rather than the implicit default.
          defaultValues: { tier: 'pro' },
          validationMode: 'lax',
        })
        captured.api = form
        return () =>
          h('div', [
            withDirectives(h('input', { type: 'radio', value: 'free', class: 'free' }), [
              [vRegister, form.register('tier')],
            ]),
            withDirectives(h('input', { type: 'radio', value: 'pro', class: 'pro' }), [
              [vRegister, form.register('tier')],
            ]),
            withDirectives(h('input', { type: 'radio', value: 'enterprise', class: 'ent' }), [
              [vRegister, form.register('tier')],
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
    const free = root.querySelector('input.free') as HTMLInputElement
    const pro = root.querySelector('input.pro') as HTMLInputElement
    const ent = root.querySelector('input.ent') as HTMLInputElement

    // Mount: only `pro` checked (the default).
    expect(free.checked).toBe(false)
    expect(pro.checked).toBe(true)
    expect(ent.checked).toBe(false)
    expect(captured.api.values.tier).toBe('pro')

    // User selects `enterprise` — fire the change handler. (Setting
    // .checked = true on a radio doesn't auto-uncheck siblings in
    // jsdom; we do that manually to mirror real browser behavior.)
    free.checked = false
    pro.checked = false
    ent.checked = true
    dispatchChange(ent)
    await flush()
    expect(captured.api.values.tier).toBe('enterprise')

    // User selects `free`.
    free.checked = true
    pro.checked = false
    ent.checked = false
    dispatchChange(free)
    await flush()
    expect(captured.api.values.tier).toBe('free')
  })

  it('mounts with el.checked synced to the model', async () => {
    const schema = z.object({ tier: z.enum(['free', 'pro', 'enterprise']) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'radio-mount',
          defaultValues: { tier: 'enterprise' },
          validationMode: 'lax',
        })
        captured.api = form
        return () =>
          h('div', [
            withDirectives(h('input', { type: 'radio', value: 'free', class: 'free' }), [
              [vRegister, form.register('tier')],
            ]),
            withDirectives(h('input', { type: 'radio', value: 'pro', class: 'pro' }), [
              [vRegister, form.register('tier')],
            ]),
            withDirectives(h('input', { type: 'radio', value: 'enterprise', class: 'ent' }), [
              [vRegister, form.register('tier')],
            ]),
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    expect((root.querySelector('input.free') as HTMLInputElement).checked).toBe(false)
    expect((root.querySelector('input.pro') as HTMLInputElement).checked).toBe(false)
    expect((root.querySelector('input.ent') as HTMLInputElement).checked).toBe(true)
  })

  it('reflects programmatic setValue on the radio elements (re-render path)', async () => {
    // The model→DOM direction requires either the compile-time
    // input-text-area-transform's synthesized `:checked` binding
    // (production path — Vue tracks the binding and patches `el.checked`
    // on every reactive update) OR a parent re-render that fires the
    // directive's `beforeUpdate` hook. This raw-`h()` test covers the
    // latter: include the form's value in the render function so a
    // setValue call triggers a re-render → `beforeUpdate` → setChecked.
    const schema = z.object({ tier: z.enum(['free', 'pro', 'enterprise']) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'radio-setvalue',
          defaultValues: { tier: 'free' },
          validationMode: 'lax',
        })
        captured.api = form
        const tierRef = form.toRef('tier')
        return () =>
          h('div', [
            // Read tierRef so the parent re-renders on form-state
            // change — mirrors what a real template does when it
            // renders any reactive form-derived value.
            h('span', { class: 'tier-label' }, String(tierRef.value)),
            withDirectives(h('input', { type: 'radio', value: 'free', class: 'free' }), [
              [vRegister, form.register('tier')],
            ]),
            withDirectives(h('input', { type: 'radio', value: 'pro', class: 'pro' }), [
              [vRegister, form.register('tier')],
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
    const free = root.querySelector('input.free') as HTMLInputElement
    const pro = root.querySelector('input.pro') as HTMLInputElement

    expect(free.checked).toBe(true)
    expect(pro.checked).toBe(false)
    ;(captured.api.setValue as (path: 'tier', value: 'pro') => boolean)('tier', 'pro')
    await flush()
    expect(free.checked).toBe(false)
    expect(pro.checked).toBe(true)
  })

  it('mounts with NO radio checked when the model matches no option-value', async () => {
    // Out-of-enum default — slim-gate-incompatible with strict zod
    // parsing but the slim primitive (string) accepts it. The radio
    // group should leave every option unchecked rather than picking
    // an arbitrary one.
    const schema = z.object({ tier: z.enum(['free', 'pro', 'enterprise']) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'radio-no-match',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          defaultValues: { tier: 'unknown' as any },
          validationMode: 'lax',
        })
        captured.api = form
        return () =>
          h('div', [
            withDirectives(h('input', { type: 'radio', value: 'free', class: 'free' }), [
              [vRegister, form.register('tier')],
            ]),
            withDirectives(h('input', { type: 'radio', value: 'pro', class: 'pro' }), [
              [vRegister, form.register('tier')],
            ]),
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    expect((root.querySelector('input.free') as HTMLInputElement).checked).toBe(false)
    expect((root.querySelector('input.pro') as HTMLInputElement).checked).toBe(false)
  })
})

describe('<input type="radio" v-register> — hydration with static value attribute', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('honors the DOM value attribute when Vue has not patched _value (post-hydrate shape)', async () => {
    // Mirror of the checkbox hydration test: SSR renders <input
    // type="radio" value="pro"> as a static attribute; Vue's
    // hydration fast path skips patchProp, so el._value isn't set.
    // The directive must still resolve the option-value via the DOM
    // attribute (el.value) so el.checked reflects the model.
    const schema = z.object({ tier: z.enum(['free', 'pro', 'enterprise']) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'radio-static-value',
          defaultValues: { tier: 'pro' },
          validationMode: 'lax',
        })
        captured.api = form
        // Read the form value so a setValue() triggers a parent
        // re-render → directive's `beforeUpdate` → setChecked. Without
        // this read, the raw-`h()` parent doesn't subscribe to form
        // state and the directive's beforeUpdate never fires.
        // (The compile-time input-text-area transform's synthesized
        // `:checked` binding makes this implicit in real templates.)
        const tierRef = form.toRef('tier')
        return () =>
          h('div', [
            h('span', { class: 'tier-label' }, String(tierRef.value)),
            withDirectives(h('input', { type: 'radio', value: 'free', class: 'free' }), [
              [vRegister, form.register('tier')],
            ]),
            withDirectives(h('input', { type: 'radio', value: 'pro', class: 'pro' }), [
              [vRegister, form.register('tier')],
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
    const free = root.querySelector('input.free') as HTMLInputElement
    const pro = root.querySelector('input.pro') as HTMLInputElement

    // Strip the Vue-patched _value to mimic post-hydration shape.
    delete (free as unknown as { _value?: unknown })._value
    delete (pro as unknown as { _value?: unknown })._value

    // Trigger a model change so beforeUpdate fires setChecked, which
    // is the path that reads vnode.props?.['value'] (post-fix:
    // getValue(el) with the DOM-attribute fallback).
    ;(captured.api.setValue as (path: 'tier', value: 'free') => boolean)('tier', 'free')
    await flush()

    expect(free.checked).toBe(true)
    expect(pro.checked).toBe(false)
  })
})

describe('<input type="radio" v-register> — slim-gate interactions', () => {
  let app: App | undefined
  let warnSpy: ReturnType<typeof vi.spyOn>

  afterEach(() => {
    app?.unmount()
    app = undefined
    warnSpy?.mockRestore()
    document.body.innerHTML = ''
  })

  it('rejects a non-string write to a string-enum-bound radio path', async () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = z.object({ tier: z.enum(['free', 'pro']) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        captured.api = useForm({
          schema,
          key: 'radio-gate',
          defaultValues: { tier: 'free' },
          validationMode: 'lax',
        })
        return () => h('div')
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')
    // z.enum(['free','pro']) slim = string. Writing a number is rejected
    // by the slim-primitive gate (kind mismatch).
    const setVal = captured.api.setValue as (path: 'tier', value: unknown) => boolean
    expect(setVal('tier', 1)).toBe(false)
    expect(captured.api.values.tier).toBe('free')
  })

  it('accepts an out-of-enum string (refinement check, not a write-time gate)', async () => {
    const schema = z.object({ tier: z.enum(['free', 'pro']) })
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        captured.api = useForm({
          schema,
          key: 'radio-out-of-enum',
          defaultValues: { tier: 'free' },
          validationMode: 'lax',
        })
        return () => h('div')
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')
    // The slim primitive for z.enum(string) is just 'string'; the
    // enum-membership constraint is a refinement that surfaces via
    // field-level validation, not the slim-gate.
    const setVal = captured.api.setValue as (path: 'tier', value: unknown) => boolean
    expect(setVal('tier', 'unknown-tier')).toBe(true)
    expect(captured.api.values.tier).toBe('unknown-tier')
  })
})
