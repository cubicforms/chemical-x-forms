// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { assignKey, vRegister } from '../../src/runtime/core/directive'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { useRegister } from '../../src/runtime/composables/use-register'

/**
 * Runtime contract for `<MyComponent v-register="register(...)" />`.
 *
 * Four supported component patterns (from
 * `docs/recipes/components.md`):
 *
 *   1. Native form-element root          — directive lands on the input, just works
 *   2. `useRegister()` inside the child  — child re-binds inner native element
 *   3. `@update:registerValue` listener  — assigner override (requires supported-tag root)
 *   4. `assignKey` escape hatch          — low-level, kept-current behaviour
 *
 * Each describe block tests one pattern (or a non-pattern, for the
 * "no escape hatch" case where the directive must NOT attach
 * listeners to a non-form root). The plan-of-record for this work is
 * `~/.claude/plans/excellent-findings-i-would-drifting-micali.md`.
 */

const schema = z.object({ email: z.string(), name: z.string() })
type ApiReturn = ReturnType<typeof useForm<typeof schema>>

type MountReturn = {
  app: App
  api: ApiReturn
  /** The component's rendered root DOM element, populated post-mount. */
  rootEl: HTMLElement
  warnings: string[]
}

/**
 * Mount a parent component that renders `<Child v-register="api.register('email')" />`.
 *
 * The bridge props (`registerValue: rv` + `value: rv.innerRef.value`)
 * are passed alongside the directive — this mirrors the AST output of
 * `selectNodeTransform`'s component branch so the runtime test
 * exercises the same prop / attr surface a compiled template would
 * produce. Tests that don't read these props are unaffected.
 */
async function mountWithChild(
  Child: ReturnType<typeof defineComponent>,
  options?: {
    persist?: boolean
    acknowledgeSensitive?: boolean
    onUpdateRegisterValue?: (...args: unknown[]) => void
    installAssigner?: (el: HTMLElement) => void
  }
): Promise<MountReturn> {
  const handle: { api?: ApiReturn } = {}
  const warnings: string[] = []
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(' '))
  })

  const Parent = defineComponent({
    setup() {
      // When the test opts into per-element `persist: true`, the form
      // must also configure `persist:` — opting a field into a feature
      // the form doesn't have is now a contradiction throw.
      const api = useForm({
        schema,
        key: `comp-${Math.random().toString(36).slice(2)}`,
        ...(options?.persist ? { persist: { storage: 'local' as const, debounceMs: 1000 } } : {}),
      })
      handle.api = api
      const rv = api.register('email', {
        ...(options?.persist ? { persist: true } : {}),
        ...(options?.acknowledgeSensitive ? { acknowledgeSensitive: true } : {}),
      })
      return () =>
        withDirectives(
          h(
            Child,
            {
              registerValue: rv,
              value: rv.innerRef.value,
              ...(options?.onUpdateRegisterValue
                ? { 'onUpdate:registerValue': options.onUpdateRegisterValue }
                : {}),
            },
            { default: () => [h('span', 'slot')] }
          ),
          [[vRegister, rv]]
        )
    },
  })

  const app = createApp(Parent).use(createChemicalXForms())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  // The directive's "is a no-op" warn is deferred via `nextTick` so
  // that `useRegister`'s `onMounted` marker (and any post-install
  // assignKey) has a chance to land before the warn check runs.
  // Flush microtasks before restoring the spy so the captured
  // `warnings` array reflects the post-deferred state.
  await flush()
  warnSpy.mockRestore()

  const rootEl = root.firstElementChild as HTMLElement | null
  if (handle.api === undefined) throw new Error('mountWithChild: api never set')
  if (rootEl === null)
    throw new Error('mountWithChild: no firstElementChild — multi-root or empty render')
  if (options?.installAssigner) options.installAssigner(rootEl)
  return { app, api: handle.api, rootEl, warnings }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('pattern 1: v-register on a component whose root is <input>', () => {
  let mounted: MountReturn | undefined

  afterEach(() => {
    mounted?.app.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  it('the directive sees the inner <input> as `el` — typing dispatches a write', async () => {
    const ChildInput = defineComponent({
      name: 'ChildInput',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('input', { type: 'text', ...attrs })
      },
    })
    mounted = await mountWithChild(ChildInput)
    expect(mounted.rootEl.tagName).toBe('INPUT')

    const input = mounted.rootEl as HTMLInputElement
    input.value = 'alice@example.com'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(mounted.api.values.email).toBe('alice@example.com')
  })

  it('does NOT fire the unsupported-element dev-warn (input is in SUPPORTED_TAGS)', async () => {
    const ChildInput = defineComponent({
      name: 'ChildInput',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('input', { type: 'text', ...attrs })
      },
    })
    mounted = await mountWithChild(ChildInput)
    const matched = mounted.warnings.filter((w) => w.includes('is a no-op'))
    expect(matched.length).toBe(0)
  })
})

