// @vitest-environment jsdom
//
// DOM-flow integration tests for schema-driven coercion. Pairs with
// the unit-level coverage in `test/core/schema-coerce.test.ts` —
// these tests exercise the full path from user-driven DOM events
// through the directive's assigner → transforms → coerce → write.
//
// Per-variant matrix (text / select-single / select-multi /
// checkbox-array / checkbox-Set / checkbox-scalar / radio) plus the
// regression cases (NaN passthrough, programmatic-write bypass,
// plugin/per-form config interactions, @update:registerValue override
// receives coerced value, el[assignKey] direct-install bypass,
// reference-equality, transform-abort short-circuit).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister, isRegisterValue, assignKey } from '../../src/runtime/core/directive'
import { createDecant } from '../../src/runtime/core/plugin'
import { defineCoercion, defaultCoercionRules } from '../../src/runtime/core/schema-coerce'

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function mount<S extends z.ZodObject>(
  schema: S,
  defaultValues: z.infer<S>,
  body: (api: ReturnType<typeof useForm<S>>) => unknown,
  pluginOpts?: Parameters<typeof createDecant>[0]
): { api: ReturnType<typeof useForm<S>>; root: HTMLDivElement } {
  const handle: { api?: ReturnType<typeof useForm<S>> } = {}
  const Parent = defineComponent({
    setup() {
      const api = useForm({
        schema,
        defaultValues,
        key: `coerce-${Math.random().toString(36).slice(2)}`,
      } as Parameters<typeof useForm<S>>[0])
      handle.api = api
      return () => body(api)
    },
  })
  app = createApp(Parent).use(createDecant(pluginOpts))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  if (handle.api === undefined) throw new Error('api never set')
  return { api: handle.api, root }
}

describe('text input — numeric path', () => {
  const schema = z.object({ age: z.number(), note: z.string() })

  it('typing "25" coerces to number 25 in storage', async () => {
    const { api, root } = mount(schema, { age: 0, note: '' }, (api) => {
      const rv = api.register('age')
      return h('div', null, [
        withDirectives(h('input', { type: 'text', 'data-field': 'age' }), [[vRegister, rv]]),
      ])
    })
    await flush()
    const input = root.querySelector('[data-field="age"]') as HTMLInputElement
    input.value = '25'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(api.values.age).toBe(25)
  })

  it('empty string passes through; gate rejects (no silent zero)', async () => {
    // Suppress the gate's dev-warn so test output stays clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api, root } = mount(schema, { age: 5, note: '' }, (api) => {
      const rv = api.register('age')
      return h('div', null, [
        withDirectives(h('input', { type: 'text', 'data-field': 'age' }), [[vRegister, rv]]),
      ])
    })
    await flush()
    const input = root.querySelector('[data-field="age"]') as HTMLInputElement
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    // Empty string is NOT coerced to 0; it passes through and the
    // gate rejects → state preserves the original 5.
    expect(api.values.age).toBe(5)
  })
})

describe('text input — boolean path', () => {
  it('typing "true" / "false" coerces to boolean', async () => {
    const schema = z.object({ active: z.boolean() })
    const { api, root } = mount(schema, { active: false }, (api) => {
      const rv = api.register('active')
      return h('div', null, [
        withDirectives(h('input', { type: 'text', 'data-field': 'active' }), [[vRegister, rv]]),
      ])
    })
    await flush()
    const input = root.querySelector('[data-field="active"]') as HTMLInputElement
    input.value = 'true'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(api.values.active).toBe(true)
  })
})

describe('text input — `.number` modifier composes without double-coerce', () => {
  it('modifier runs first; coerce sees a number and short-circuits', async () => {
    const schema = z.object({ age: z.number() })
    const { api, root } = mount(schema, { age: 0 }, (api) => {
      const rv = api.register('age')
      return h('div', null, [
        withDirectives(h('input', { type: 'text', 'data-field': 'age' }), [
          [vRegister, rv, 'number' as never, { number: true }],
        ]),
      ])
    })
    await flush()
    const input = root.querySelector('[data-field="age"]') as HTMLInputElement
    input.value = '42'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(api.values.age).toBe(42)
  })
})

