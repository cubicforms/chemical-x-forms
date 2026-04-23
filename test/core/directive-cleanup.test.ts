/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectiveBinding } from 'vue'
import { ref } from 'vue'
import { assignKey, vRegister } from '../../src/runtime/core/directive'
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
