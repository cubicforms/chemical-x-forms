// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, isRef, nextTick, ref, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useRegister } from '../../src/runtime/composables/use-register'
import { vRegister } from '../../src/runtime/core/directive'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * Unit tests for the `useRegister()` composable. The composable's
 * contract has three resolution modes:
 *
 *   1. Called in a child setup with a parent-supplied registerValue
 *      attr → returns ComputedRef<RegisterValue>.
 *   2. Called in a child setup with NO parent-supplied registerValue
 *      → returns ComputedRef<undefined> + one-shot dev-warn.
 *   3. Called outside any setup scope → returns ComputedRef<undefined>
 *      + one-shot dev-warn. NEVER throws.
 *
 * Rationale for the "always degrade" stance: the recent useFormContext
 * shift (PR #149) traded a throw for warn-and-null so a typo'd key in
 * a deeply nested component doesn't take the whole page down. The
 * same reasoning applies here — a parent that forgot to pass v-register
 * shouldn't crash production, just nag in dev.
 */

const schema = z.object({ email: z.string(), name: z.string() })

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('useRegister — outside setup', () => {
  it('returns a ComputedRef whose .value is undefined; warns once; does not throw', () => {
    const warnings: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })

    let result: ReturnType<typeof useRegister> | undefined
    expect(() => {
      result = useRegister()
    }).not.toThrow()

    warnSpy.mockRestore()

    expect(result).toBeDefined()
    if (result === undefined) throw new Error('unreachable')
    expect(isRef(result)).toBe(true)
    expect(result.value).toBeUndefined()

    // One-shot dev-warn; the message identifies useRegister as the
    // source so a developer reading the console knows which composable
    // misfired.
    const matched = warnings.filter((w) => w.includes('useRegister'))
    expect(matched.length).toBeGreaterThanOrEqual(1)
  })
})

describe('useRegister — inside child setup', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('with NO parent registerValue → returns ComputedRef<undefined> + one-shot warn', async () => {
    const captured: { register?: ReturnType<typeof useRegister> } = {}
    const warnings: string[] = []

    const Child = defineComponent({
      name: 'Child',
      inheritAttrs: false,
      setup() {
        captured.register = useRegister()
        return () => h('input', { type: 'text' })
      },
    })

    const Parent = defineComponent({
      setup() {
        return () => h(Child)
      },
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    // Computed is lazy — `.value` triggers evaluation, which is what
    // fires the no-parent-RV warn. Read it BEFORE restoring the spy
    // so the warn lands in the captured `warnings` array.
    expect(captured.register).toBeDefined()
    if (captured.register === undefined) throw new Error('unreachable')
    expect(captured.register.value).toBeUndefined()

    warnSpy.mockRestore()

    const matched = warnings.filter((w) => w.includes('useRegister'))
    expect(matched.length).toBeGreaterThanOrEqual(1)
  })

  it('with parent registerValue → does NOT emit the no-parent-RV warn during initial render (regression: pre-onBeforeMount capture race)', async () => {
    // Setup-time reads of `instance.attrs.registerValue` race Vue's
    // prop-patch lifecycle. Before this test was added, useRegister
    // captured the binding synchronously in setup — under SSR (and
    // some CSR patterns) the binding wasn't on attrs yet, so the
    // captured value was `undefined` and the computed warned on the
    // first read despite the parent passing v-register correctly.
    // The capture is now deferred to onBeforeMount; this test asserts
    // that the deferred capture lands the binding before the child's
    // render function reads the computed for the first time.
    const captured: { childRegister?: ReturnType<typeof useRegister> } = {}

    const Child = defineComponent({
      name: 'Child',
      inheritAttrs: false,
      setup() {
        captured.childRegister = useRegister()
        // Read the computed inside the render function — same pattern
        // a real consumer's template uses.
        return () => {
          const rv = captured.childRegister?.value
          return h('input', { type: 'text', 'data-rv-bound': rv !== undefined ? '1' : '0' })
        }
      },
    })

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'no-warn-on-mount-test' })
        const rv = form.register('email')
        return () =>
          withDirectives(h(Child, { registerValue: rv, value: rv.innerRef.value }), [
            [vRegister, rv],
          ])
      },
    })

    const warnings: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()
    warnSpy.mockRestore()

    // The render-time read of `captured.childRegister.value` should
    // have produced a non-undefined RV — no warn fired.
    const noParentRvWarn = warnings.filter((w) =>
      w.includes('useRegister: no parent registerValue prop')
    )
    expect(noParentRvWarn).toEqual([])

    // Sanity: the data attribute reflects the RV being bound at first
    // render (i.e. the child saw the binding before its template ran).
    const inputEl = root.querySelector('input')
    expect(inputEl?.getAttribute('data-rv-bound')).toBe('1')
  })

  it("with parent registerValue → returns ComputedRef whose .value === parent's RV (referential)", async () => {
    const captured: {
      parentRV?: ReturnType<ReturnType<typeof useForm<typeof schema>>['register']>
      childRegister?: ReturnType<typeof useRegister>
    } = {}

    const Child = defineComponent({
      name: 'Child',
      inheritAttrs: false,
      setup() {
        captured.childRegister = useRegister()
        return () => h('input', { type: 'text' })
      },
    })

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'parent-rv-test' })
        const rv = form.register('email')
        captured.parentRV = rv
        return () =>
          withDirectives(h(Child, { registerValue: rv, value: rv.innerRef.value }), [
            [vRegister, rv],
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    expect(captured.parentRV).toBeDefined()
    expect(captured.childRegister).toBeDefined()
    if (captured.parentRV === undefined || captured.childRegister === undefined)
      throw new Error('unreachable')
    expect(captured.childRegister.value).toBe(captured.parentRV)
  })

  it('reactive: parent rotating the registerValue → child observes the fresh RV', async () => {
    const captured: { childRegister?: ReturnType<typeof useRegister> } = {}
    const fieldName = ref<'email' | 'name'>('email')

    const Child = defineComponent({
      name: 'Child',
      inheritAttrs: false,
      setup() {
        captured.childRegister = useRegister()
        return () => h('input', { type: 'text' })
      },
    })

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'parent-reactive-test' })
        return () => {
          const rv = form.register(fieldName.value)
          return withDirectives(h(Child, { registerValue: rv, value: rv.innerRef.value }), [
            [vRegister, rv],
          ])
        }
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    expect(captured.childRegister).toBeDefined()
    if (captured.childRegister === undefined) throw new Error('unreachable')
    const initial = captured.childRegister.value
    expect(initial).toBeDefined()
    expect(initial?.path).toBe(JSON.stringify(['email']))

    fieldName.value = 'name'
    await flush()

    const rotated = captured.childRegister.value
    expect(rotated).toBeDefined()
    expect(rotated?.path).toBe(JSON.stringify(['name']))
    expect(rotated).not.toBe(initial)
  })
})