describe('select (single) — numeric path', () => {
  it('selecting an option coerces to number', async () => {
    const schema = z.object({ pick: z.number() })
    const { api, root } = mount(schema, { pick: 1 }, (api) => {
      const rv = api.register('pick')
      return h('div', null, [
        withDirectives(
          h('select', { 'data-field': 'pick' }, [
            h('option', { value: '1' }, '1'),
            h('option', { value: '2' }, '2'),
            h('option', { value: '3' }, '3'),
          ]),
          [[vRegister, rv]]
        ),
      ])
    })
    await flush()
    const sel = root.querySelector('[data-field="pick"]') as HTMLSelectElement
    sel.value = '2'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.pick).toBe(2)
  })
})

describe('select (multi) — number array', () => {
  it('select two number options stores [1, 2]', async () => {
    const schema = z.object({ ids: z.array(z.number()) })
    const { api, root } = mount(schema, { ids: [] }, (api) => {
      const rv = api.register('ids')
      return h('div', null, [
        withDirectives(
          h('select', { multiple: true, 'data-field': 'ids' }, [
            h('option', { value: '1' }, '1'),
            h('option', { value: '2' }, '2'),
            h('option', { value: '3' }, '3'),
          ]),
          [[vRegister, rv]]
        ),
      ])
    })
    await flush()
    const sel = root.querySelector('[data-field="ids"]') as HTMLSelectElement
    const [opt1, opt2] = Array.from(sel.options) as [HTMLOptionElement, HTMLOptionElement]
    opt1.selected = true
    opt2.selected = true
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.ids).toEqual([1, 2])
  })
})

describe('select (multi) — number Set', () => {
  it('select two number options stores Set { 1, 2 }', async () => {
    const schema = z.object({ ids: z.set(z.number()) })
    const { api, root } = mount(schema, { ids: new Set<number>() }, (api) => {
      const rv = api.register('ids')
      return h('div', null, [
        withDirectives(
          h('select', { multiple: true, 'data-field': 'ids' }, [
            h('option', { value: '1' }, '1'),
            h('option', { value: '2' }, '2'),
          ]),
          [[vRegister, rv]]
        ),
      ])
    })
    await flush()
    const sel = root.querySelector('[data-field="ids"]') as HTMLSelectElement
    const [opt1, opt2] = Array.from(sel.options) as [HTMLOptionElement, HTMLOptionElement]
    opt1.selected = true
    opt2.selected = true
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.ids).toEqual(new Set([1, 2]))
  })
})

describe('checkbox array — numeric values', () => {
  it('toggling a checkbox with value="3" pushes 3 (number) into the array', async () => {
    const schema = z.object({ ids: z.array(z.number()) })
    const { api, root } = mount(schema, { ids: [] }, (api) => {
      const rv = api.register('ids')
      return h('div', null, [
        withDirectives(h('input', { type: 'checkbox', value: '3', 'data-field': 'cb3' }), [
          [vRegister, rv],
        ]),
      ])
    })
    await flush()
    const cb = root.querySelector('[data-field="cb3"]') as HTMLInputElement
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.ids).toEqual([3])
  })
})

describe('checkbox Set — boolean values', () => {
  it('checkboxes with value="true"/"false" produce booleans in a Set', async () => {
    const schema = z.object({ flags: z.set(z.boolean()) })
    const { api, root } = mount(schema, { flags: new Set<boolean>() }, (api) => {
      const rv = api.register('flags')
      return h('div', null, [
        withDirectives(h('input', { type: 'checkbox', value: 'true', 'data-field': 't' }), [
          [vRegister, rv],
        ]),
        withDirectives(h('input', { type: 'checkbox', value: 'false', 'data-field': 'f' }), [
          [vRegister, rv],
        ]),
      ])
    })
    await flush()
    const t = root.querySelector('[data-field="t"]') as HTMLInputElement
    t.checked = true
    t.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.flags).toEqual(new Set([true]))

    const f = root.querySelector('[data-field="f"]') as HTMLInputElement
    f.checked = true
    f.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.flags).toEqual(new Set([true, false]))
  })
})

describe('checkbox scalar — boolean path (no-op)', () => {
  it('a single boolean checkbox writes booleans (already-correct kind)', async () => {
    const schema = z.object({ active: z.boolean() })
    const { api, root } = mount(schema, { active: false }, (api) => {
      const rv = api.register('active')
      return h('div', null, [
        withDirectives(h('input', { type: 'checkbox', 'data-field': 'cb' }), [[vRegister, rv]]),
      ])
    })
    await flush()
    const cb = root.querySelector('[data-field="cb"]') as HTMLInputElement
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.active).toBe(true)
  })
})

