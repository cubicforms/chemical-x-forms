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
 * routes through `markBlank` instead of the silent skip-on-empty
 * (which left UI and storage desynced) or the slim-primitive gate
 * rejection (which surfaced a noisy dev warn). Plus the `.number` ×
 * text-input `beforeinput` filter that blocks non-numeric characters
 * from reaching `el.value` in the first place.
 */

type Spy = ReturnType<typeof vi.fn>

function makeRegisterValue<T>(initial: T): {
  value: RegisterValue<T>
  markBlank: Spy
  setValue: Spy
} {
  const innerRef = ref(initial)
  // Mirror the real assigner contract: a successful write updates
  // `innerRef.value` to the post-coerce, post-transform value. The
  // directive's input listener depends on this to detect storage-vs-
  // typed divergence and force-sync the DOM (clamp transforms,
  // silent slim-gate rejections, etc.); a no-op mock would always
  // look like a stuck-storage rejection.
  const setValue = vi.fn((v: unknown) => {
    innerRef.value = v as T
    return true
  })
  const markBlank = vi.fn(() => true)
  const value: RegisterValue<T> = {
    innerRef: innerRef as RegisterValue<T>['innerRef'],
    displayValue: ref('') as Readonly<Ref<string>>,
    markBlank,
    lastTypedForm: ref<string | null>(null),
    registerElement: vi.fn(),
    deregisterElement: vi.fn(),
    setValueWithInternalPath: setValue,
    markConnectedOptimistically: () => undefined,
    path: 'mock' as PathKey,
    persist: false,
    acknowledgeSensitive: false,
    persistOptIns: createPersistOptInRegistry(),
  }
  return { value, markBlank, setValue }
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

describe('directive — blank on numeric clear', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('<input type="number"> backspaced to empty calls markBlank', () => {
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value, markBlank, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    input.value = '5'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(5, expect.objectContaining({}))

    setValue.mockClear()
    markBlank.mockClear()
    input.value = ''
    input.dispatchEvent(new Event('input'))

    expect(setValue).not.toHaveBeenCalled()
    expect(markBlank).toHaveBeenCalledTimes(1)
  })

  it('<input type="text" v-register.number> empty input calls markBlank', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, markBlank, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '7'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(7, expect.objectContaining({}))

    setValue.mockClear()
    markBlank.mockClear()
    input.value = ''
    input.dispatchEvent(new Event('input'))

    expect(setValue).not.toHaveBeenCalled()
    expect(markBlank).toHaveBeenCalledTimes(1)
  })

  it('non-numeric input on `.number` text input calls markBlank (no gate-rejection)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, markBlank, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    // `'xyz'` keeps this test on the immediate markBlank path
    // (no `e`/`E`, so the scientific-notation deferral does not apply).
    input.value = 'xyz'
    input.dispatchEvent(new Event('input'))

    expect(setValue).not.toHaveBeenCalled()
    expect(markBlank).toHaveBeenCalledTimes(1)
  })

  it('typing a real value after clear sends the value through the assigner (implicit unmark)', () => {
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value, markBlank, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    input.value = ''
    input.dispatchEvent(new Event('input'))
    expect(markBlank).toHaveBeenCalledTimes(1)
    expect(setValue).not.toHaveBeenCalled()

    input.value = '12'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(12, expect.objectContaining({}))
  })

  it('text inputs without `.number` do NOT auto-mark on clear (string clear is ambiguous)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, markBlank, setValue } = makeRegisterValue('' as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({}), null)

    input.value = 'hello'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenCalledTimes(1)

    setValue.mockClear()
    markBlank.mockClear()
    input.value = ''
    input.dispatchEvent(new Event('input'))

    // String inputs send '' through the regular assigner — no auto-mark.
    // The DOM doesn't tell us "user typed empty" vs "user hasn't typed",
    // so the dev opts in to blank via the unset symbol if
    // they want that semantic.
    expect(setValue).toHaveBeenCalledWith('', expect.objectContaining({}))
    expect(markBlank).not.toHaveBeenCalled()
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

  it('allows scientific-notation characters (e, E, +, -) for parity with native type="number"', () => {
    // 16e regression: the original regex `^-?\d*\.?\d*$` blocked `e`,
    // so `1e3` was un-typeable on a `.number` text input even though
    // the directive's `looseToNumber` cast handles it natively. The
    // widened regex `^-?\d*\.?\d*([eE][+-]?\d*)?$` accepts the full
    // partial-typing path: `1`, `1e`, `1e-`, `1e-3`.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    // Build up `1e-3` keystroke-by-keystroke; every intermediate state
    // must pass the filter or the user can't get to the final value.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['', '1'],
      ['1', 'e'],
      ['1e', '-'],
      ['1e-', '3'],
      ['1e-3', '4'], // continued digits in exponent
    ]
    for (const [current, key] of cases) {
      input.value = current
      input.setSelectionRange(current.length, current.length)
      const ev = new InputEvent('beforeinput', {
        data: key,
        inputType: 'insertText',
        cancelable: true,
      })
      input.dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(false)
    }

    // Capital E is also accepted.
    input.value = '2'
    input.setSelectionRange(1, 1)
    const capE = new InputEvent('beforeinput', {
      data: 'E',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(capE)
    expect(capE.defaultPrevented).toBe(false)

    // `+` after the e is allowed.
    input.value = '2E'
    input.setSelectionRange(2, 2)
    const plus = new InputEvent('beforeinput', {
      data: '+',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(plus)
    expect(plus.defaultPrevented).toBe(false)
  })

  it('blocks duplicate exponent markers (e.g., 1ee3, 1e3e)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    // Second `e` after `1e` must be rejected — `1ee3` isn't valid.
    input.value = '1e'
    input.setSelectionRange(2, 2)
    const ev = new InputEvent('beforeinput', {
      data: 'e',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)

    // `1e3e` — `e` after digit-in-exponent — also rejected.
    input.value = '1e3'
    input.setSelectionRange(3, 3)
    const ev2 = new InputEvent('beforeinput', {
      data: 'e',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(ev2)
    expect(ev2.defaultPrevented).toBe(true)
  })

  it('blocks a decimal point inside the exponent (1e3.5 is invalid scientific notation)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1e3'
    input.setSelectionRange(3, 3)
    const ev = new InputEvent('beforeinput', {
      data: '.',
      inputType: 'insertText',
      cancelable: true,
    })
    input.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })
})

describe('directive — `.number` blur cleanup (16d regression: lone period)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('clears the DOM when blur leaves a lone period in a `.number` text input', () => {
    // 16d regression: typing `.` then blurring used to leave `.` in
    // the DOM because `looseToNumber('.')` returns the original
    // string, and the change-normalizer wrote that string back via
    // `el.value = '.'`. Native `<input type="number">` clears `.`
    // on blur — the `.number` text input now matches.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '.'
    input.dispatchEvent(new Event('change'))
    expect(input.value).toBe('')
  })

  it('clears the DOM for a lone minus sign on blur', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '-'
    input.dispatchEvent(new Event('change'))
    expect(input.value).toBe('')
  })

  it('clears the DOM for a partial scientific-notation residue on blur (e.g., `e`)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = 'e'
    input.dispatchEvent(new Event('change'))
    expect(input.value).toBe('')
  })

  it('normalizes `1.` to `1` on blur (parseFloat-castable partial input)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1.'
    input.dispatchEvent(new Event('change'))
    expect(input.value).toBe('1')
  })

  it('preserves `1.5` on blur (already-canonical castable input)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1.5'
    input.dispatchEvent(new Event('change'))
    expect(input.value).toBe('1.5')
  })

  it('commits `1e3` to canonical `1000` on blur for a `.number` text input', () => {
    // Scientific-notation input was unblocked at the beforeinput
    // layer — verify the blur normalizer takes the cast representation
    // (`String(1000)` is `'1000'`, NOT `'1e3'`).
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1e3'
    input.dispatchEvent(new Event('change'))
    expect(input.value).toBe('1000')
  })

  it('clears the DOM under `.lazy.number` when blur leaves a lone period', () => {
    // The lazy variant uses the `change` event for the input
    // listener AND the blur normalizer — both fire on blur. Order:
    // listener-1 markBlank's, listener-2 cleans the DOM.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, markBlank } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { lazy: true, number: true }), makeVNode({}), null)

    input.value = '.'
    input.dispatchEvent(new Event('change'))
    expect(input.value).toBe('')
    expect(markBlank).toHaveBeenCalled()
  })
})

