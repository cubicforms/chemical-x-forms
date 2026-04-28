/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectiveBinding } from 'vue'
import { nextTick, ref } from 'vue'
import { assignKey, vRegister } from '../../src/runtime/core/directive'
import { createPersistOptInRegistry } from '../../src/runtime/core/persistence/opt-in-registry'
import type { PathKey } from '../../src/runtime/core/paths'
import type { RegisterValue } from '../../src/runtime/types/types-api'

/**
 * Directive listener teardown guard. Before Phase 9.3, a <KeepAlive>'d
 * element would accumulate listeners across activation cycles because
 * the variants' `created` hook added handlers that `beforeUnmount`
 * never detached. These tests exercise the directive lifecycle against
 * a real jsdom element and assert that every listener added in `created`
 * is removed in `beforeUnmount`.
 */

type Spy = ReturnType<typeof vi.fn>

function makeRegisterValue<T>(initial: T): {
  value: RegisterValue<T>
  register: Spy
  deregister: Spy
  setValue: Spy
} {
  const register = vi.fn()
  const deregister = vi.fn()
  const setValue = vi.fn(() => true)
  const value: RegisterValue<T> = {
    innerRef: ref(initial) as RegisterValue<T>['innerRef'],
    registerElement: register,
    deregisterElement: deregister,
    setValueWithInternalPath: setValue,
    markConnectedOptimistically: () => undefined,
    // Mock the new persistence-opt-in fields. These tests don't exercise
    // persist behavior; default to "not opted in" so the directive's
    // syncPersistOptIn helper short-circuits.
    path: 'mock' as PathKey,
    persist: false,
    acknowledgeSensitive: false,
    persistOptIns: createPersistOptInRegistry(),
  }
  return { value, register, deregister, setValue }
}

function makeBinding<T>(rv: RegisterValue<T>): DirectiveBinding {
  return {
    value: rv,
    oldValue: null,
    modifiers: {},
    arg: undefined,
    dir: {},
    instance: null,
  } as unknown as DirectiveBinding
}

// The `vRegister` directive hooks are typed against Vue's VNode generic
// which narrows to specific element types. These tests only exercise
// `props.type` and `props.value`, so we supply a minimal stand-in and
// reach the hooks through a loosely-typed view of the directive.
type FakeVNode = { props: Record<string, unknown> }
function makeVNode(props: Record<string, unknown> = {}): FakeVNode {
  return { props }
}

type DirectiveHook = (
  el: Element,
  binding: DirectiveBinding,
  vnode: FakeVNode,
  prevNode: null
) => void

const hooks = vRegister as unknown as {
  created?: DirectiveHook
  mounted?: DirectiveHook
  beforeUpdate?: DirectiveHook
  beforeUnmount?: DirectiveHook
}

function installListenerSpies(el: Element): { added: number; removed: number; reset: () => void } {
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
  return {
    get added() {
      return counts.added
    },
    get removed() {
      return counts.removed
    },
    reset() {
      counts.added = 0
      counts.removed = 0
    },
  }
}