describe('useRegister — sentinel suppresses parent-directive warn', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  /**
   * The sentinel WeakSet entry that `useRegister` sets on the child
   * instance is what tells the parent's `vRegisterDynamic.created`
   * "this child handles binding internally — don't warn, don't attach
   * listeners". This test verifies the sentinel is set even when the
   * child renders a non-supported root (div, span, kebab-element).
   */
  it.each([
    ['div', 'div-rooted'],
    ['span', 'span-rooted'],
    ['custom-thing', 'kebab-rooted'],
  ])('child returning a <%s> root with useRegister suppresses the warn (%s)', async (rootTag) => {
    const warnings: string[] = []

    const Child = defineComponent({
      name: 'SentinelChild',
      inheritAttrs: false,
      setup() {
        const register = useRegister()
        return { register }
      },
      render() {
        return h(rootTag, null, [
          withDirectives(h('input', { type: 'text', class: 'inner' }), [
            [vRegister, this.register],
          ]),
        ])
      },
    })

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: `sentinel-${rootTag}-${Math.random()}` })
        const rv = form.register('email')
        return () =>
          withDirectives(h(Child, { registerValue: rv, value: rv.innerRef.value }), [
            [vRegister, rv],
          ])
      },
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()
    warnSpy.mockRestore()

    const matched = warnings.filter((w) => w.includes('is a no-op'))
    expect(matched.length).toBe(0)
  })

  it("listeners attached to a sentinel-marked child's root BAIL on bubbled events (no clobber)", async () => {
    // The directive attaches listeners on every rendered root —
    // including a useRegister'd component's wrapper element. On
    // bubbled events from descendants, those listeners check the
    // assigner identity and bail when the default is still installed
    // (see `shouldBailListener`). Result: typing in any descendant
    // input doesn't reach the wrapper's listener with a write
    // attempt, so the form value isn't clobbered with `el.value`
    // (the wrapper's, which is junk).
    let formApi: ReturnType<typeof useForm<typeof schema>> | undefined
    const Child = defineComponent({
      name: 'NoBailChild',
      inheritAttrs: false,
      setup() {
        const register = useRegister()
        return { register }
      },
      render() {
        // Inner input has NO v-register so the only writes that could
        // reach the form are via the wrapper's listener. With the bail
        // in place, those writes don't happen.
        return h('div', { class: 'wrapper' }, [h('input', { type: 'text', class: 'inner' })])
      },
    })

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'bail-test' })
        formApi = form
        const rv = form.register('email')
        return () =>
          withDirectives(h(Child, { registerValue: rv, value: rv.innerRef.value }), [
            [vRegister, rv],
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (formApi === undefined) throw new Error('unreachable')
    formApi.setValue('email', 'seed@example.com')
    expect(formApi.values.email).toBe('seed@example.com')

    // Type into the inner input. Without the bail, the wrapper's
    // bubbled `input` listener would read `el.value` off the div and
    // clobber the seeded value. With the bail, the listener exits
    // early and the form keeps the seed.
    const innerInput = root.querySelector('input.inner') as HTMLInputElement
    innerInput.value = 'typed-clobber-attempt'
    innerInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(formApi.values.email).toBe('seed@example.com')
  })
})