describe('checkbox with true-value / false-value — composes with coerce', () => {
  // `:true-value` / `:false-value` are Vue v-model conventions that
  // store custom values in the model when a checkbox toggles. The
  // directive routes the chosen value through the same assigner
  // pipeline as everything else, so coerce composes correctly:
  // already-correct kinds are no-ops; string-typed attrs against a
  // numeric/boolean schema get coerced; misaligned attrs vs schema
  // (e.g. "yes"/"no" against z.boolean()) pass through and the gate
  // rejects with its existing dev-warn.

  it('string true-value/false-value against z.string() schema → no-op (already string)', async () => {
    const schema = z.object({ choice: z.string() })
    const { api, root } = mount(schema, { choice: 'no' }, (api) => {
      const rv = api.register('choice')
      return h('div', null, [
        withDirectives(
          h('input', {
            type: 'checkbox',
            'true-value': 'yes',
            'false-value': 'no',
            'data-field': 'cb',
          }),
          [[vRegister, rv]]
        ),
      ])
    })
    await flush()
    const cb = root.querySelector('[data-field="cb"]') as HTMLInputElement
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.choice).toBe('yes')
  })

  // Bound `:true-value` (non-string) is exercised via templates +
  // checkbox.test.ts directly — render-function `h()` doesn't reach
  // Vue's `_trueValue` slot the same way the compiled template
  // path does. Verified end-to-end in spike-cx.vue scenarios.

  it('case-insensitive true-value="True" against z.boolean() schema → coerced to true', async () => {
    const schema = z.object({ accepted: z.boolean() })
    const { api, root } = mount(schema, { accepted: false }, (api) => {
      const rv = api.register('accepted')
      return h('div', null, [
        withDirectives(
          h('input', {
            type: 'checkbox',
            'true-value': 'True',
            'false-value': 'False',
            'data-field': 'cb',
          }),
          [[vRegister, rv]]
        ),
      ])
    })
    await flush()
    const cb = root.querySelector('[data-field="cb"]') as HTMLInputElement
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.accepted).toBe(true)
  })

  it('checkbox visual stays in sync with model across multiple toggles (case-mismatched true-value)', async () => {
    // Regression for the desync where setChecked compared the
    // post-coerce boolean model against the RAW `_trueValue` string
    // ("True", capital T) via `looseEqual`. Vue's looseEqual does
    // case-sensitive `String()` comparison — `looseEqual(true,
    // "True")` is false — so setChecked decided the box should be
    // unchecked and overwrote the user's click. Fix: setChecked
    // coerces the raw _trueValue through the same registry before
    // comparing.
    //
    // We set `_trueValue` / `_falseValue` imperatively via a ref
    // callback because render-function `h()` can't reach Vue's
    // template-only `:true-value` slot. The `<pre>` reading
    // `api.values.accepted` matters: it's the reactive dep that
    // schedules the re-render which fires `beforeUpdate` →
    // `setChecked`. Without it, the bug stays latent (no rerender,
    // no faulty re-comparison) and the test would pass pre-fix.
    const schema = z.object({ accepted: z.boolean() })
    const { api, root } = mount(schema, { accepted: false }, (api) => {
      const rv = api.register('accepted')
      return h('div', null, [
        withDirectives(
          h('input', {
            type: 'checkbox',
            'data-field': 'cb',
            ref: (el: unknown) => {
              if (el === null || !(el instanceof HTMLInputElement)) return
              const carrier = el as HTMLInputElement & {
                _trueValue?: unknown
                _falseValue?: unknown
              }
              carrier._trueValue = 'True'
              carrier._falseValue = 'False'
            },
          }),
          [[vRegister, rv]]
        ),
        h('pre', null, JSON.stringify(api.values.accepted)),
      ])
    })
    await flush()
    const cb = root.querySelector('[data-field="cb"]') as HTMLInputElement
    expect(cb.checked).toBe(false)
    expect(api.values.accepted).toBe(false)

    // Toggle ON.
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.accepted).toBe(true)
    expect(cb.checked).toBe(true) // pre-fix this would be false (desync)

    // Toggle OFF.
    cb.checked = false
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.accepted).toBe(false)
    expect(cb.checked).toBe(false)

    // Toggle ON again — confirm the cycle is clean (no every-other-
    // click desync that the original report described).
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.accepted).toBe(true)
    expect(cb.checked).toBe(true)
  })

  it('misaligned attrs ("yes"/"no") against z.boolean() schema → passthrough; gate rejects', async () => {
    // Documented contract: when true-value/false-value disagree with
    // the schema's slim type, coerce can't bridge the gap unless the
    // consumer registers a rule. The slim gate rejects, the dev-warn
    // surfaces, and the dev fixes either the schema or the attrs (or
    // adds a custom coercion entry).
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = z.object({ accepted: z.boolean() })
    const { api, root } = mount(schema, { accepted: false }, (api) => {
      const rv = api.register('accepted')
      return h('div', null, [
        withDirectives(
          h('input', {
            type: 'checkbox',
            'true-value': 'yes',
            'false-value': 'no',
            'data-field': 'cb',
          }),
          [[vRegister, rv]]
        ),
      ])
    })
    await flush()
    const cb = root.querySelector('[data-field="cb"]') as HTMLInputElement
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    // 'yes' isn't 'true'/'false' post-trim+lowercase → coerce passes
    // through → gate rejects → state preserves the original `false`.
    expect(api.values.accepted).toBe(false)
  })
})

