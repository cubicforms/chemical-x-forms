// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createDecant } from '../../src/runtime/core/plugin'

/**
 * `<select v-register>` against a `z.enum(...)` schema with an
 * `<option>` whose value isn't a member of the enum.
 *
 * Contract: writes must satisfy the **slim primitive type** at the
 * path. `z.enum(['red','green','blue'])`'s slim primitive is
 * `string`, so any string write is accepted — enum-membership is a
 * refinement-level concern, surfaced by field-level validation.
 *
 * The bug from cubic-forms spike-15d is therefore a
 * refinement-validation visibility issue, NOT a write-acceptance
 * issue. The form correctly stores `'magenta'`; what's missing
 * (covered elsewhere) is the field error surfacing immediately.
 *
 * The hard line is on PRIMITIVE-type mismatches: a number written
 * to a string-slim field is rejected, since it can't possibly
 * satisfy any refinement of the slim type.
 */

const schema = z.object({ color: z.enum(['red', 'green', 'blue']) })

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('<select v-register> with out-of-enum option', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('selecting an out-of-enum option writes the string value (slim-type match)', async () => {
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'select-out-of-enum-test',
          strict: false,
        })
        captured.api = form
        return () =>
          withDirectives(
            h('select', { class: 'colors' }, [
              h('option', { value: 'red' }, 'Red'),
              h('option', { value: 'green' }, 'Green'),
              h('option', { value: 'blue' }, 'Blue'),
              // Out-of-enum option, injected by a wrapper SFC. The
              // primitive type is still `string` — the slim schema
              // for `z.enum(['red','green','blue'])` is `string`,
              // so this write is accepted.
              h('option', { value: 'magenta' }, 'Magenta'),
            ]),
            [[vRegister, form.register('color')]]
          )
      },
    })

    app = createApp(Parent).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')

    const before = captured.api.values.color
    expect(['red', 'green', 'blue']).toContain(before)

    const select = root.querySelector('select.colors') as HTMLSelectElement | null
    if (select === null) throw new Error('unreachable')

    select.value = 'magenta'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()

    // Slim-type contract: 'magenta' is a string → accepted.
    expect(captured.api.values.color).toBe('magenta')
  })

  it('programmatic setValue with a wrong-primitive-type value is REJECTED + dev-warned', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        captured.api = useForm({
          schema,
          key: 'select-out-of-enum-setvalue-wrongprim',
          strict: false,
        })
        return () => h('div')
      },
    })

    app = createApp(Parent).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')

    const before = captured.api.values.color
    expect(['red', 'green', 'blue']).toContain(before)

    // `1` is a number — slim primitive at `color` is `string`. Cast
    // through unknown to simulate a runtime type-system bypass
    // (server payload, JSON, etc.).
    const ok = (captured.api.setValue as (path: 'color', value: unknown) => boolean)('color', 1)
    await flush()

    // Rejection contract: returns false, value at path unchanged,
    // dev-warn fires once with the path + value.
    expect(ok).toBe(false)
    expect(captured.api.values.color).toBe(before)
    expect(warnSpy).toHaveBeenCalled()
    const message = warnSpy.mock.calls.flat().join(' ')
    expect(message).toMatch(/color/)

    warnSpy.mockRestore()
  })

  it('programmatic setValue with a wrong-enum-member writes (string slim accepted)', async () => {
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}

    const Parent = defineComponent({
      setup() {
        captured.api = useForm({
          schema,
          key: 'select-out-of-enum-setvalue-magenta',
          strict: false,
        })
        return () => h('div')
      },
    })

    app = createApp(Parent).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')

    const ok = (captured.api.setValue as (path: 'color', value: unknown) => boolean)(
      'color',
      'magenta'
    )
    await flush()

    expect(ok).toBe(true)
    expect(captured.api.values.color).toBe('magenta')
  })
})
