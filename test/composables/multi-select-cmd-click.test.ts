// @vitest-environment jsdom
//
// Repro for spike 16h: `<select multiple v-register>` Cmd+click flow.
//
// Scenario:
//   - Default value `['red', 'blue']` — red and blue selected on mount.
//   - User Cmd+clicks (Mac) / Ctrl+clicks (Win) Green to add it.
//   - Form correctly updates to `['red', 'green', 'blue']`.
//   - DOM should now show red, green, blue all selected.
//
// The unit-level tests in `test/core/directive-modifiers.test.ts` cover
// the change-handler write path AND the `updated`-hook re-sync path
// independently, but neither covers the full reactive cycle that fires
// when a user interaction lands. This test exercises that combined
// flow against a real `useForm` + Vue app.
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createAttaform } from '../../src/runtime/core/plugin'

const schema = z.object({
  colors: z.array(z.string()),
  // Sibling field — typed-into after the select interaction to force
  // an additional reactive re-render across the form, exercising the
  // select directive's `updated` hook with `_assigning === false`.
  note: z.string(),
})

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('<select multiple v-register> — Cmd+click adds selection', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('after Cmd+click on a third option, DOM shows all three selected (matches model)', async () => {
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { colors: ['red', 'blue'], note: '' },
          key: `multi-cmd-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rvColors = api.register('colors')
        const rvNote = api.register('note')
        return () =>
          h('div', null, [
            withDirectives(
              h('select', { multiple: true, size: 4 }, [
                h('option', { value: 'red' }, 'Red'),
                h('option', { value: 'green' }, 'Green'),
                h('option', { value: 'blue' }, 'Blue'),
                h('option', { value: 'yellow' }, 'Yellow'),
              ]),
              [[vRegister, rvColors]]
            ),
            withDirectives(h('input', { type: 'text', 'data-field': 'note' }), [
              [vRegister, rvNote],
            ]),
            // JSON readout — same pattern as the spike. Reactively
            // re-renders on every keystroke or selection change.
            h('pre', null, JSON.stringify(api.values.colors)),
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (handle.api === undefined) throw new Error('api never set')

    const select = root.querySelector('select') as HTMLSelectElement
    const [red, green, blue, yellow] = Array.from(select.options) as [
      HTMLOptionElement,
      HTMLOptionElement,
      HTMLOptionElement,
      HTMLOptionElement,
    ]

    // Mount-time DOM reflects the default model.
    expect(red.selected).toBe(true)
    expect(green.selected).toBe(false)
    expect(blue.selected).toBe(true)
    expect(yellow.selected).toBe(false)

    // User Cmd+clicks Green. In a multi-select, Cmd+click toggles the
    // individual option without touching the others — the resulting
    // DOM state is "red + green + blue selected, yellow not". JSDOM
    // doesn't model the modifier key; we mimic the post-click DOM
    // state by directly flipping `green.selected` while leaving red/blue
    // selected, then dispatch the same `change` event the browser would.
    green.selected = true
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()

    // Form state landed correctly.
    expect(handle.api.values.colors).toEqual(['red', 'green', 'blue'])

    // DOM must still reflect the model — nothing should have stripped
    // the `selected` attribute from any of the three.
    expect(red.selected).toBe(true)
    expect(green.selected).toBe(true)
    expect(blue.selected).toBe(true)
    expect(yellow.selected).toBe(false)

    // Now exercise the post-`_assigning`-cleared path: type into the
    // sibling `note` input. This triggers a fresh component update
    // with `_assigning === false`, so the directive's `updated` hook
    // calls `setSelected` against the current model. The DOM must
    // remain in sync with `['red', 'green', 'blue']`.
    const note = root.querySelector('[data-field="note"]') as HTMLInputElement
    note.value = 'a'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(red.selected).toBe(true)
    expect(green.selected).toBe(true)
    expect(blue.selected).toBe(true)
    expect(yellow.selected).toBe(false)
  })

  it('a sibling re-render between mousedown and change MUST NOT clobber the user-selected option', async () => {
    // Real-world repro for spike 16h. When the user Cmd+clicks an
    // option in `<select multiple>`, the browser sets the new
    // `option.selected = true` on mousedown but waits until after the
    // click sequence to fire `change`. If anything else on the page
    // queues a Vue re-render between the user's mousedown and the
    // browser's change-event decision (a typed character in a sibling,
    // a periodic timer, the asyncForm validation tick, etc.), the
    // directive's `updated` hook fires with `_assigning === false`. If
    // that hook unconditionally re-applies `setSelected` against the
    // (still-unchanged) model, it RESETS the option the user just
    // toggled — the browser then sees no net selection change, doesn't
    // fire `change`, and the model never updates.
    //
    // The bug surfaces only when the model is genuinely identity-
    // unchanged across the click sequence (no write yet) AND a
    // sibling triggers a re-render in that window. The fix: skip
    // `setSelected` from `updated` when the model hasn't changed since
    // the last application — mirroring the spirit of `setChecked`'s
    // `originalValue === oldValue` short-circuit.
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { colors: ['red', 'blue'], note: '' },
          key: `multi-cmd-mid-click-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rvColors = api.register('colors')
        const rvNote = api.register('note')
        return () =>
          h('div', null, [
            withDirectives(
              h('select', { multiple: true, size: 4 }, [
                h('option', { value: 'red' }, 'Red'),
                h('option', { value: 'green' }, 'Green'),
                h('option', { value: 'blue' }, 'Blue'),
                h('option', { value: 'yellow' }, 'Yellow'),
              ]),
              [[vRegister, rvColors]]
            ),
            withDirectives(h('input', { type: 'text', 'data-field': 'note' }), [
              [vRegister, rvNote],
            ]),
            // Reactive read of `colors` — re-renders the parent on
            // every mutation, including model writes from the change
            // handler. Mirrors the JSON readout used in the spike.
            h('pre', null, JSON.stringify(api.values.colors)),
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (handle.api === undefined) throw new Error('api never set')

    const select = root.querySelector('select') as HTMLSelectElement
    const note = root.querySelector('[data-field="note"]') as HTMLInputElement
    const [red, green, blue, yellow] = Array.from(select.options) as [
      HTMLOptionElement,
      HTMLOptionElement,
      HTMLOptionElement,
      HTMLOptionElement,
    ]

    // Step 1: simulate the browser's native `mousedown` handling — the
    // user Cmd+clicked Green, browser added it to the selection. DOM
    // now has red+green+blue selected; model is still ['red','blue']
    // (change has NOT fired yet).
    green.selected = true
    expect(green.selected).toBe(true)
    expect(handle.api.values.colors).toEqual(['red', 'blue'])

    // Step 2: a SIBLING reactive write fires before the browser's
    // change-event decision. Typing one character into the `note`
    // input replaces `form.value` (note's path is updated), which
    // queues a parent re-render. The microtask flush runs the
    // directive's `updated` hook on the select.
    //
    // EXPECTATION: the directive must NOT re-apply `setSelected` from
    // a stale model — `green.selected` must remain `true` so the
    // browser's subsequent `change` event sees a real selection
    // change and writes ['red','green','blue'] to the model.
    note.value = 'x'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(green.selected).toBe(true) // ← the regression guard
    expect(red.selected).toBe(true)
    expect(blue.selected).toBe(true)
    expect(yellow.selected).toBe(false)

    // Step 3: now fire the change event the browser would have fired,
    // confirming the full flow lands the model where the user expects.
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()

    expect(handle.api.values.colors).toEqual(['red', 'green', 'blue'])
    expect(red.selected).toBe(true)
    expect(green.selected).toBe(true)
    expect(blue.selected).toBe(true)
    expect(yellow.selected).toBe(false)
  })
})