describe('v-register directive — listener teardown on unmount', () => {
  let input: HTMLInputElement

  beforeEach(() => {
    document.body.innerHTML = ''
    input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
  })

  it('text input: listeners added in created are removed in beforeUnmount', () => {
    const { value } = makeRegisterValue('')
    const binding = makeBinding(value)
    const vnode = makeVNode({ type: 'text' })
    const spy = installListenerSpies(input)

    hooks.created?.(input, binding, vnode, null)
    expect(spy.added).toBeGreaterThan(0)

    const addedCount = spy.added
    hooks.beforeUnmount?.(input, binding, vnode, null)
    expect(spy.removed).toBe(addedCount)
  })

  it('checkbox input: listeners add / remove count matches', () => {
    input.type = 'checkbox'
    const { value } = makeRegisterValue<string[]>([])
    const binding = makeBinding(value)
    const vnode = makeVNode({ type: 'checkbox', value: 'a' })
    const spy = installListenerSpies(input)

    hooks.created?.(input, binding, vnode, null)
    const addedCount = spy.added
    expect(addedCount).toBeGreaterThan(0)

    hooks.beforeUnmount?.(input, binding, vnode, null)
    expect(spy.removed).toBe(addedCount)
  })

  it('radio input: listeners add / remove count matches', () => {
    input.type = 'radio'
    const { value } = makeRegisterValue<string>('')
    const binding = makeBinding(value)
    const vnode = makeVNode({ type: 'radio', value: 'a' })
    const spy = installListenerSpies(input)

    hooks.created?.(input, binding, vnode, null)
    const addedCount = spy.added
    expect(addedCount).toBeGreaterThan(0)

    hooks.beforeUnmount?.(input, binding, vnode, null)
    expect(spy.removed).toBe(addedCount)
  })

  it('select: listeners add / remove count matches', () => {
    const select = document.createElement('select')
    document.body.appendChild(select)
    const { value } = makeRegisterValue<string>('')
    const binding = makeBinding(value)
    const vnode = makeVNode({})
    const spy = installListenerSpies(select)

    hooks.created?.(select, binding, vnode, null)
    const addedCount = spy.added
    expect(addedCount).toBeGreaterThan(0)

    hooks.beforeUnmount?.(select, binding, vnode, null)
    expect(spy.removed).toBe(addedCount)
  })

  it('KeepAlive simulation: repeated create/unmount does not accumulate', () => {
    const { value } = makeRegisterValue('')
    const binding = makeBinding(value)
    const vnode = makeVNode({ type: 'text' })
    const spy = installListenerSpies(input)

    // Two cycles of created → beforeUnmount. After each teardown the
    // listener count on the element should be exactly zero.
    hooks.created?.(input, binding, vnode, null)
    hooks.beforeUnmount?.(input, binding, vnode, null)
    expect(spy.added).toBe(spy.removed)

    spy.reset()
    hooks.created?.(input, binding, vnode, null)
    expect(spy.added).toBeGreaterThan(0)
    hooks.beforeUnmount?.(input, binding, vnode, null)
    expect(spy.added).toBe(spy.removed)
  })

  it('beforeUnmount clears composing/_assigning/assignKey state', () => {
    const { value } = makeRegisterValue('')
    const binding = makeBinding(value)
    const vnode = makeVNode({ type: 'text' })

    hooks.created?.(input, binding, vnode, null)
    const unknownInput = input as unknown as {
      composing?: boolean
      _assigning?: boolean
      [k: symbol]: unknown
    }
    unknownInput.composing = true
    unknownInput._assigning = true
    // `created` calls setAssignFunction, which writes the assigner
    // onto `el[assignKey]`. The teardown guarantees this is wiped
    // too — otherwise a reused element would keep dispatching DOM
    // events to the prior form's assigner.
    expect(unknownInput[assignKey]).toBeDefined()

    hooks.beforeUnmount?.(input, binding, vnode, null)

    expect(unknownInput.composing).toBeUndefined()
    expect(unknownInput._assigning).toBeUndefined()
    expect(unknownInput[assignKey]).toBeUndefined()
  })

  it('beforeUnmount drains listeners even if value is no longer a RegisterValue', () => {
    // A binding can receive an invalid value right before teardown (e.g.,
    // parent component state went null). We still need to remove every
    // listener we added — otherwise the leak survives the teardown.
    const { value } = makeRegisterValue('')
    const created = makeBinding(value)
    const vnode = makeVNode({ type: 'text' })
    const spy = installListenerSpies(input)

    hooks.created?.(input, created, vnode, null)
    const addedCount = spy.added

    const invalid = { ...created, value: null } as unknown as DirectiveBinding
    hooks.beforeUnmount?.(input, invalid, vnode, null)

    expect(spy.removed).toBe(addedCount)
  })
})

