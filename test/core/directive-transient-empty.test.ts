/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectiveBinding, VNode } from 'vue'
import { ref, type Ref } from 'vue'
import { vRegister } from '../../src/runtime/core/directive'
import { createPersistOptInRegistry } from '../../src/runtime/core/persistence/opt-in-registry'
import type { PathKey } from '../../src/runtime/core/paths'
import type { RegisterValue } from '../../src/runtime/types/types-api'

/**
 * Coverage for commit 5's directive wiring: empty / non-castable input
 * routes through `markTransientEmpty` instead of the silent skip-on-empty
 * (which left UI and storage desynced) or the slim-primitive gate
 * rejection (which surfaced a noisy dev warn). Plus the `.number` ×
 * text-input `beforeinput` filter that blocks non-numeric characters
 * from reaching `el.value` in the first place.
 */

type Spy = ReturnType<typeof vi.fn>

function makeRegisterValue<T>(initial: T): {
  value: RegisterValue<T>
  markTransientEmpty: Spy
  setValue: Spy
} {
  const markTransientEmpty = vi.fn(() => true)
  const setValue = vi.fn(() => true)
  const value: RegisterValue<T> = {
    innerRef: ref(initial) as RegisterValue<T>['innerRef'],
    displayValue: ref('') as Readonly<Ref<string>>,
    markTransientEmpty,
    registerElement: vi.fn(),
    deregisterElement: vi.fn(),
    setValueWithInternalPath: setValue,
    markConnectedOptimistically: () => undefined,
    path: 'mock' as PathKey,
    persist: false,
    acknowledgeSensitive: false,
    persistOptIns: createPersistOptInRegistry(),
  }
  return { value, markTransientEmpty, setValue }
}

function makeBinding<T>(
  rv: RegisterValue<T> | undefined,
  modifiers: Record<string, true> = {}
): DirectiveBinding {
  return {
    value: rv,
    oldValue: null,
    modifiers,
    arg: undefined,
    dir: {},
    instance: null,
  } as unknown as DirectiveBinding
}

function makeVNode(props: Record<string, unknown>): VNode {
  return { props } as unknown as VNode
}

const hooks = vRegister as unknown as {
  created?: (el: HTMLElement, binding: DirectiveBinding, vnode: VNode, prev: unknown) => void
}

describe('directive — transient-empty on numeric clear', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('<input type="number"> backspaced to empty calls markTransientEmpty', () => {
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value, markTransientEmpty, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    input.value = '5'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(5, expect.objectContaining({}))

    setValue.mockClear()
    markTransientEmpty.mockClear()
    input.value = ''
    input.dispatchEvent(new Event('input'))

    expect(setValue).not.toHaveBeenCalled()
    expect(markTransientEmpty).toHaveBeenCalledTimes(1)
  })

  it('<input type="text" v-register.number> empty input calls markTransientEmpty', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, markTransientEmpty, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '7'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(7, expect.objectContaining({}))

    setValue.mockClear()
    markTransientEmpty.mockClear()
    input.value = ''
    input.dispatchEvent(new Event('input'))

    expect(setValue).not.toHaveBeenCalled()
    expect(markTransientEmpty).toHaveBeenCalledTimes(1)
  })

  it('non-numeric input on `.number` text input calls markTransientEmpty (no gate-rejection)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, markTransientEmpty, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = 'not-a-number'
    input.dispatchEvent(new Event('input'))

    expect(setValue).not.toHaveBeenCalled()
    expect(markTransientEmpty).toHaveBeenCalledTimes(1)
  })

  it('typing a real value after clear sends the value through the assigner (implicit unmark)', () => {
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value, markTransientEmpty, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    input.value = ''
    input.dispatchEvent(new Event('input'))
    expect(markTransientEmpty).toHaveBeenCalledTimes(1)
    expect(setValue).not.toHaveBeenCalled()

    input.value = '12'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(12, expect.objectContaining({}))
  })

  it('text inputs without `.number` do NOT auto-mark on clear (string clear is ambiguous)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, markTransientEmpty, setValue } = makeRegisterValue('' as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({}), null)

    input.value = 'hello'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenCalledTimes(1)

    setValue.mockClear()
    markTransientEmpty.mockClear()
    input.value = ''
    input.dispatchEvent(new Event('input'))

    // String inputs send '' through the regular assigner — no auto-mark.
    // The DOM doesn't tell us "user typed empty" vs "user hasn't typed",
    // so the dev opts in to transient-empty via the unset symbol if
    // they want that semantic.
    expect(setValue).toHaveBeenCalledWith('', expect.objectContaining({}))
    expect(markTransientEmpty).not.toHaveBeenCalled()
  })
})

describe('directive — `.number` × text-input beforeinput filter', () => {
  let removalSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    document.body.innerHTML = ''
    removalSpy = vi.spyOn(HTMLElement.prototype, 'removeEventListener')
  })

  afterEach(() => {
    removalSpy.mockRestore()
  })

  it('blocks non-numeric character insertion on a `.number` text input', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    // Simulate typing 'a' into an empty input.
    const ev = new InputEvent('beforeinput', {
      data: 'a',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('allows numeric character insertion', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    const ev = new InputEvent('beforeinput', {
      data: '5',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('allows a leading minus sign and decimal point (partial states)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    const minusEv = new InputEvent('beforeinput', {
      data: '-',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(minusEv)
    expect(minusEv.defaultPrevented).toBe(false)

    input.value = '-'
    const dotEv = new InputEvent('beforeinput', {
      data: '.',
      inputType: 'insertText',
      cancelable: true,
    })
    input.setSelectionRange(1, 1)
    input.dispatchEvent(dotEv)
    expect(dotEv.defaultPrevented).toBe(false)
  })

  it('blocks a second decimal point', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1.5'
    input.setSelectionRange(3, 3)
    const ev = new InputEvent('beforeinput', {
      data: '.',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('does NOT install the filter when type="number" (browser handles)', () => {
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    // Even non-numeric input should not be prevented — the directive's
    // beforeinput filter is gated on `vnode.props.type !== 'number'`.
    const ev = new InputEvent('beforeinput', {
      data: 'a',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('does NOT install the filter without `.number` modifier', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue('' as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({}), null)

    const ev = new InputEvent('beforeinput', {
      data: 'a',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('does not interfere with composition input (IME)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    const ev = new InputEvent('beforeinput', {
      data: 'あ',
      inputType: 'insertCompositionText',
      cancelable: true,
    })
    input.dispatchEvent(ev)
    // insertCompositionText is not in the blocklist — IME input flows
    // through unimpeded; the compositionend handler sorts the final
    // value out.
    expect(ev.defaultPrevented).toBe(false)
  })
})
