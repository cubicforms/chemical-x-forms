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

  it("directive does NOT attach listeners to a sentinel-marked child's root", async () => {
    const Child = defineComponent({
      name: 'NoListenersChild',
      inheritAttrs: false,
      setup() {
        const register = useRegister()
        return { register }
      },
      render() {
        return h('div', { class: 'wrapper' }, [
          withDirectives(h('input', { type: 'text', class: 'inner' }), [
            [vRegister, this.register],
          ]),
        ])
      },
    })

    const adds: string[] = []
    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'no-listeners-test' })
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

    // Patch addEventListener globally on Element.prototype BEFORE mount
    // so we capture every call. We snapshot the root <div>'s adds vs.
    // the inner <input>'s adds by tagName.
    const origAdd = Element.prototype.addEventListener
    const addByTag = new Map<string, number>()
    Element.prototype.addEventListener = function (
      this: Element,
      ...args: Parameters<Element['addEventListener']>
    ) {
      addByTag.set(this.tagName, (addByTag.get(this.tagName) ?? 0) + 1)
      adds.push(`${this.tagName}:${args[0]}`)
      return origAdd.apply(this, args)
    } as Element['addEventListener']

    try {
      app.mount(root)
      await flush()
    } finally {
      Element.prototype.addEventListener = origAdd
    }

    const rootEl = root.firstElementChild as HTMLElement | null
    expect(rootEl?.tagName).toBe('DIV')

    // The parent's directive on the <div> root MUST NOT attach
    // listeners to the div. The inner <input>'s own v-register DOES
    // attach listeners (input/change/composition).
    const divAdds = addByTag.get('DIV') ?? 0
    const inputAdds = addByTag.get('INPUT') ?? 0
    expect(divAdds).toBe(0)
    expect(inputAdds).toBeGreaterThanOrEqual(1)
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
    expect(captured.api.getFieldState('email').value.focused).toBe(true)
  })
})
