// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { unset, useForm } from '../../src/zod'
import { canonicalizePath } from '../../src/runtime/core/paths'
import { vRegister } from '../../src/runtime/core/directive'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * The contract under test: when a `number` leaf is in `blankPaths`,
 * the bound `<input type="number" v-register.number>` must DISPLAY as
 * empty (`el.value === ''`) regardless of which DOM events have just
 * fired. Storage holding the slim default `0` is the storage-side
 * truth; the UI side has to honour `displayValue === ''` whenever
 * `blank === true` — that's the whole point of the unset/blank
 * side-channel.
 *
 * The bug repro on the homepage REPL: open Step 2, switch to
 * Oversized, click into Length (cm), click out. The field reverts
 * from `''` to `'0'` — the change handler's blur normalizer runs
 * `looseToNumber('')` which returns `''` (NaN passthrough); falls
 * into the "uncastable mid-edit residue" branch which DOES re-mark
 * blank — but only when `validity.badInput` is false. jsdom's
 * `<input type="number">` doesn't track `validity.badInput`
 * accurately, so the test environment exercises the same path the
 * real browser hits when the input is empty.
 */

const numericLeafSchema = z.object({
  lengthCm: z.number().positive(),
})

function flushAll(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

function mountNumericInput() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const App = defineComponent({
    setup() {
      const form = useForm({
        schema: numericLeafSchema,
        key: `blur-blank-${Math.random().toString(36).slice(2)}`,
        defaultValues: { lengthCm: unset },
      })
      return () =>
        withDirectives(
          h('input', {
            type: 'number',
            'data-test': 'lengthCm',
          }),
          [
            [
              vRegister,
              form.register('lengthCm'),
              undefined,
              { number: true } as unknown as Record<string, true>,
            ],
          ]
        )
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  app.mount(root)
  return { app, root }
}

describe('blank-marked number leaf — blur preserves empty display', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    document.body.innerHTML = ''
  })

  it('starts displayed empty when the schema default is auto-unset', async () => {
    const { app } = mountNumericInput()
    apps.push(app)
    await flushAll()
    const input = document.querySelector('input[data-test="lengthCm"]') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('focus + blur with no typing keeps the field blank and empty', async () => {
    const { app } = mountNumericInput()
    apps.push(app)
    await flushAll()
    const input = document.querySelector('input[data-test="lengthCm"]') as HTMLInputElement
    // Sanity: starts blank.
    expect(input.value).toBe('')

    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    await flushAll()
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    await flushAll()

    // Bug repro: this assertion fails today because the change
    // handler's blur normalizer paints `'0'` over the empty DOM.
    expect(input.value).toBe('')
  })

  it('type then clear then blur stays blank and empty', async () => {
    const { app } = mountNumericInput()
    apps.push(app)
    await flushAll()
    const input = document.querySelector('input[data-test="lengthCm"]') as HTMLInputElement

    input.value = '5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAll()
    expect(input.value).toBe('5')

    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAll()
    expect(input.value).toBe('')

    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    await flushAll()

    // After clear+blur, storage is the slim default (0) but the path
    // is in blankPaths — display must stay ''.
    expect(input.value).toBe('')
  })
})

describe('blank-marked number leaf — blank flag survives blur', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    document.body.innerHTML = ''
  })

  it('blankPaths still contains the leaf after focus + blur', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    let captured: ReturnType<typeof useForm<typeof numericLeafSchema>> | undefined
    const App = defineComponent({
      setup() {
        const form = useForm({
          schema: numericLeafSchema,
          key: `blur-blank-flag-${Math.random().toString(36).slice(2)}`,
          defaultValues: { lengthCm: unset },
        })
        captured = form
        return () =>
          withDirectives(
            h('input', {
              type: 'number',
              'data-test': 'lengthCm',
            }),
            [
              [
                vRegister,
                form.register('lengthCm'),
                undefined,
                { number: true } as unknown as Record<string, true>,
              ],
            ]
          )
      },
    })
    const app = createApp(App).use(createAttaform({ override: true }))
    apps.push(app)
    app.mount(root)
    await flushAll()
    if (captured === undefined) throw new Error('form not captured')

    const lengthKey = canonicalizePath('lengthCm').key
    expect(captured.blankPaths.value.has(lengthKey)).toBe(true)

    const input = document.querySelector('input[data-test="lengthCm"]') as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    await flushAll()
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    await flushAll()

    // The flag must still be set — a focus + blur with no typing
    // must not unmark a deliberately-blank field.
    expect(captured.blankPaths.value.has(lengthKey)).toBe(true)
  })
})