describe('directive — `.number` real-time storage updates with mid-typing DOM preservation', () => {
  // Storage commits on every keystroke that parses to a number;
  // `lastTypedForm` keeps Vue's `:value` patch from yanking the DOM
  // away from the user's caret. Blur clears `lastTypedForm` so the
  // post-blur DOM matches `String(storage)` exactly.
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('writes storage in real-time as scientific notation resolves (1 → 1, 1e → 1, 1e2 → 100)', () => {
    // Bug report (16c): typing `1e2` used to leave storage at `1`
    // until blur because the `[eE]` deferral skipped writes. Now
    // storage updates as soon as the typed form parses to a new
    // number, while `lastTypedForm` keeps the DOM showing what the
    // user typed.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(1, expect.objectContaining({}))
    expect(value.lastTypedForm.value).toBe('1')

    // `parseFloat('1e')` is 1 (permissive); storage stays at 1, but
    // the typed form updates so the DOM keeps showing `1e`.
    input.value = '1e'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(1, expect.objectContaining({}))
    expect(value.lastTypedForm.value).toBe('1e')

    input.value = '1e2'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(100, expect.objectContaining({}))
    expect(value.lastTypedForm.value).toBe('1e2')
  })

  it('records the typed form for capital `E`', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '2E10'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(2e10, expect.objectContaining({}))
    expect(value.lastTypedForm.value).toBe('2E10')
  })

  it('records the typed form across the full `3e45` typing path so the user can finish typing', () => {
    // Original cursor-yank bug (16e variant): typing `3e4` flips
    // storage to 30000, Vue's `:value` patch overwrites the DOM
    // from `3e4` to `30000`, the user's `5` lands in the wrong
    // place. With `lastTypedForm`, `displayValue` returns the
    // typed form for the patch, so the DOM equals what's already
    // there — Vue's idempotent set leaves the cursor alone.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    for (const typed of ['3', '3e', '3e4', '3e45']) {
      input.value = typed
      input.dispatchEvent(new Event('input'))
      expect(value.lastTypedForm.value).toBe(typed)
    }
  })

  it('blur clears the typed form and normalizes the DOM to `String(storage)`', () => {
    // Per design: post-blur display matches storage (honest). The
    // user types `1e2`, storage holds 100, DOM shows `1e2` while
    // typing — but on blur the DOM patches to `100`.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1e2'
    input.dispatchEvent(new Event('input'))
    expect(value.lastTypedForm.value).toBe('1e2')

    input.dispatchEvent(new Event('change'))
    expect(value.lastTypedForm.value).toBeNull()
    expect(input.value).toBe('100')
  })

  it('blur normalizes a non-castable scientific residue (`3e` → `3`) and clears typed form', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '3e'
    input.dispatchEvent(new Event('input'))
    expect(value.lastTypedForm.value).toBe('3e')

    input.dispatchEvent(new Event('change'))
    // `parseFloat('3e')` is 3 → DOM normalizes to `'3'`.
    expect(input.value).toBe('3')
    expect(value.lastTypedForm.value).toBeNull()
  })

  it('non-castable input (`xyz`) markBlank fires immediately, not deferred to blur', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, markBlank } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = 'xyz'
    input.dispatchEvent(new Event('input'))
    // No deferral — the keystroke listener marks immediately.
    expect(markBlank).toHaveBeenCalledTimes(1)
    expect(value.lastTypedForm.value).toBeNull()
  })

  it('NON-scientific input writes per-keystroke and tracks typed form (`1`, `1.`, `1.50`)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(1, expect.objectContaining({}))
    expect(value.lastTypedForm.value).toBe('1')

    input.value = '1.'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(1, expect.objectContaining({}))
    expect(value.lastTypedForm.value).toBe('1.')

    input.value = '1.50'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(1.5, expect.objectContaining({}))
    expect(value.lastTypedForm.value).toBe('1.50')
  })

  it('`.lazy.number` writes on blur and clears typed form via the change normalizer', () => {
    // Lazy mode wires the input listener to `change`, so the
    // commit-and-clear cycle happens entirely on blur — the input
    // listener writes storage AND records the typed form, the
    // change normalizer immediately clears it and normalizes DOM.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { lazy: true, number: true }), makeVNode({}), null)

    input.value = '3e45'
    input.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenCalledWith(3e45, expect.objectContaining({}))
    expect(input.value).toBe(String(3e45))
    expect(value.lastTypedForm.value).toBeNull()
  })
})