describe('useRegister — inner v-register receives full directive lifecycle', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('FormStore element registry tracks the inner input + focus listeners attach', async () => {
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Child = defineComponent({
      name: 'InnerRegisterChild',
      inheritAttrs: false,
      setup() {
        const register = useRegister()
        return { register }
      },
      render() {
        return h('div', null, [
          withDirectives(h('input', { type: 'text', class: 'inner' }), [
            [vRegister, this.register],
          ]),
        ])
      },
    })

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'inner-lifecycle-test' })
        captured.api = form
        const rv = form.register('email')
        return () =>
          withDirectives(h(Child, { registerValue: rv, value: rv.innerRef.value }), [
            [vRegister, rv],
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')

    // Focus listeners attached to the inner input fire markFocused →
    // `focused` flips from null to true. If the parent's directive
    // had landed on the div root instead, the inner input's focus
    // wouldn't bubble through to a focus-event listener (the
    // directive's focus tracking installs at registerElement time).
    const innerInput = root.querySelector('input.inner') as HTMLInputElement
    expect(innerInput).not.toBeNull()
    innerInput.focus()
    innerInput.dispatchEvent(new Event('focus', { bubbles: true }))
    await flush()
    expect(captured.api.fieldState.email.focused).toBe(true)
  })
})

describe('useRegister — strips bridge keys from attrs (no inheritAttrs needed)', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  /**
   * The select-transform's component branch injects `:value` and
   * `:registerValue` on the parent's component vnode so `useRegister`
   * can read them. Those are non-prop attrs from the child's
   * perspective; without intervention they fall through to the
   * rendered root and pollute the DOM as stringified attributes
   * (`<label registerValue="[object Object]">`). `useRegister`
   * captures `registerValue` into a local ref then deletes both
   * bridge keys from `instance.attrs` before render — so the
   * rendered root has no leak, AND class/style/aria/data fallthrough
   * still works. The consumer doesn't need
   * `defineOptions({ inheritAttrs: false })`.
   */
  it('rendered root has no registerValue/value DOM attributes (no consumer inheritAttrs needed)', async () => {
    // Child does NOT set inheritAttrs:false. Bridge attrs would
    // normally fall through; useRegister strips them.
    const Child = defineComponent({
      name: 'Child',
      setup() {
        useRegister()
        return () => h('label', { class: 'wrapper' }, [h('input', { type: 'text' })])
      },
    })

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'strip-attrs-test' })
        const rv = form.register('email')
        return () =>
          withDirectives(h(Child, { registerValue: rv, value: rv.innerRef.value }), [
            [vRegister, rv],
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const label = root.querySelector('label.wrapper')
    expect(label).not.toBeNull()
    expect(label?.hasAttribute('registerValue')).toBe(false)
    expect(label?.hasAttribute('value')).toBe(false)
  })

  it('class / style / aria fallthrough still lands on the rendered root', async () => {
    // Verify the surgical-strip approach preserves what the consumer
    // legitimately wants — only the bridge keys are removed.
    const Child = defineComponent({
      name: 'Child',
      setup() {
        useRegister()
        return () => h('label', null, [h('input', { type: 'text' })])
      },
    })

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'strip-fallthrough-test' })
        const rv = form.register('email')
        return () =>
          withDirectives(
            h(Child, {
              registerValue: rv,
              value: rv.innerRef.value,
              class: 'consumer-class',
              style: 'color: red',
              'aria-label': 'a11y label',
              'data-test': 'spike',
            }),
            [[vRegister, rv]]
          )
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const label = root.querySelector('label')
    expect(label).not.toBeNull()
    expect(label?.classList.contains('consumer-class')).toBe(true)
    expect(label?.getAttribute('style')).toContain('color: red')
    expect(label?.getAttribute('aria-label')).toBe('a11y label')
    expect(label?.getAttribute('data-test')).toBe('spike')
    expect(label?.hasAttribute('registerValue')).toBe(false)
    expect(label?.hasAttribute('value')).toBe(false)
  })

  it('strip survives parent re-render (onBeforeUpdate re-strips after setFullProps repopulates)', async () => {
    // Vue's setFullProps re-assigns attrs[key] on every parent
    // re-render. onBeforeUpdate fires after that and before
    // renderComponentRoot — that's where the strip re-runs.
    const tick = ref(0)
    const Child = defineComponent({
      name: 'Child',
      setup() {
        useRegister()
        return () => h('label', { class: 'wrapper' }, [h('input', { type: 'text' })])
      },
    })

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'strip-rerender-test' })
        return () => {
          // touch tick so the parent's render effect re-runs
          void tick.value
          const rv = form.register('email')
          return withDirectives(h(Child, { registerValue: rv, value: rv.innerRef.value }), [
            [vRegister, rv],
          ])
        }
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const label = root.querySelector('label.wrapper')
    expect(label?.hasAttribute('registerValue')).toBe(false)

    tick.value += 1
    await flush()
    tick.value += 1
    await flush()

    expect(label?.hasAttribute('registerValue')).toBe(false)
    expect(label?.hasAttribute('value')).toBe(false)
  })
})