describe('radio — boolean path', () => {
  it('selecting value="true"/"false" radios stores boolean', async () => {
    const schema = z.object({ active: z.boolean() })
    const { api, root } = mount(schema, { active: false }, (api) => {
      const rv = api.register('active')
      return h('div', null, [
        withDirectives(h('input', { type: 'radio', name: 'a', value: 'true', 'data-field': 't' }), [
          [vRegister, rv],
        ]),
        withDirectives(
          h('input', { type: 'radio', name: 'a', value: 'false', 'data-field': 'f' }),
          [[vRegister, rv]]
        ),
      ])
    })
    await flush()
    const t = root.querySelector('[data-field="t"]') as HTMLInputElement
    t.checked = true
    t.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.active).toBe(true)
  })
})

describe('NaN passthrough + gate rejection', () => {
  it('typing "abc" into a numeric path leaves state unchanged', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = z.object({ age: z.number() })
    const { api, root } = mount(schema, { age: 5 }, (api) => {
      const rv = api.register('age')
      return h('div', null, [
        withDirectives(h('input', { type: 'text', 'data-field': 'age' }), [[vRegister, rv]]),
      ])
    })
    await flush()
    const input = root.querySelector('[data-field="age"]') as HTMLInputElement
    input.value = 'abc'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    // 'abc' is non-coercible; coerce passes through; gate rejects.
    expect(api.values.age).toBe(5)
  })
})

describe('programmatic write bypass', () => {
  it("form.setValue('age', '25') is rejected (coerce never runs)", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = z.object({ age: z.number() })
    const { api } = mount(schema, { age: 0 }, () => h('div'))
    await flush()
    api.setValue('age', '25' as unknown as number)
    await flush()
    // Coerce only fires on directive-driven writes. Programmatic
    // writes go through the slim gate untouched, which rejects.
    expect(api.values.age).toBe(0)
  })
})

describe('plugin-default off', () => {
  it('createDecant({ defaults: { coerce: false } }) disables coerce globally', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = z.object({ age: z.number() })
    const { api, root } = mount(
      schema,
      { age: 0 },
      (api) => {
        const rv = api.register('age')
        return h('div', null, [
          withDirectives(h('input', { type: 'text', 'data-field': 'age' }), [[vRegister, rv]]),
        ])
      },
      { defaults: { coerce: false } }
    )
    await flush()
    const input = root.querySelector('[data-field="age"]') as HTMLInputElement
    input.value = '25'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    // Coerce off → string write rejected by gate; state unchanged.
    expect(api.values.age).toBe(0)
  })
})