describe('v-register directive — D2 unsupported-element warning', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    document.body.innerHTML = ''
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('warns once when v-register is bound to a <div> with no assignKey override', async () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const { value } = makeRegisterValue('hello')
    const binding = makeBinding(value)
    const vnode = makeVNode({})
    hooks.created?.(div, binding, vnode, null)
    // Same element re-fires created (KeepAlive case); warn must not
    // double-fire — WeakSet dedupe.
    hooks.created?.(div, binding, vnode, null)
    // The warn is deferred via `nextTick` so `useRegister`'s
    // `onMounted` marker has a chance to land first. Flush before
    // asserting on the spy.
    await nextTick()
    const matched = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('is a no-op'))
    expect(matched.length).toBe(1)
    warnSpy.mockRestore()
  })

  it('does NOT warn when an assigner is installed via assignKey before mount', async () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    // Consumer-installed assigner — escape hatch for custom components
    // / non-input elements that handle the binding manually.
    ;(div as unknown as { [k: symbol]: unknown })[assignKey] = (_v: unknown) => undefined
    const { value } = makeRegisterValue('hello')
    const binding = makeBinding(value)
    const vnode = makeVNode({})
    hooks.created?.(div, binding, vnode, null)
    await nextTick()
    const matched = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('is a no-op'))
    expect(matched.length).toBe(0)
    warnSpy.mockRestore()
  })

  it('does NOT warn for native input / select / textarea elements', async () => {
    for (const tag of ['input', 'select', 'textarea'] as const) {
      const el = document.createElement(tag)
      document.body.appendChild(el)
      const { value } = makeRegisterValue('hello')
      const binding = makeBinding(value)
      const vnode = makeVNode({})
      hooks.created?.(el, binding, vnode, null)
    }
    await nextTick()
    const matched = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('is a no-op'))
    expect(matched.length).toBe(0)
    warnSpy.mockRestore()
  })
})

/**
 * `<input v-register="undefined" />` is supported as an inert binding.
 * The directive types admit `RegisterValue | undefined` because
 * `useRegister()` may return `undefined` (a wrapper component
 * rendered without a parent `registerValue`); `<input v-register="register" />`
 * inside that wrapper passes `undefined` through to the directive,
 * and the binding must be a silent no-op (no warn — useRegister has
 * already warned at the call site, no listener attachment that would
 * later read off a stale `undefined` value).
 */
describe('v-register directive — undefined binding (inert)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    document.body.innerHTML = ''
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('does not throw and does not warn when value is undefined', async () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const binding = makeBinding(undefined as unknown as RegisterValue<string>)
    const vnode = makeVNode({})
    expect(() => hooks.created?.(input, binding, vnode, null)).not.toThrow()
    await nextTick()
    expect(warnSpy.mock.calls.length).toBe(0)
    warnSpy.mockRestore()
  })

  it('listener fires (input event) do not throw when no assigner is installed', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const binding = makeBinding(undefined as unknown as RegisterValue<string>)
    const vnode = makeVNode({})
    hooks.created?.(input, binding, vnode, null)

    // Native input fires its `input` event — listener uses `?.()` on the
    // assigner, so undefined assigner is a silent no-op rather than a
    // throw.
    expect(() => input.dispatchEvent(new Event('input'))).not.toThrow()
    warnSpy.mockRestore()
  })

  it('beforeUpdate with undefined value installs a no-op assigner via setAssignFunction', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const binding = makeBinding(undefined as unknown as RegisterValue<string>)
    const vnode = makeVNode({})
    hooks.created?.(input, binding, vnode, null)
    hooks.beforeUpdate?.(input, binding, vnode, null)

    const installed = (input as unknown as { [k: symbol]: unknown })[assignKey]
    expect(typeof installed).toBe('function')
    expect(() => (installed as (v: unknown) => unknown)('typed value')).not.toThrow()
    warnSpy.mockRestore()
  })

  it('beforeUnmount with undefined value does not throw on missing deregisterElement', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const binding = makeBinding(undefined as unknown as RegisterValue<string>)
    const vnode = makeVNode({})
    hooks.created?.(input, binding, vnode, null)
    expect(() => hooks.beforeUnmount?.(input, binding, vnode, null)).not.toThrow()
    warnSpy.mockRestore()
  })
})
