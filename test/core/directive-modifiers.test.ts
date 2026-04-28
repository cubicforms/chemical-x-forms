/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectiveBinding } from 'vue'
import { ref, type Ref } from 'vue'
import { vRegister } from '../../src/runtime/core/directive'
import { createPersistOptInRegistry } from '../../src/runtime/core/persistence/opt-in-registry'
import type { PathKey } from '../../src/runtime/core/paths'
import type { RegisterValue } from '../../src/runtime/types/types-api'

/**
 * Modifier coverage for `v-register` (`.lazy`, `.trim`, `.number`).
 * The runtime is ported from Vue's `vModelText` / `vModelSelect`;
 * Vue tests its own modifier semantics in its own suite, but the
 * port has additional chemical-x guards (`shouldBailListener`, the
 * slim-primitive gate, value-swap migration) that intersect with
 * the modifier paths and need direct coverage here.
 *
 * Every test goes through the directive's `created` / `beforeUpdate`
 * hooks against a real jsdom element so the listeners actually
 * attach and fire on dispatched DOM events.
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
    displayValue: ref('') as Readonly<Ref<string>>,
    markTransientEmpty: () => true,
    lastTypedForm: ref<string | null>(null),
    registerElement: register,
    deregisterElement: deregister,
    setValueWithInternalPath: setValue,
    markConnectedOptimistically: () => undefined,
    path: 'mock' as PathKey,
    persist: false,
    acknowledgeSensitive: false,
    persistOptIns: createPersistOptInRegistry(),
  }
  return { value, register, deregister, setValue }
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
  updated?: DirectiveHook
  beforeUnmount?: DirectiveHook
}

// ─────────────────────────────────────────────────────────────────
// `<input type="text">` modifier matrix
// ─────────────────────────────────────────────────────────────────

describe('vRegisterText — `.lazy`', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('listener attaches to `change` not `input`', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue('')
    hooks.created?.(input, makeBinding(value, { lazy: true }), makeVNode({}), null)

    // Dispatching `input` MUST NOT write — listener gates on `change`.
    input.value = 'typing'
    input.dispatchEvent(new Event('input'))
    expect(setValue).not.toHaveBeenCalled()

    // Dispatching `change` writes.
    input.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(setValue).toHaveBeenCalledWith('typing', expect.objectContaining({}))
  })

  it('does NOT attach composition handlers under `.lazy`', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue('')

    hooks.created?.(input, makeBinding(value, { lazy: true }), makeVNode({}), null)

    // compositionstart / compositionend are wired only on the non-lazy
    // path. With `.lazy` they should be absent. The functional probe:
    // dispatching a compositionstart marks `composing: true` on the
    // composition handler. With no handler attached, our internal state
    // bag stays untouched. Easier check: ensure subsequent `change`
    // writes go through unchanged regardless of composition events.
    input.dispatchEvent(new Event('compositionstart'))
    input.value = 'lazy-write'
    input.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenCalledWith('lazy-write', expect.objectContaining({}))
  })
})

describe('vRegisterText — `.trim`', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('input event writes the RAW value (deferred trim — no per-keystroke strip)', () => {
    // Per-keystroke trim fights Vue's :value patch — typing a
    // trailing space would otherwise collapse before the user could
    // keep typing (regression #16b). The trim is committed on blur
    // by the change-normalization listener instead.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue('')

    hooks.created?.(input, makeBinding(value, { trim: true }), makeVNode({}), null)

    input.value = '  hello  '
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenCalledWith('  hello  ', expect.objectContaining({}))
  })

  it('change event commits the trimmed value to the model AND normalizes the DOM', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue('')

    hooks.created?.(input, makeBinding(value, { trim: true }), makeVNode({}), null)

    input.value = '  hello  '
    input.dispatchEvent(new Event('change'))
    // Both DOM and model arrive at the canonical trimmed form.
    expect(input.value).toBe('hello')
    expect(setValue).toHaveBeenLastCalledWith('hello', expect.objectContaining({}))
  })
})

describe('vRegisterText — `.number`', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('input event casts a parseable string to a number', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '42'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenCalledWith(42, expect.objectContaining({}))

    setValue.mockClear()
    input.value = '12.5'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenCalledWith(12.5, expect.objectContaining({}))
  })

  it('input event marks transient-empty for non-numeric strings instead of attempting the write', () => {
    // Pre-commit-5 the directive forwarded the unparseable string to
    // the slim-primitive gate, which rejected it and emitted a noisy
    // dev warning. Post-commit-5 the directive treats non-castable
    // input the same as the empty case: route through
    // `markTransientEmpty` so storage holds the slim default and the
    // user retains the empty / partial DOM. Submit-time validation
    // raises "Required" for required schemas.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue('' as unknown as never)
    const markTransientEmpty = vi.fn(() => true)
    value.markTransientEmpty = markTransientEmpty

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    // `'xyz'` is non-castable AND has no `e`/`E` — keeps this test on
    // the immediate markTransientEmpty path. Strings containing `e`
    // hit the scientific-notation deferral instead (covered separately).
    input.value = 'xyz'
    input.dispatchEvent(new Event('input'))
    expect(setValue).not.toHaveBeenCalled()
    expect(markTransientEmpty).toHaveBeenCalledTimes(1)
  })

  it('change event normalizes the visible DOM after Vue 3.5.33 parity fix', () => {
    // The (a) divergence: Vue casts el.value on blur whenever
    // EITHER trim OR castToNumber is true. Pre-fix, our port skipped
    // this for `.number`. ` 12 ` would stay ` 12 ` after blur instead
    // of becoming `12`.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = ' 12 '
    input.dispatchEvent(new Event('change'))
    expect(input.value).toBe('12')
  })

  it('auto-applies cast for <input type="number"> without an explicit `.number` modifier', () => {
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    input.value = '7'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenCalledWith(7, expect.objectContaining({}))
  })
})

describe('vRegisterText — combined modifiers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('`.lazy.trim`: change event writes the trimmed value', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue('')

    hooks.created?.(input, makeBinding(value, { lazy: true, trim: true }), makeVNode({}), null)

    input.value = '  spaced  '
    // input alone shouldn't write under .lazy.
    input.dispatchEvent(new Event('input'))
    expect(setValue).not.toHaveBeenCalled()
    input.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenCalledWith('spaced', expect.objectContaining({}))
  })

  it('`.lazy.number`: change event writes the cast value', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { lazy: true, number: true }), makeVNode({}), null)

    input.value = '99'
    input.dispatchEvent(new Event('input'))
    expect(setValue).not.toHaveBeenCalled()
    input.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenCalledWith(99, expect.objectContaining({}))
  })

  it('`.trim.number`: input writes the cast value (trim is deferred); change commits and normalizes', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { trim: true, number: true }), makeVNode({}), null)

    // Input listener writes the cast value. Trim is deferred — but
    // `looseToNumber('  42  ')` calls `parseFloat`, which already
    // handles surrounding whitespace, so the model still lands on 42.
    input.value = '  42  '
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenCalledWith(42, expect.objectContaining({}))

    input.value = '  7  '
    input.dispatchEvent(new Event('change'))
    // After change the visible DOM is normalized.
    expect(input.value).toBe('7')
  })
})

// ─────────────────────────────────────────────────────────────────
// `<textarea>` smoke
// ─────────────────────────────────────────────────────────────────

describe('vRegisterText — <textarea> reuses the same variant', () => {
  it('`.trim` works on textarea — input writes raw, change commits trimmed', () => {
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    const { value, setValue } = makeRegisterValue('')

    hooks.created?.(ta, makeBinding(value, { trim: true }), makeVNode({}), null)

    ta.value = '  multi line  '
    ta.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith('  multi line  ', expect.objectContaining({}))

    ta.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenLastCalledWith('multi line', expect.objectContaining({}))
    expect(ta.value).toBe('multi line')
  })
})

// ─────────────────────────────────────────────────────────────────
// `<select>` modifier matrix
// ─────────────────────────────────────────────────────────────────

describe('vRegisterSelect — `.number`', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function makeSelectWithOptions(options: string[]): HTMLSelectElement {
    const select = document.createElement('select')
    for (const v of options) {
      const opt = document.createElement('option')
      opt.value = v
      opt.text = v
      select.appendChild(opt)
    }
    return select
  }

  it('change event writes a numeric value for the selected option', () => {
    const select = makeSelectWithOptions(['10', '20', '30'])
    document.body.appendChild(select)
    const { value, setValue } = makeRegisterValue(10 as unknown as never)

    hooks.created?.(select, makeBinding(value, { number: true }), makeVNode({}), null)

    select.value = '20'
    select.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenCalledWith(20, expect.objectContaining({}))
  })

  it('multi-select with `.number` produces a numeric array', () => {
    const select = makeSelectWithOptions(['1', '2', '3'])
    select.multiple = true
    document.body.appendChild(select)
    const { value, setValue } = makeRegisterValue<number[]>([])

    hooks.created?.(select, makeBinding(value, { number: true }), makeVNode({}), null)

    const opt0 = select.options[0]
    const opt2 = select.options[2]
    if (opt0 === undefined || opt2 === undefined) throw new Error('unreachable')
    opt0.selected = true
    opt2.selected = true
    select.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenCalledWith([1, 3], expect.objectContaining({}))
  })

  it('multi-select WITHOUT `.number` writes string values', () => {
    const select = makeSelectWithOptions(['1', '2'])
    select.multiple = true
    document.body.appendChild(select)
    const { value, setValue } = makeRegisterValue<string[]>([])

    hooks.created?.(select, makeBinding(value, {}), makeVNode({}), null)

    const opt0 = select.options[0]
    if (opt0 === undefined) throw new Error('unreachable')
    opt0.selected = true
    select.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenCalledWith(['1'], expect.objectContaining({}))
  })

  it('mounted: selects the option matching a numeric model (16f regression)', () => {
    // Bug report: `<select v-register.number>` with model `1` left
    // `selectedIndex = -1` (no option highlighted) even though the
    // first option's value attribute was `"1"`. The pre-fix
    // `getBaseValue` returned a Set of DOM-currently-selected
    // values, which never compared equal to the model number.
    const select = makeSelectWithOptions(['1', '2', '3'])
    document.body.appendChild(select)
    const { value } = makeRegisterValue(1 as unknown as never)

    hooks.created?.(select, makeBinding(value, { number: true }), makeVNode({}), null)
    hooks.mounted?.(select, makeBinding(value, { number: true }), makeVNode({}), null)

    expect(select.selectedIndex).toBe(0)
  })

  it('mounted: selects the option matching a string model', () => {
    // Same path, string-valued model. Pre-fix `getBaseValue` read
    // `el.options[el.selectedIndex].value` — effectively a no-op
    // that left whatever the browser had selected by default. With
    // the model-driven sync, the right option is selected even when
    // the default selectedIndex doesn't match.
    const select = makeSelectWithOptions(['a', 'b', 'c'])
    document.body.appendChild(select)
    const { value } = makeRegisterValue('c' as unknown as never)

    hooks.created?.(select, makeBinding(value, {}), makeVNode({}), null)
    hooks.mounted?.(select, makeBinding(value, {}), makeVNode({}), null)

    expect(select.selectedIndex).toBe(2)
  })

  it('mounted: model with no matching option leaves selectedIndex = -1', () => {
    const select = makeSelectWithOptions(['1', '2', '3'])
    document.body.appendChild(select)
    const { value } = makeRegisterValue(99 as unknown as never)

    hooks.created?.(select, makeBinding(value, { number: true }), makeVNode({}), null)
    hooks.mounted?.(select, makeBinding(value, { number: true }), makeVNode({}), null)

    expect(select.selectedIndex).toBe(-1)
  })

  it('mounted: multi-select with array model selects matching options', () => {
    const select = makeSelectWithOptions(['1', '2', '3'])
    select.multiple = true
    document.body.appendChild(select)
    const { value } = makeRegisterValue<number[]>([1, 3])

    hooks.created?.(select, makeBinding(value, { number: true }), makeVNode({}), null)
    hooks.mounted?.(select, makeBinding(value, { number: true }), makeVNode({}), null)

    expect(select.options[0]?.selected).toBe(true)
    expect(select.options[1]?.selected).toBe(false)
    expect(select.options[2]?.selected).toBe(true)
  })

  it('updated: re-syncs DOM when model changes', () => {
    const select = makeSelectWithOptions(['1', '2', '3'])
    document.body.appendChild(select)
    const { value } = makeRegisterValue(1 as unknown as never)

    hooks.created?.(select, makeBinding(value, { number: true }), makeVNode({}), null)
    hooks.mounted?.(select, makeBinding(value, { number: true }), makeVNode({}), null)
    expect(select.selectedIndex).toBe(0)

    // Programmatic model change → trigger updated hook.
    ;(value.innerRef as { value: unknown }).value = 3
    hooks.updated?.(select, makeBinding(value, { number: true }), makeVNode({}), null)
    expect(select.selectedIndex).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────
// `vRegisterText.beforeUpdate` lazy/trim escape-hatches
// ─────────────────────────────────────────────────────────────────

describe('vRegisterText.beforeUpdate — escape hatches under focus', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('`.lazy`: while focused, suppresses reverse-sync when value === oldValue', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    input.focus()
    const { value } = makeRegisterValue('original')
    value.innerRef = ref('mid-edit') as typeof value.innerRef

    // User has typed 'half' — el.value represents in-progress input.
    input.value = 'half'

    // beforeUpdate fires with `value === oldValue` (the consumer ref
    // didn't change between renders) — under `.lazy` while focused,
    // we should NOT clobber el.value.
    const binding = {
      value,
      oldValue: 'mid-edit',
      modifiers: { lazy: true },
      arg: undefined,
      dir: {},
      instance: null,
    } as unknown as DirectiveBinding
    hooks.beforeUpdate?.(input, binding, makeVNode({}), null)

    expect(input.value).toBe('half')
  })

  it('`.trim`: while focused, suppresses reverse-sync when el.value.trim() === newValue', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    input.focus()
    const { value } = makeRegisterValue('hello')

    // User has trailing whitespace they're still managing.
    input.value = 'hello '

    const binding = makeBinding(value, { trim: true })
    hooks.beforeUpdate?.(input, binding, makeVNode({}), null)

    // el.value preserved — the trimmed form already matches the model.
    expect(input.value).toBe('hello ')
  })
})

// ─────────────────────────────────────────────────────────────────
// chemical-x-specific interactions
// ─────────────────────────────────────────────────────────────────

describe('chemical-x interactions: `.number` × slim-primitive gate', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('non-castable input never reaches the gate — directive marks transient-empty instead', () => {
    // Post-commit-5 the directive's `.number` listener short-circuits
    // BEFORE the assigner when `looseToNumber` returns a non-number,
    // so the slim-primitive gate never sees the bogus write. The
    // user's typed input stays in the DOM (the directive doesn't
    // roll back on transient-empty either) and submit-time
    // validation raises "Required" if the schema demands a number.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)

    const { value, setValue } = makeRegisterValue(0 as unknown as never)
    const markTransientEmpty = vi.fn(() => true)
    value.markTransientEmpty = markTransientEmpty

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = 'abc'
    expect(() => input.dispatchEvent(new Event('input'))).not.toThrow()

    expect(setValue).not.toHaveBeenCalled()
    expect(markTransientEmpty).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('abc')
  })
})

describe('chemical-x interactions: `.lazy` × value-swap', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('listener attaches at `created` regardless of value; post-swap writes route through `change` only', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)

    // Created with undefined under `.lazy` — listener still attaches
    // to `change` (modifier is read at created time, not at swap time).
    hooks.created?.(
      input,
      makeBinding(undefined as unknown as RegisterValue<string>, { lazy: true }),
      makeVNode({}),
      null
    )

    // Swap in a real RV.
    const next = makeRegisterValue('')
    const swap = {
      value: next.value,
      oldValue: undefined,
      modifiers: { lazy: true },
      arg: undefined,
      dir: {},
      instance: null,
    } as unknown as DirectiveBinding
    hooks.beforeUpdate?.(input, swap, makeVNode({}), null)

    // `input` event under .lazy should NOT write.
    input.value = 'typed'
    input.dispatchEvent(new Event('input'))
    expect(next.setValue).not.toHaveBeenCalled()

    // `change` event routes the write to the new RV.
    input.dispatchEvent(new Event('change'))
    expect(next.setValue).toHaveBeenCalledTimes(1)
    expect(next.setValue).toHaveBeenCalledWith('typed', expect.objectContaining({}))
  })
})

// ─────────────────────────────────────────────────────────────────
// Dispatcher propagates modifiers
// ─────────────────────────────────────────────────────────────────

describe('vRegisterDynamic — propagates modifiers to the per-tag variant', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('`.lazy` on a text input reaches vRegisterText', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue('')

    // Going through the umbrella `vRegister` (which IS vRegisterDynamic)
    // exercises the dispatcher path in `vRegisterDynamic.created` →
    // `callModelHook` → `vRegisterText.created`.
    hooks.created?.(input, makeBinding(value, { lazy: true }), makeVNode({}), null)

    input.value = 'x'
    input.dispatchEvent(new Event('input'))
    expect(setValue).not.toHaveBeenCalled()

    input.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenCalledWith('x', expect.objectContaining({}))
  })

  it('`.number` on a select reaches vRegisterSelect', () => {
    const select = document.createElement('select')
    for (const v of ['1', '2', '3']) {
      const opt = document.createElement('option')
      opt.value = v
      opt.text = v
      select.appendChild(opt)
    }
    document.body.appendChild(select)
    const { value, setValue } = makeRegisterValue(1 as unknown as never)

    hooks.created?.(select, makeBinding(value, { number: true }), makeVNode({}), null)

    select.value = '2'
    select.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenCalledWith(2, expect.objectContaining({}))
  })
})

// Suppress dev-warn console noise from the directive's "is a no-op"
// check (fires when v-register is bound to a non-supported root). None
// of the tests above actually trigger it because every binding is on a
// supported native element, but the deferred warn could surface if a
// future test refactor changes that.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

// ─────────────────────────────────────────────────────────────────
// Regression: spike-discovered bugs
// ─────────────────────────────────────────────────────────────────

/**
 * Spike `16b` reported "can't use the spacebar at all" on a
 * `.trim`-modified text input. Pre-fix the directive trimmed the
 * value on every input event; that wrote the trimmed string to the
 * model, Vue's `:value` patch then pulled the DOM back to match
 * the (shorter) model on the next render and the user's
 * just-typed space disappeared. Fix: defer the trim to `change`
 * (blur) and let mid-typing writes keep their whitespace.
 */
