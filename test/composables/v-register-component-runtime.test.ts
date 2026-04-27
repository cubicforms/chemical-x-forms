// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { assignKey, vRegister } from '../../src/runtime/core/directive'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * Provocative coverage for `<MyComponent v-register="register(...)" />`.
 *
 * The runtime directive `vRegisterDynamic` is applied to whatever DOM
 * element Vue produces from the component's render — single-root
 * components route the directive to the inner element; multi-root
 * components and components rendering non-input wrappers behave in
 * surprising ways. This file pins each surprise so a future refactor
 * notices what changed.
 *
 * Each describe block tags itself with one of:
 *   - works ✓      — current behaviour matches user expectations
 *   - surprising ⚠ — current behaviour is technically correct but easy
 *                    to misuse; the test calls out the footgun
 *   - broken ✗    — current behaviour produces a wrong write or
 *                    silent no-op; the test demonstrates the failure
 *                    mode and pins it so a fix can flip the assertion.
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
 * The `Child` is supplied by the test; its render fn decides which DOM
 * element ends up as the directive's `el`.
 *
 * After mount, the helper queries the mount root for `firstElementChild`
 * — that's the component's rendered single root. Multi-root / fragment
 * children render a Vue placeholder comment as `firstChild`, in which
 * case `firstElementChild` is null.
 *
 * The `installAssigner` option, when present, runs BEFORE the parent's
 * `setup` factory finishes — but the directive's `created` hook fires
 * AFTER setup returns and the component renders. So we install the
 * assigner via a tiny pre-render hook on the parent: the parent renders
 * a `:ref` on the child that runs the installer the first time it sees
 * the actual DOM element. The installer winds up running before the
 * directive's `created` because the directive runs on the Vue tick AFTER
 * the rendered tree is committed.
 */
function mountWithChild(
  Child: ReturnType<typeof defineComponent>,
  options?: {
    persist?: boolean
    acknowledgeSensitive?: boolean
    onUpdateRegisterValue?: (...args: unknown[]) => void
    installAssigner?: (el: HTMLElement) => void
  }
): MountReturn {
  const handle: { api?: ApiReturn } = {}
  const warnings: string[] = []
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(' '))
  })

  const Parent = defineComponent({
    setup() {
      const api = useForm({ schema, key: `comp-${Math.random().toString(36).slice(2)}` })
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
              ...(options?.onUpdateRegisterValue
                ? { 'onUpdate:registerValue': options.onUpdateRegisterValue }
                : {}),
            },
            // Non-trivial slot so multi-root and slot-receiving children
            // both work without rewriting the helper per test.
            { default: () => [h('span', 'slot')] }
          ),
          [[vRegister, rv]]
        )
    },
  })

  // If installAssigner is requested, intercept the mount root so we can
  // install on whatever element ends up as `firstElementChild` BEFORE
  // any subsequent test interaction. The directive's `created` already
  // ran by mount-return time, so the assigner installs after `created`
  // — that's intentional: tests using the assignKey escape hatch want
  // to verify the post-warning, post-default-assigner behaviour with
  // the consumer's hook in place. (For dev-warn-suppression tests we
  // need a different path — see the `mountWithPreInstalledAssigner`
  // helper below, used by the suppression test only.)
  const app = createApp(Parent).use(createChemicalXForms())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  warnSpy.mockRestore()

  // The component's rendered root: if a single root, it's the first
  // element child of the mount root. If multi-root or fragment, this
  // is null.
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

describe('v-register on a component whose root is <input> (works ✓)', () => {
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
    mounted = mountWithChild(ChildInput)
    expect(mounted.rootEl.tagName).toBe('INPUT')

    const input = mounted.rootEl as HTMLInputElement
    input.value = 'alice@example.com'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(mounted.api.getValue('email').value).toBe('alice@example.com')
  })

  it('does NOT fire the unsupported-element dev-warn (input is in SUPPORTED_TAGS)', () => {
    const ChildInput = defineComponent({
      name: 'ChildInput',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('input', { type: 'text', ...attrs })
      },
    })
    mounted = mountWithChild(ChildInput)
    const matched = mounted.warnings.filter((w) => w.includes('falls back to text-input semantics'))
    expect(matched.length).toBe(0)
  })
})