describe('pattern 2: v-register on a non-form root WITH useRegister (recommended)', () => {
  let mounted: MountReturn | undefined

  afterEach(() => {
    mounted?.app.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  /**
   * Child renders <div><input v-register="register" /></div>. The
   * inner input is what the directive binds to; the parent's <div>
   * root carries no listeners and no FormStore registration. The
   * sentinel set by useRegister suppresses the unsupported-element
   * warn.
   */
  const InnerInputViaUseRegister = defineComponent({
    name: 'InnerInputViaUseRegister',
    inheritAttrs: false,
    setup() {
      const register = useRegister()
      return { register }
    },
    render() {
      return h('div', { class: 'wrapper' }, [
        withDirectives(h('input', { type: 'text', class: 'inner' }), [[vRegister, this.register]]),
      ])
    },
  })

  it('typing in the inner input writes through to the form (the binding follows useRegister)', async () => {
    mounted = await mountWithChild(InnerInputViaUseRegister)
    expect(mounted.rootEl.tagName).toBe('DIV')

    const innerInput = mounted.rootEl.querySelector('input.inner') as HTMLInputElement
    expect(innerInput).not.toBeNull()
    innerInput.value = 'typed'
    innerInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(mounted.api.values.email).toBe('typed')
  })

  it('does NOT fire the unsupported-element dev-warn (sentinel suppresses)', async () => {
    mounted = await mountWithChild(InnerInputViaUseRegister)
    const matched = mounted.warnings.filter((w) => w.includes('is a no-op'))
    expect(matched.length).toBe(0)
  })

  it('FormStore element registry tracks the INNER input, not the div root', async () => {
    mounted = await mountWithChild(InnerInputViaUseRegister)
    // The inner input is INTERACTIVE; focus listeners attached during
    // its v-register `created` flip `focused` from null to true on the
    // FieldRecord. If listeners had attached to the div root instead,
    // a focus on the inner input wouldn't bubble through to a
    // div-mounted listener and `focused` would stay null.
    const innerInput = mounted.rootEl.querySelector('input.inner') as HTMLInputElement
    expect(innerInput).not.toBeNull()
    innerInput.focus()
    innerInput.dispatchEvent(new Event('focus', { bubbles: true }))
    await flush()
    expect(mounted.api.fields.email.focused).toBe(true)
  })
})

describe('non-pattern: v-register on a non-form root WITHOUT useRegister/assignKey', () => {
  let mounted: MountReturn | undefined

  afterEach(() => {
    mounted?.app.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  const PlainDivChild = defineComponent({
    name: 'PlainDivChild',
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () => h('div', attrs, [h('input', { type: 'text', class: 'inner' })])
    },
  })

  it('fires the unsupported-element dev-warn (div is not in SUPPORTED_TAGS)', async () => {
    mounted = await mountWithChild(PlainDivChild)
    expect(mounted.rootEl.tagName).toBe('DIV')
    const matched = mounted.warnings.filter((w) => w.includes('is a no-op'))
    expect(matched.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT clobber the seeded form value — no listeners attached to the div root', async () => {
    mounted = await mountWithChild(PlainDivChild)
    mounted.api.setValue('email', 'seed@example.com')
    expect(mounted.api.values.email).toBe('seed@example.com')

    const innerInput = mounted.rootEl.querySelector('input.inner') as HTMLInputElement
    innerInput.value = 'typed'
    innerInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    // With listeners SKIPPED on the unsupported root, the bubbled event
    // doesn't reach a directive listener, doesn't read `el.value` off
    // the div, and doesn't write the empty/undefined string to the
    // form. The seeded value survives.
    expect(mounted.api.values.email).toBe('seed@example.com')
  })

  it('FormStore element registry SKIPS non-INTERACTIVE roots (silent no-op)', async () => {
    mounted = await mountWithChild(PlainDivChild)
    const fs = mounted.api.fields.email
    expect(fs.focused).toBeNull()
    expect(fs.blurred).toBeNull()
    expect(fs.touched).toBeNull()
  })
})

describe('pattern 4: v-register on a non-form root WITH assignKey (kept-current escape hatch)', () => {
  let mounted: MountReturn | undefined

  afterEach(() => {
    mounted?.app.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  /**
   * `assignKey` is a low-level escape hatch documented at the directive
   * surface. When installed, the directive suppresses the unsupported-
   * element warn AND keeps its current text-input listener wiring —
   * i.e. listeners attach, read `el.value` off the (non-input) root,
   * and call the consumer's assigner with whatever that read returns.
   * The contract here is "I'll handle the binding, don't yell at me";
   * the consumer is responsible for sourcing the right value
   * themselves (e.g. by attaching a separate listener on the inner
   * input). This is the pattern's documented limitation and is NOT a
   * bug; the recommended path for non-form roots is `useRegister`.
   */
  it('suppresses the unsupported-element warn AND keeps listeners attached + assigner-fires', async () => {
    // The directive's tri-state guard reads `assignKey` at `created`-time.
    // To install the consumer's assigner BEFORE `vRegister.created`
    // fires, we use a small companion directive ordered first in the
    // directive list — Vue 3 runs directives in array order, so
    // `vInstallAssignKey.created` lands the assigner on the element
    // before the `vRegister` lookup. ref-callbacks fire AFTER `created`
    // (timing footgun documented in the recipe doc); this is the only
    // clean way to verify the "assignKey installed at created-time"
    // half of the contract from a runtime test.
    const received: unknown[] = []
    const vInstallAssignKey = {
      created(el: HTMLElement) {
        ;(el as unknown as { [k: symbol]: unknown })[assignKey] = (v: unknown) => {
          received.push(v)
        }
      },
    }

    const warnings: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })

    const ChildDiv = defineComponent({
      name: 'ChildDiv',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('div', attrs, [h('input', { type: 'text' })])
      },
    })

    const Parent = defineComponent({
      setup() {
        const api = useForm({ schema, key: `assigner-${Math.random().toString(36).slice(2)}` })
        const rv = api.register('email')
        return () =>
          withDirectives(h(ChildDiv, { registerValue: rv, value: rv.innerRef.value }), [
            [vInstallAssignKey],
            [vRegister, rv],
          ])
      },
    })

    const app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    warnSpy.mockRestore()

    // Warn is suppressed (assignKey was installed at `created`-time).
    const matched = warnings.filter((w) => w.includes('is a no-op'))
    expect(matched.length).toBe(0)

    // Listeners DID attach (kept-current) — typing in the inner input
    // bubbles to the div root, hits the directive's text-input
    // listener, which reads `el.value` (the div's) and calls the
    // consumer's assigner. The value is el.value-sourced, so it isn't
    // 'typed' — that's the documented limitation pointing consumers
    // toward useRegister.
    const innerInput = root.querySelector('input') as HTMLInputElement
    innerInput.value = 'typed'
    innerInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received).not.toContain('typed')

    app.unmount()
  })
})

describe('pattern 3: @update:registerValue prop on a component', () => {
  let mounted: MountReturn | undefined

  afterEach(() => {
    mounted?.app.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  it('replaces the default assigner with the listener function (input-rooted child)', async () => {
    const received: unknown[] = []
    const ChildInput = defineComponent({
      name: 'ChildInput',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('input', { type: 'text', ...attrs })
      },
    })
    mounted = await mountWithChild(ChildInput, {
      onUpdateRegisterValue: (v: unknown) => {
        received.push(v)
      },
    })

    const input = mounted.rootEl as HTMLInputElement
    input.value = 'typed'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(received).toContain('typed')
    // Default assigner was bypassed — the FormStore did NOT receive
    // the write because the listener didn't forward.
    expect(mounted.api.values.email).toBe('')
  })
})

describe('v-register="undefined" is a graceful no-op (invariant 4)', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('mounts cleanly with no warn — directive installs a no-op assigner across updates', async () => {
    const warnings: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })

    // Use a ref so the parent re-renders, exercising the directive's
    // `beforeUpdate` path. Without this, setAssignFunction would only
    // run via `created` (which currently early-returns before the
    // warn for undefined RVs); the bug we're guarding against fires
    // on the update path.
    const trigger = ref(0)
    const Parent = defineComponent({
      setup() {
        return () =>
          withDirectives(h('input', { type: 'text', 'data-trigger': trigger.value }), [
            [vRegister, undefined as unknown],
          ])
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    trigger.value += 1
    await flush()
    trigger.value += 1
    await flush()

    warnSpy.mockRestore()

    // No "expected RegisterValue, got undefined" warn from the
    // directive's setAssignFunction (it early-returns on undefined).
    const matched = warnings.filter(
      (w) =>
        w.includes('expected value of type RegisterValue') ||
        w.includes('got value of type undefined')
    )
    expect(matched.length).toBe(0)

    // Typing into the input doesn't throw (the no-op assigner just
    // discards the write).
    const input = root.firstElementChild as HTMLInputElement
    input.value = 'whatever'
    expect(() => input.dispatchEvent(new Event('input', { bubbles: true }))).not.toThrow()
    await flush()
  })

  it('a standalone-rendered component (no parent v-register, useRegister fallback) mounts cleanly with a single warn', async () => {
    const warnings: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })

    const StandaloneInput = defineComponent({
      name: 'StandaloneInput',
      inheritAttrs: false,
      setup() {
        const register = useRegister()
        return { register }
      },
      render() {
        return h('div', null, [
          withDirectives(h('input', { type: 'text' }), [[vRegister, this.register]]),
        ])
      },
    })

    const Parent = defineComponent({
      setup() {
        return () => h(StandaloneInput)
      },
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()
    warnSpy.mockRestore()

    // useRegister fires its "no parent registerValue" warn ONCE.
    // The directive's setAssignFunction does NOT fire its
    // "expected RegisterValue" warn (invariant 4 silences undefined).
    const useRegisterWarns = warnings.filter(
      (w) => w.includes('useRegister') || w.includes('no parent registerValue')
    )
    expect(useRegisterWarns.length).toBe(1)

    const directiveWarns = warnings.filter(
      (w) =>
        w.includes('expected value of type RegisterValue') ||
        w.includes('got value of type undefined')
    )
    expect(directiveWarns.length).toBe(0)
  })
})

describe('listener teardown on component unmount (works ✓)', () => {
  let mounted: MountReturn | undefined

  afterEach(() => {
    mounted?.app.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  it('removes every directive listener it added when the parent unmounts', async () => {
    const ChildInput = defineComponent({
      name: 'ChildInput',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('input', { type: 'text', ...attrs })
      },
    })
    mounted = await mountWithChild(ChildInput)
    const counts = { added: 0, removed: 0 }
    const el = mounted.rootEl
    const origAdd = el.addEventListener.bind(el)
    const origRemove = el.removeEventListener.bind(el)
    el.addEventListener = ((...args: Parameters<Element['addEventListener']>) => {
      counts.added += 1
      origAdd(...args)
    }) as Element['addEventListener']
    el.removeEventListener = ((...args: Parameters<Element['removeEventListener']>) => {
      counts.removed += 1
      origRemove(...args)
    }) as Element['removeEventListener']

    mounted.api.setValue('name', 'x')
    await flush()
    expect(counts.added).toBe(0)
    expect(counts.removed).toBe(0)

    mounted.app.unmount()
    mounted = undefined

    expect(counts.removed).toBeGreaterThanOrEqual(1)
  })
})

describe('persist opt-in lifecycle on a component (works ✓)', () => {
  let mounted: MountReturn | undefined

  afterEach(() => {
    mounted?.app.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  it('opt-in entry exists while the component is mounted, gone after unmount', async () => {
    const ChildInput = defineComponent({
      name: 'ChildInput',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('input', { type: 'text', ...attrs })
      },
    })
    mounted = await mountWithChild(ChildInput, {
      persist: true,
      acknowledgeSensitive: false,
    })

    const internal = mounted.api as unknown as {
      register: (path: string) => {
        path: string
        persistOptIns: { hasAnyOptInForPath: (p: string) => boolean }
      }
    }
    const probe = internal.register('email')
    expect(probe.persistOptIns.hasAnyOptInForPath(probe.path)).toBe(true)

    mounted.app.unmount()
    mounted = undefined
    const fresh = await mountWithChild(ChildInput, { persist: false })
    const freshProbe = (
      fresh.api as unknown as {
        register: (path: string) => {
          path: string
          persistOptIns: { hasAnyOptInForPath: (p: string) => boolean }
        }
      }
    ).register('email')
    expect(freshProbe.persistOptIns.hasAnyOptInForPath(freshProbe.path)).toBe(false)
    fresh.app.unmount()
  })
})

describe("multi-root component — directive lands on Vue's placeholder ⚠", () => {
  let originalConsoleWarn: typeof console.warn
  beforeEach(() => {
    originalConsoleWarn = console.warn
  })
  afterEach(() => {
    console.warn = originalConsoleWarn
    document.body.innerHTML = ''
  })

  it('Vue warns and the v-register directive becomes a no-op', async () => {
    const collected: string[] = []
    console.warn = (...args: unknown[]) => {
      collected.push(args.map((a) => String(a)).join(' '))
    }
    const Multi = defineComponent({
      name: 'Multi',
      inheritAttrs: false,
      setup() {
        return () => [h('span', 'a'), h('span', 'b')]
      },
    })

    const Parent = defineComponent({
      setup() {
        const api = useForm({ schema, key: `multi-${Math.random().toString(36).slice(2)}` })
        const rv = api.register('email')
        return () => withDirectives(h(Multi), [[vRegister, rv]])
      },
    })

    const app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const matched = collected.filter(
      (w) =>
        w.includes('Runtime directive used on component with non-element root') ||
        w.includes('non-element root') ||
        w.includes('is a no-op')
    )
    expect(matched.length).toBeGreaterThanOrEqual(1)

    app.unmount()
  })
})

describe('component re-render with prop change does NOT leak listeners (works ✓)', () => {
  it('beforeUpdate path keeps the listener bag size stable', async () => {
    const ChildInput = defineComponent({
      name: 'ChildInput',
      props: { hint: { type: String, default: '' } },
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('input', { type: 'text', ...attrs })
      },
    })

    const hint = ref('one')
    const Parent = defineComponent({
      setup() {
        const api = useForm({ schema, key: `rerender-${Math.random().toString(36).slice(2)}` })
        const rv = api.register('email')
        return () =>
          withDirectives(h(ChildInput, { hint: hint.value, registerValue: rv }), [[vRegister, rv]])
      },
    })
    const app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const el = root.firstElementChild as HTMLElement
    const counts = { added: 0, removed: 0 }
    const origAdd = el.addEventListener.bind(el)
    const origRemove = el.removeEventListener.bind(el)
    el.addEventListener = ((...args: Parameters<Element['addEventListener']>) => {
      counts.added += 1
      origAdd(...args)
    }) as Element['addEventListener']
    el.removeEventListener = ((...args: Parameters<Element['removeEventListener']>) => {
      counts.removed += 1
      origRemove(...args)
    }) as Element['removeEventListener']

    for (let i = 0; i < 5; i++) {
      hint.value = `iter-${i}`
      await flush()
    }
    expect(counts.added).toBe(0)
    expect(counts.removed).toBe(0)

    app.unmount()
  })
})