describe('per-form override beats plugin default (both directions)', () => {
  it('plugin off + useForm({ coerce: true }) → coerce runs', async () => {
    const schema = z.object({ age: z.number() })
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { age: 0 },
          key: `coerce-on-${Math.random()}`,
          coerce: true,
        })
        handle.api = api
        const rv = api.register('age')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'text', 'data-field': 'age' }), [[vRegister, rv]]),
          ])
      },
    })
    app = createApp(Parent).use(createDecant({ defaults: { coerce: false } }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()
    if (handle.api === undefined) throw new Error('api never set')
    const input = root.querySelector('[data-field="age"]') as HTMLInputElement
    input.value = '25'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(handle.api.values.age).toBe(25)
  })

  it('plugin on + useForm({ coerce: false }) → coerce off', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = z.object({ age: z.number() })
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { age: 0 },
          key: `coerce-off-${Math.random()}`,
          coerce: false,
        })
        handle.api = api
        const rv = api.register('age')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'text', 'data-field': 'age' }), [[vRegister, rv]]),
          ])
      },
    })
    app = createApp(Parent).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()
    if (handle.api === undefined) throw new Error('api never set')
    const input = root.querySelector('[data-field="age"]') as HTMLInputElement
    input.value = '25'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(handle.api.values.age).toBe(0)
  })
})

describe('@update:registerValue override receives the coerced value', () => {
  it('handler captures a number, not a string', async () => {
    const schema = z.object({ age: z.number() })
    let captured: unknown = undefined
    const { root } = mount(schema, { age: 0 }, (api) => {
      const rv = api.register('age')
      return h('div', null, [
        withDirectives(
          h('input', {
            type: 'text',
            'data-field': 'age',
            'onUpdate:registerValue': (value: unknown) => {
              captured = value
            },
          }),
          [[vRegister, rv]]
        ),
      ])
    })
    await flush()
    const input = root.querySelector('[data-field="age"]') as HTMLInputElement
    input.value = '42'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(captured).toBe(42)
    expect(typeof captured).toBe('number')
  })
})

describe('el[assignKey] direct-install bypasses coerce', () => {
  it('a custom assigner installed before mount receives the raw string', async () => {
    const schema = z.object({ age: z.number() })
    let captured: unknown = undefined

    // Pre-install the custom assigner BEFORE the directive's `created`
    // hook can install the default. We do this by supplying a hook on
    // the `Parent` component that inspects the rendered DOM and sets
    // `el[assignKey]` on the input — Vue calls our directive's
    // `created` hook before our own `mounted`, but the assignKey
    // pre-install is observed by `setAssignFunction` via the
    // pre-install respect path.
    //
    // To exercise this without a custom directive, we set the assigner
    // imperatively in setup() via a template ref, then return an
    // `onMounted` callback that installs the listener. This mirrors
    // how a Web-Component / ShadowDOM consumer would integrate.
    const { root } = mount(schema, { age: 0 }, (api) => {
      const rv = api.register('age')
      return h('div', null, [
        withDirectives(
          h('input', {
            type: 'text',
            'data-field': 'age',
            ref: (el: unknown) => {
              if (el === null || !(el instanceof HTMLInputElement)) return
              const carrier = el as unknown as Record<symbol, (v: unknown) => void>
              carrier[assignKey] = (value: unknown) => {
                captured = value
              }
              // Wire the input event manually since the directive's
              // default path is replaced.
              el.addEventListener('input', () => {
                carrier[assignKey]!(el.value)
              })
            },
          }),
          [[vRegister, rv]]
        ),
      ])
    })
    await flush()
    const input = root.querySelector('[data-field="age"]') as HTMLInputElement
    input.value = '42'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    // Custom assigner ran, received the raw string. The directive's
    // pipeline (transforms + coerce) wasn't invoked.
    expect(captured).toBe('42')
    expect(typeof captured).toBe('string')
  })
})

describe('reference-equality preservation', () => {
  it('an already-numeric array returns the SAME reference after coerce', async () => {
    const schema = z.object({ ids: z.array(z.number()), note: z.string() })
    const { api, root } = mount(schema, { ids: [1, 2, 3], note: '' }, (api) => {
      const rvNote = api.register('note')
      return h('div', null, [
        withDirectives(h('input', { type: 'text', 'data-field': 'note' }), [[vRegister, rvNote]]),
      ])
    })
    await flush()
    // Take a snapshot of the array reference.
    const before = api.values.ids
    // Trigger a re-render via an unrelated keystroke. Coerce isn't
    // touched (the keystroke goes to `note`), but this test guards
    // against future hot-paths that might re-allocate IDs.
    const input = root.querySelector('[data-field="note"]') as HTMLInputElement
    input.value = 'x'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(api.values.ids).toBe(before)
  })
})