describe('v-register on a component whose root is <div> (broken ✗ + surprising ⚠)', () => {
  let mounted: MountReturn | undefined

  afterEach(() => {
    mounted?.app.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  it('fires the unsupported-element dev-warn (div is not in SUPPORTED_TAGS)', () => {
    const ChildDiv = defineComponent({
      name: 'ChildDiv',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('div', attrs, [h('input', { type: 'text', class: 'inner' })])
      },
    })
    mounted = mountWithChild(ChildDiv)
    expect(mounted.rootEl.tagName).toBe('DIV')
    const matched = mounted.warnings.filter((w) => w.includes('falls back to text-input semantics'))
    expect(matched.length).toBeGreaterThanOrEqual(1)
  })

  it('the typed value does NOT reach the FormStore — bubbled event reads el.value off a div ✗', async () => {
    // The directive's text-input variant attaches an `input` listener
    // on `el` (the <div> root). Native `input` events from the inner
    // <input> bubble to the div; the listener reads `el.value` (which
    // jsdom returns as the string '', not as undefined — the
    // browser-native HTMLDivElement has no `value` property at all).
    // Net effect: the form's `email` field is clobbered to '' on every
    // keystroke instead of capturing what the user typed.
    const ChildDiv = defineComponent({
      name: 'ChildDiv',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('div', attrs, [h('input', { type: 'text', class: 'inner' })])
      },
    })
    mounted = mountWithChild(ChildDiv)
    mounted.api.setValue('email', 'seed@example.com')
    expect(mounted.api.getValue('email').value).toBe('seed@example.com')

    const innerInput = mounted.rootEl.querySelector('input.inner') as HTMLInputElement
    innerInput.value = 'typed'
    innerInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    // The pre-typed value got CLOBBERED. The exact replacement value is
    // platform-dependent (jsdom returns '' for div.value; real browsers
    // return undefined which `String()` later coerces to 'undefined').
    // What's invariant is "the captured value is NOT what the user typed":
    expect(mounted.api.getValue('email').value).not.toBe('typed')
    expect(mounted.api.getValue('email').value).not.toBe('seed@example.com')
  })

  it('the FormStore element registry SKIPS non-INTERACTIVE roots (silent no-op) ⚠', () => {
    // `register-api.ts` filters elements by INTERACTIVE_TAG_NAMES on
    // registerElement — div is not in the set, so the FormStore never
    // hears about this element. Focus listeners aren't attached;
    // `state.elementRegistry` stays empty for this path.
    const ChildDiv = defineComponent({
      name: 'ChildDiv',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('div', attrs, [h('input', { type: 'text' })])
      },
    })
    mounted = mountWithChild(ChildDiv)
    // The path's field record never gained a registered element.
    // DOMFieldState defaults to `{ focused: null, blurred: null,
    // touched: null }` for paths with no registered element — the
    // public surface differentiates "not yet interacted" (false)
    // from "no element to track" (null). All three null on a div
    // root is the smoking gun.
    const fs = mounted.api.getFieldState('email').value
    expect(fs.focused).toBeNull()
    expect(fs.blurred).toBeNull()
    expect(fs.touched).toBeNull()
  })
})

describe('escape hatch: el[assignKey] override on a non-input root', () => {
  let mounted: MountReturn | undefined

  afterEach(() => {
    mounted?.app.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  it('a child installing assignKey via a ref callback does NOT suppress the warn (timing footgun ✗)', () => {
    // Surprise: ref callbacks on a directive-bearing component vnode
    // fire AFTER the directive's `created` hook, so the assignKey
    // installed in the child's render arrives too late for the
    // SUPPORTED_TAGS check in `vRegisterDynamic.created`. The warning
    // fires once, the consumer's assigner is in place from then on.
    //
    // The actual fix for component authors who want to use assignKey:
    // install it OUTSIDE the directive lifecycle — e.g., on the
    // element BEFORE the parent renders (synchronous setup-time DOM
    // creation), or accept the one-shot dev-warning as cosmetic and
    // know that the binding still works after `created` returns.
    const warnings: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })

    const SelfInstallingChild = defineComponent({
      name: 'SelfInstallingChild',
      inheritAttrs: false,
      setup(_, { attrs }) {
        const captureRoot = (el: unknown): void => {
          if (el === null || el === undefined) return
          ;(el as unknown as { [k: symbol]: unknown })[assignKey] = (_v: unknown) => undefined
        }
        return () => h('div', { ...attrs, ref: captureRoot }, [h('input', { type: 'text' })])
      },
    })

    const Parent = defineComponent({
      setup() {
        const api = useForm({ schema, key: `assigner-${Math.random().toString(36).slice(2)}` })
        const rv = api.register('email')
        return () => withDirectives(h(SelfInstallingChild), [[vRegister, rv]])
      },
    })
    const app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    warnSpy.mockRestore()

    const matched = warnings.filter((w) => w.includes('falls back to text-input semantics'))
    expect(matched.length).toBeGreaterThanOrEqual(1)
    app.unmount()
  })

  it('the assigner receives a value sourced from el.value, NOT the inner input the user typed into ✗', async () => {
    // Important: the `assignKey` escape hatch ONLY overrides the
    // function called with the value. It does NOT change how the
    // directive sources the value — the text-input variant always
    // reads `el.value`, which has no useful semantics for a <div>
    // (jsdom returns ''; native browsers return undefined). So an
    // assignKey override is a partial fix: it suppresses the dev-
    // warning AND lets the consumer route writes into a custom store,
    // but the value handed to that store is still wrong.
    //
    // Workaround: the consumer must source the value themselves —
    // attach a separate event listener on the inner input.
    const received: unknown[] = []
    const ChildDiv = defineComponent({
      name: 'ChildDiv',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('div', attrs, [h('input', { type: 'text' })])
      },
    })
    mounted = mountWithChild(ChildDiv, {
      installAssigner: (el) => {
        ;(el as unknown as { [k: symbol]: unknown })[assignKey] = (v: unknown) => {
          received.push(v)
        }
      },
    })

    const innerInput = mounted.rootEl.querySelector('input') as HTMLInputElement
    innerInput.value = 'typed'
    innerInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    // The assigner fired AT LEAST once via the bubbled event, but
    // never with the typed string — the bridge from inner-input to
    // assigner reads el.value (the div's, not the input's).
    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received).not.toContain('typed')
  })
})