describe('regression: vRegisterText × `.trim` × spacebar after text', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('typing a trailing space after content writes the RAW value (deferred trim)', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue('')

    hooks.created?.(input, makeBinding(value, { trim: true }), makeVNode({}), null)

    // User types "hello"
    input.value = 'hello'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith('hello', expect.objectContaining({}))

    // User then types a trailing space. With deferred trim the model
    // sees the raw "hello " so Vue's :value patch stays in sync
    // with the DOM and the space the user is mid-typing survives.
    input.value = 'hello '
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith('hello ', expect.objectContaining({}))
    expect(input.value).toBe('hello ')
  })

  it('typing "hello world" character-by-character preserves the internal space', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue('')

    hooks.created?.(input, makeBinding(value, { trim: true }), makeVNode({}), null)

    const sequence = ['h', 'he', 'hel', 'hell', 'hello', 'hello ', 'hello w']
    for (const next of sequence) {
      input.value = next
      input.dispatchEvent(new Event('input'))
    }

    // After the full sequence the form holds the raw "hello w" —
    // deferred trim does not strip the trailing space until blur.
    expect(setValue).toHaveBeenLastCalledWith('hello w', expect.objectContaining({}))
    expect(input.value).toBe('hello w')
  })

  it('many leading spaces survive until a real character is typed AND blur is committed', () => {
    // Pre-fix scenario: user mashes the spacebar (form="" each
    // keystroke under per-keystroke trim). DOM accumulates spaces.
    // First non-space keystroke triggers per-keystroke trim → form
    // becomes "a", patchDOMProp pulls DOM back from "          a"
    // to "a", wiping the user's spaces. With deferred trim, every
    // intermediate write is the raw el.value; no pull-back happens.
    // The trim is committed only on blur.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue('')

    hooks.created?.(input, makeBinding(value, { trim: true }), makeVNode({}), null)

    const tenSpaces = ' '.repeat(10)
    input.value = tenSpaces
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(tenSpaces, expect.objectContaining({}))

    // First real character — model still receives the raw value.
    input.value = `${tenSpaces}a`
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(`${tenSpaces}a`, expect.objectContaining({}))
    expect(input.value).toBe(`${tenSpaces}a`)

    // Blur commits the trim — DOM and model agree on "a".
    input.dispatchEvent(new Event('change'))
    expect(setValue).toHaveBeenLastCalledWith('a', expect.objectContaining({}))
    expect(input.value).toBe('a')
  })
})

