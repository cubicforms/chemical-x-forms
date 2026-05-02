// @vitest-environment jsdom
//
// Spike section 18C reproduction: a `transforms: [clamp0to100]`
// pipeline on a `<input type="number" v-register>` against a
// `z.number()` schema clamps user input to [0, 100]. Once the
// user has typed something at the cap (e.g. "100") and continues
// typing more digits ("1000", "10000", "100000"), the post-clamp
// value is identical to the previously-stored value (100). The
// reactive write produces NO patches, NO re-render fires, and
// `beforeUpdate`'s imperative `el.value = String(newValue)` sync
// never runs — so the DOM accepts unbounded typing while storage
// stays pinned at the clamp cap.
//
// User-visible symptom: "type 100000... it just lets us, the UI
// is completely divorced from reality. however, the form stores
// 100, that's it."
//
// The fix lives in the directive's input listener: after the
// assigner write, compare the post-cast typed value against the
// resulting storage. If they diverge (i.e. a transform clamped
// or otherwise mutated the value), force-sync `el.value` to
// match storage. Preserves the typed-form preservation for the
// "1e2" → 100 case (where post-cast `domValue` already equals
// storage, so no force-sync triggers).
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createDecant } from '../../src/runtime/core/plugin'

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

function clamp0to100(value: unknown): unknown {
  if (typeof value !== 'number' || Number.isNaN(value)) return value
  return Math.max(0, Math.min(100, value))
}

describe('spike 18c — `<input type="number">` + clamp transform DOM/storage parity', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('typing past the clamp cap snaps the DOM back to the clamped value', async () => {
    const schema = z.object({ bounded: z.number() })
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { bounded: 0 },
          key: `clamp-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rv = api.register('bounded', { transforms: [clamp0to100] })
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'number', 'data-field': 'bounded' }), [
              [vRegister, rv],
            ]),
          ])
      },
    })
    app = createApp(Parent).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const input = root.querySelector('[data-field="bounded"]') as HTMLInputElement
    if (input === null) throw new Error('input not rendered')
    input.focus()

    // Type up to the cap. Storage and DOM agree: 100/100.
    input.value = '100'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(handle.api?.values.bounded).toBe(100)
    expect(input.value).toBe('100')

    // Type past the cap. The clamp transform produces 100 (same as
    // current storage), so no reactive write fires, no re-render runs,
    // and the DOM keeps the user's "1000" — diverged from storage.
    input.value = '1000'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(handle.api?.values.bounded).toBe(100)
    expect(input.value).toBe('100')

    // Type even further past the cap. Same divergence — the user can
    // keep typing characters into the DOM while storage stays at 100.
    input.value = '100000'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(handle.api?.values.bounded).toBe(100)
    expect(input.value).toBe('100')
  })

  it('typing below the clamp cap snaps the DOM back to the clamped value', async () => {
    const schema = z.object({ bounded: z.number() })
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { bounded: 0 },
          key: `clamp-low-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rv = api.register('bounded', { transforms: [clamp0to100] })
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'number', 'data-field': 'bounded' }), [
              [vRegister, rv],
            ]),
          ])
      },
    })
    app = createApp(Parent).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const input = root.querySelector('[data-field="bounded"]') as HTMLInputElement
    if (input === null) throw new Error('input not rendered')
    input.focus()

    // Type a negative value past the lower cap. Clamp produces 0 ≠ initial
    // storage 0... wait, equal. So this hits the same bug but at the floor.
    input.value = '-5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(handle.api?.values.bounded).toBe(0)
    expect(input.value).toBe('0')
  })

  it('typing scientific-notation that resolves to the cap preserves the typed string', async () => {
    // Counterexample to the clamp bug: `1e2` parses to 100. The post-cast
    // domValue (100) equals storage (100), so no force-sync should trigger.
    // The user gets to keep typing the scientific-notation form mid-edit;
    // blur normalizes it.
    const schema = z.object({ bounded: z.number() })
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { bounded: 0 },
          key: `clamp-sci-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rv = api.register('bounded', { transforms: [clamp0to100] })
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'number', 'data-field': 'bounded' }), [
              [vRegister, rv],
            ]),
          ])
      },
    })
    app = createApp(Parent).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const input = root.querySelector('[data-field="bounded"]') as HTMLInputElement
    if (input === null) throw new Error('input not rendered')
    input.focus()

    // First type a different value so storage diverges from 100. Then
    // type "1e2" — `looseToNumber` produces 100, the clamp keeps 100,
    // storage updates from 50 → 100. The post-cast domValue (100) ===
    // storage (100), so the typed form "1e2" is preserved in the DOM.
    input.value = '50'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(handle.api?.values.bounded).toBe(50)
    expect(input.value).toBe('50')

    input.value = '1e2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(handle.api?.values.bounded).toBe(100)
    // The typed form "1e2" stays in the DOM mid-typing — the typed-form
    // preservation contract.
    expect(input.value).toBe('1e2')
  })
})