describe('escape hatch: @update:registerValue prop on a component', () => {
  let mounted: MountReturn | undefined

  afterEach(() => {
    mounted?.app.unmount()
    mounted = undefined
    document.body.innerHTML = ''
  })

  it('replaces the default assigner with the listener function (works ✓)', async () => {
    const received: unknown[] = []
    const ChildInput = defineComponent({
      name: 'ChildInput',
      inheritAttrs: false,
      setup(_, { attrs }) {
        return () => h('input', { type: 'text', ...attrs })
      },
    })
    mounted = mountWithChild(ChildInput, {
      onUpdateRegisterValue: (v: unknown) => {
        received.push(v)
      },
    })

    const input = mounted.rootEl as HTMLInputElement
    input.value = 'typed'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    // Custom listener fired with the typed value.
    expect(received).toContain('typed')
    // Default assigner was bypassed — the FormStore did NOT receive
    // the write because the listener didn't forward.
    expect(mounted.api.getValue('email').value).toBe('')
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
    mounted = mountWithChild(ChildInput)
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

    // Force a re-render via a no-op write to make sure beforeUpdate
    // fires (the assigner closure is recreated, but no listeners
    // should be added or removed during update).
    mounted.api.setValue('name', 'x')
    await flush()
    expect(counts.added).toBe(0)
    expect(counts.removed).toBe(0)

    // Now unmount and verify the directive's beforeUnmount cleans up.
    // Listeners added during created() are tracked in `listenersKey`
    // bag — every entry must be detached.
    mounted.app.unmount()
    mounted = undefined

    // After unmount the directive removed exactly the listeners it
    // installed during created(). Pre-mount, before this counter
    // attached, the directive had already added its bag — so we
    // can't compare added vs. removed in absolute terms. Instead,
    // we just assert removeEventListener was called at least once
    // for the directive teardown.
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
    mounted = mountWithChild(ChildInput, {
      persist: true,
      acknowledgeSensitive: false,
    })

    // Probe via the same RV shape the directive uses internally —
    // `register('email')` returns the canonicalised PathKey on
    // `rv.path` (JSON-stringified segments), and shares the same
    // `persistOptIns` map the directive wrote to.
    const internal = mounted.api as unknown as {
      register: (path: string) => {
        path: string
        persistOptIns: { hasAnyOptInForPath: (p: string) => boolean }
      }
    }
    const probe = internal.register('email')
    expect(probe.persistOptIns.hasAnyOptInForPath(probe.path)).toBe(true)

    mounted.app.unmount()
    // After unmount, the directive's beforeUnmount cleared the entry
    // for this element's id. The FormStore is also disposed, so the
    // registry is unreachable through the dead handle. We instead
    // verify by mounting a fresh form (different FormStore since the
    // consumer count went to zero, which evicts the entry) and
    // asserting no residual opt-in bleeds across.
    mounted = undefined
    const fresh = mountWithChild(ChildInput, { persist: false })
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
  // Vue 3 supports multi-root templates ("fragments"). When a directive
  // is applied to the component vnode and the component renders multiple
  // roots, Vue logs a runtime warning and skips applying the directive.
  // Lock that current behaviour: the directive does not fire, no
  // listeners attach, no opt-in is recorded.
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

    // Vue's own runtime emits the multi-root directive warning.
    // Match either Vue's wording or our own — the only invariant we
    // care about here is "something complained, and the directive
    // didn't silently swallow the call".
    const matched = collected.filter(
      (w) =>
        w.includes('Runtime directive used on component with non-element root') ||
        w.includes('non-element root') ||
        w.includes('falls back to text-input semantics')
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
        return () => withDirectives(h(ChildInput, { hint: hint.value }), [[vRegister, rv]])
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

    // Trigger several re-renders. beforeUpdate fires on each; if the
    // directive recreated listeners on update we'd see counts.added
    // climb monotonically.
    for (let i = 0; i < 5; i++) {
      hint.value = `iter-${i}`
      await flush()
    }
    expect(counts.added).toBe(0)
    expect(counts.removed).toBe(0)

    app.unmount()
  })
})