/**
 * Spike `16e` reported a noisy dev warning when backspacing a
 * `<input type="number">` bound to `z.number()` from "1" to empty.
 * The directive auto-casts via looseToNumber; an empty string isn't
 * parseable, so looseToNumber returns the input unchanged and the
 * slim-primitive gate sees a string heading to a numeric slot →
 * rejection + dev-warn.
 *
 * Clearing a numeric input is a normal UI affordance; the dev-warn
 * makes that look like a programmer error. The fix: the directive
 * skips the assigner call when the input is empty AND a number cast
 * is requested. Form state stays at the previous valid value, the
 * user retains the empty DOM (mid-edit), and no dev-warn fires.
 */
describe('regression: vRegisterText × type="number" × backspace-to-empty', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('backspacing from "1" to "" does not call setValue (avoids slim-primitive rejection)', () => {
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    // No explicit `.number` modifier — vnode.props.type='number'
    // auto-applies the cast.
    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    // Type "1": writes 1 (the number).
    input.value = '1'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(setValue).toHaveBeenLastCalledWith(1, expect.objectContaining({}))

    // Backspace to empty: directive must NOT call setValue with "".
    // The form stays at the previously-accepted numeric value; the
    // user can keep editing without the gate firing a dev-warn.
    setValue.mockClear()
    input.value = ''
    input.dispatchEvent(new Event('input'))
    expect(setValue).not.toHaveBeenCalled()
  })

  it('explicit `.number` on a text input behaves the same way for empty input', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = '42'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenLastCalledWith(42, expect.objectContaining({}))

    setValue.mockClear()
    input.value = ''
    input.dispatchEvent(new Event('input'))
    expect(setValue).not.toHaveBeenCalled()
  })

  it('non-empty non-numeric input routes through markTransientEmpty (no gate-rejection warning)', () => {
    // Post-commit-5 the directive treats both "" and non-castable
    // input ('abc') as the empty case: the assigner doesn't fire,
    // and `markTransientEmpty` writes the slim default with the
    // transient-empty meta. Submit-time validation raises "Required"
    // for required schemas — the dev-warn-via-gate-rejection that
    // pre-commit-5 surfaced was a worse UX than this.
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)
    const markTransientEmpty = vi.fn(() => true)
    value.markTransientEmpty = markTransientEmpty

    hooks.created?.(input, makeBinding(value, { number: true }), makeVNode({}), null)

    input.value = 'abc'
    input.dispatchEvent(new Event('input'))
    expect(setValue).not.toHaveBeenCalled()
    expect(markTransientEmpty).toHaveBeenCalledTimes(1)
  })

  it('backspace-to-empty also routes through markTransientEmpty (commit 5)', () => {
    // Pre-commit-5 the directive skipped the assigner silently — UI
    // showed empty but storage held the previous valid number, so
    // submit could ship a stale value. Post-commit-5 the empty case
    // marks transient-empty: storage flips to the slim default and
    // submit raises "Required" if the schema demands a number.
    const input = document.createElement('input')
    input.type = 'number'
    document.body.appendChild(input)
    const { value, setValue } = makeRegisterValue(0 as unknown as never)
    const markTransientEmpty = vi.fn(() => true)
    value.markTransientEmpty = markTransientEmpty

    hooks.created?.(input, makeBinding(value, {}), makeVNode({ type: 'number' }), null)

    input.value = '1'
    input.dispatchEvent(new Event('input'))
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(setValue).toHaveBeenLastCalledWith(1, expect.objectContaining({}))

    setValue.mockClear()
    input.value = ''
    input.dispatchEvent(new Event('input'))
    expect(setValue).not.toHaveBeenCalled()
    expect(markTransientEmpty).toHaveBeenCalledTimes(1)
  })
})