describe('consumer-extended registry — string->bigint', () => {
  it('a custom bigint rule supplied via plugin coerces', async () => {
    const schema = z.object({ amount: z.bigint() })
    const customRules = [
      ...defaultCoercionRules,
      defineCoercion({
        input: 'string',
        output: 'bigint',
        transform: (s) => {
          try {
            return { coerced: true, value: BigInt(s) }
          } catch {
            return { coerced: false }
          }
        },
      }),
    ]
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { amount: 0n },
          key: `bigint-coerce-${Math.random()}`,
        })
        handle.api = api
        const rv = api.register('amount')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'text', 'data-field': 'amount' }), [[vRegister, rv]]),
          ])
      },
    })
    app = createApp(Parent).use(createDecant({ defaults: { coerce: customRules } }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()
    if (handle.api === undefined) throw new Error('api never set')
    const input = root.querySelector('[data-field="amount"]') as HTMLInputElement
    input.value = '12345'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(handle.api.values.amount).toBe(12345n)
  })
})

// ============================================================
// Read-side normalizer-symmetry sweep — the same shape of bug
// (post-coerce model vs raw DOM-side comparison) lurks in every
// directive site that compares model state against an option /
// checkbox / radio attribute. Each test below uses a reactive
// read on the value (the `<pre>` JSON.stringify) to schedule the
// re-render that fires `beforeUpdate` / `setChecked` / `setSelected`
// — without it, the bugs stay latent. Pre-fix these tests fail at
// the visual-state assertion after the second toggle.
// ============================================================

describe('read-side coerce symmetry — array checkbox with case-mismatched boolean values', () => {
  it('checkbox array stays in sync across toggles when option value is "True"/"False"', async () => {
    const schema = z.object({ flags: z.array(z.boolean()) })
    const { api, root } = mount(schema, { flags: [] }, (api) => {
      const rv = api.register('flags')
      return h('div', null, [
        withDirectives(h('input', { type: 'checkbox', value: 'True', 'data-field': 't' }), [
          [vRegister, rv],
        ]),
        h('pre', null, JSON.stringify(api.values.flags)),
      ])
    })
    await flush()
    const t = root.querySelector('[data-field="t"]') as HTMLInputElement
    t.checked = true
    t.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.flags).toEqual([true])
    expect(t.checked).toBe(true) // pre-fix this would be false (array branch desync)

    t.checked = false
    t.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.flags).toEqual([])
    expect(t.checked).toBe(false)
  })
})

describe('read-side coerce symmetry — Set checkbox with numeric values', () => {
  it('checkbox Set stays in sync — Set.has uses === so any kind mismatch breaks it', async () => {
    const schema = z.object({ tags: z.set(z.number()) })
    const { api, root } = mount(schema, { tags: new Set<number>() }, (api) => {
      const rv = api.register('tags')
      return h('div', null, [
        withDirectives(h('input', { type: 'checkbox', value: '1', 'data-field': 'cb1' }), [
          [vRegister, rv],
        ]),
        h('pre', null, JSON.stringify([...api.values.tags])),
      ])
    })
    await flush()
    const cb = root.querySelector('[data-field="cb1"]') as HTMLInputElement
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.tags).toEqual(new Set([1]))
    // Pre-fix Set.has(model, "1") against Set<number>{1} returned
    // false (strict ===) → setChecked wrote el.checked = false.
    expect(cb.checked).toBe(true)
  })
})