describe('directive — `.number` overflow (Infinity) refusal', () => {
  // `parseFloat('1e309')` is `Infinity`. `typeof Infinity === 'number'`,
  // so without an explicit guard the slim-primitive gate accepts it
  // and storage holds `Infinity`. Downstream chaos:
  //   - `JSON.stringify(Infinity)` is `'null'` → field state shows
  //     `value: null`, devs think the form silently nulled out
  //   - Zod's `z.number()` rejects with "expected number, received
  //     number" (its quirky error for non-finite numerics)
  // The directive refuses non-finite at the boundary: storage stays
  // at the last good value (snap-back during typing), and blur
  // clears + markBlank.
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('refuses to write Infinity to storage on input event (overflow)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    // Establish a good value first so the snap-back has something to
    // restore to.
    input.value = '1e308'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(1e308, expect.objectContaining({}))
    setValue.mockClear()

    // Push past Number.MAX_VALUE — parseFloat returns Infinity.
    input.value = '1e309'
    input.dispatchEvent(new Event('input'))
    // Storage refuses the Infinity write.
    expect(setValue).not.toHaveBeenCalled()
  })

  it('snaps the DOM back to the last good displayValue on overflow keystroke', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)
    // Pre-seed displayValue with a non-empty string so the snap-back
    // assertion is meaningful (the mock starts at '').
    ;(value.displayValue as unknown as { value: string }).value = '1e308'

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1e309'
    input.dispatchEvent(new Event('input'))
    // DOM snapped back from `'1e309'` to `'1e308'`.
    expect(input.value).toBe('1e308')
  })

  it('blur on an overflow residue clears the DOM and fires markBlank', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, markBlank } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1e309'
    input.dispatchEvent(new Event('change'))
    expect(input.value).toBe('')
    expect(markBlank).toHaveBeenCalled()
  })

  it('refuses negative overflow (`-1e309` → -Infinity)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '-1e309'
    input.dispatchEvent(new Event('input'))
    expect(setValue).not.toHaveBeenCalled()
  })

  it('still accepts the largest finite Number (`1.7976931348623157e308` ≈ Number.MAX_VALUE)', () => {
    // Sanity: the snap-back is gated on Number.isFinite — values at
    // or below MAX_VALUE pass through unchanged.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '1.7976931348623157e308'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(Number.MAX_VALUE, expect.objectContaining({}))
  })
})