describe('read-side coerce symmetry — multi-select with case-mismatched boolean options', () => {
  it('select multi shows the selected booleans across re-renders', async () => {
    const schema = z.object({ flags: z.array(z.boolean()), note: z.string() })
    const { api, root } = mount(schema, { flags: [], note: '' }, (api) => {
      const rvFlags = api.register('flags')
      const rvNote = api.register('note')
      return h('div', null, [
        withDirectives(
          h('select', { multiple: true, 'data-field': 'sel' }, [
            h('option', { value: 'True' }, 'true'),
            h('option', { value: 'False' }, 'false'),
          ]),
          [[vRegister, rvFlags]]
        ),
        withDirectives(h('input', { type: 'text', 'data-field': 'note' }), [[vRegister, rvNote]]),
        h('pre', null, JSON.stringify(api.values.flags)),
      ])
    })
    await flush()
    const sel = root.querySelector('[data-field="sel"]') as HTMLSelectElement
    const [optTrue, optFalse] = Array.from(sel.options) as [HTMLOptionElement, HTMLOptionElement]
    optTrue.selected = true
    optFalse.selected = true
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.flags).toEqual([true, false])

    // Force another re-render via a sibling write — this exercises
    // setSelected with the post-coerce model, where pre-fix
    // `String(true)` ("true") wouldn't match `String(option.value)`
    // ("True") and both options would silently get deselected.
    const note = root.querySelector('[data-field="note"]') as HTMLInputElement
    note.value = 'x'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(optTrue.selected).toBe(true)
    expect(optFalse.selected).toBe(true)
  })
})

describe('read-side coerce symmetry — single-select with case-mismatched boolean', () => {
  it('select single highlights the option matching the post-coerce model', async () => {
    const schema = z.object({ active: z.boolean() })
    const { api, root } = mount(schema, { active: false }, (api) => {
      const rv = api.register('active')
      return h('div', null, [
        withDirectives(
          h('select', { 'data-field': 'sel' }, [
            h('option', { value: 'False' }, 'false'),
            h('option', { value: 'True' }, 'true'),
          ]),
          [[vRegister, rv]]
        ),
        h('pre', null, JSON.stringify(api.values.active)),
      ])
    })
    await flush()
    const sel = root.querySelector('[data-field="sel"]') as HTMLSelectElement
    sel.value = 'True'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.active).toBe(true)
    // Pre-fix selectedIndex would land at -1 — looseEqual(true, "True")
    // returned false, so no option matched.
    expect(sel.selectedIndex).toBe(1)
  })
})

describe('read-side coerce symmetry — radio with case-mismatched boolean values', () => {
  it('radio cycle stays in sync — pre-fix every-other-click desynced like the checkbox case', async () => {
    const schema = z.object({ active: z.boolean() })
    const { api, root } = mount(schema, { active: false }, (api) => {
      const rv = api.register('active')
      return h('div', null, [
        withDirectives(h('input', { type: 'radio', name: 'a', value: 'True', 'data-field': 't' }), [
          [vRegister, rv],
        ]),
        withDirectives(
          h('input', { type: 'radio', name: 'a', value: 'False', 'data-field': 'f' }),
          [[vRegister, rv]]
        ),
        h('pre', null, JSON.stringify(api.values.active)),
      ])
    })
    await flush()
    const t = root.querySelector('[data-field="t"]') as HTMLInputElement
    const f = root.querySelector('[data-field="f"]') as HTMLInputElement

    t.checked = true
    t.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.active).toBe(true)
    // Pre-fix the beforeUpdate hook ran `looseEqual(true, "True")`
    // → false → `el.checked = false`, immediately undoing the click.
    expect(t.checked).toBe(true)
    expect(f.checked).toBe(false)

    f.checked = true
    f.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.values.active).toBe(false)
    expect(t.checked).toBe(false)
    expect(f.checked).toBe(true)
  })
})

describe('text input on numeric path without `.number` modifier', () => {
  it('input visual mirrors the coerced number model (no clear-on-rerender)', async () => {
    const schema = z.object({ age: z.number() })
    const { api, root } = mount(schema, { age: 0 }, (api) => {
      const rv = api.register('age')
      return h('div', null, [
        withDirectives(h('input', { type: 'text', 'data-field': 'age' }), [[vRegister, rv]]),
        h('pre', null, JSON.stringify(api.values.age)),
      ])
    })
    await flush()
    const input = root.querySelector('[data-field="age"]') as HTMLInputElement
    input.value = '25'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(api.values.age).toBe(25)
    // Pre-fix the beforeUpdate hook fell through to
    // `el.value = typeof 25 === 'string' ? 25 : ''` → input cleared.
    expect(input.value).toBe('25')
  })
})

describe('isRegisterValue / assignKey re-export sanity', () => {
  it('re-exported public symbols are reachable', () => {
    expect(typeof isRegisterValue).toBe('function')
    expect(typeof assignKey).toBe('symbol')
  })
})