describe('directive — `<input type="number">` mid-typing badInput is not a clear', () => {
  // 16e regression: typing `1e` into `<input type="number">` blanked
  // the visible field. The browser exposes `el.value === ''` for
  // malformed mid-edit input (because `1e` isn't a complete scientific
  // notation literal) even though `1e` is still visible in the DOM.
  // Pre-fix the directive's input listener saw the empty value and
  // fired `markBlank`, which made `displayValue` recompute
  // to `''`; Vue's `:value` patch then yanked the user's typed `1e`
  // away. The fix uses `validity.badInput` to distinguish a real
  // user-clear (`badInput === false`) from a transient mid-edit
  // (`badInput === true`). The check is benign for `.number` text
  // inputs (which use a `beforeinput` regex filter upstream — `el.value`
  // never blanks unexpectedly there, so `badInput` stays `false`).
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function withBadInput(input: HTMLInputElement, badInput: boolean): void {
    // jsdom's ValidityState doesn't reflect type=number malformed-input
    // semantics, so we shim a partial ValidityState onto the element
    // for these tests. Mirrors the shape of the real browser API the
    // directive consults.
    Object.defineProperty(input, 'validity', {
      configurable: true,
      get(): { badInput: boolean } {
        return { badInput }
      },
    })
  }

  it('skips markBlank when `validity.badInput` is true on empty el.value', () => {
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value, markBlank, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    // User typed `1e` — browser shows it in DOM but blanks el.value
    // and flags badInput. The directive must NOT markBlank.
    input.value = ''
    withBadInput(input, true)
    input.dispatchEvent(new Event('input'))

    expect(markBlank).not.toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
    // lastTypedForm untouched — display continues to track storage.
    expect(value.lastTypedForm.value).toBeNull()
  })

  it('marks blank when `validity.badInput` is false on empty el.value (real user clear)', () => {
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value, markBlank } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    input.value = ''
    withBadInput(input, false)
    input.dispatchEvent(new Event('input'))

    expect(markBlank).toHaveBeenCalledTimes(1)
  })

  it('the badInput skip lets the eventual valid `1e2` commit live (post-fix smoke test)', () => {
    // Walk the full typing path: `1` commits 1, `1e` is mid-edit
    // (badInput=true, skipped, storage stays 1, DOM keeps `1e`),
    // `1e2` commits 100. The user finishes typing and storage
    // reaches the right value.
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    input.value = '1'
    withBadInput(input, false)
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(1, expect.objectContaining({}))

    setValue.mockClear()
    // `1e` — browser blanks el.value, sets badInput.
    input.value = ''
    withBadInput(input, true)
    input.dispatchEvent(new Event('input'))
    // No write — storage stays at 1.
    expect(setValue).not.toHaveBeenCalled()

    // `1e2` — browser un-blanks el.value, badInput clears.
    input.value = '1e2'
    withBadInput(input, false)
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(100, expect.objectContaining({}))
  })
})
