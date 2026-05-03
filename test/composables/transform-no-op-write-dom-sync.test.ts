// @vitest-environment jsdom
//
// Regression: the "no-op write strands the DOM" bug class —
// originally surfaced by the spike's clamp transform on a numeric
// text input — applies identically to checkbox, radio, and select
// variants. Shape: the change handler runs the assigner, the
// assigner's transform mutates the write to a value identical to
// current storage, no patch fires, no Vue re-render, and the
// directive's render-driven el-state sync (`setChecked`,
// `setSelected`) doesn't run. Without the post-assigner imperative
// force-sync added to each variant's change handler, the DOM kept
// the user's clicked / selected state divorced from storage.
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

describe('no-op-write DOM-sync bug class — probes for non-text directives', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('checkbox — transform that forces `false` strands a checked DOM checkbox', async () => {
    // Schema: a single boolean checkbox. Transform always returns
    // false. Storage starts at false. User clicks the checkbox →
    // browser sets el.checked = true → change event fires → assigner
    // runs the transform (forces false) → setValue(false) → storage
    // stays at false (no patch) → no render → setChecked doesn't fire
    // → DOM checkbox stays visibly checked, divorced from storage.
    const schema = z.object({ agreed: z.boolean() })
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { agreed: false },
          key: `cb-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rv = api.register('agreed', { transforms: [() => false] })
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'checkbox', 'data-field': 'agreed' }), [
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

    const input = root.querySelector('[data-field="agreed"]') as HTMLInputElement
    if (input === null) throw new Error('checkbox not rendered')
    expect(input.checked).toBe(false)
    expect(handle.api?.values.agreed).toBe(false)

    input.checked = true
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(handle.api?.values.agreed).toBe(false)
    expect(input.checked).toBe(false)
  })

  it('select-single — transform that forces a fixed value strands a different option', async () => {
    // Storage starts at 'a'. Transform always returns 'a'. User picks
    // 'b' from the select → assigner forces 'a' → setValue('a') →
    // storage stays 'a' (no patch, no render) → setSelected doesn't
    // fire to revert → DOM <select> stays on 'b', diverged.
    const schema = z.object({ pick: z.enum(['a', 'b', 'c']) })
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema,
          defaultValues: { pick: 'a' },
          key: `sel-${Math.random().toString(36).slice(2)}`,
        })
        handle.api = api
        const rv = api.register('pick', { transforms: [() => 'a'] })
        return () =>
          h('div', null, [
            withDirectives(
              h('select', { 'data-field': 'pick' }, [
                h('option', { value: 'a' }, 'a'),
                h('option', { value: 'b' }, 'b'),
                h('option', { value: 'c' }, 'c'),
              ]),
              [[vRegister, rv]]
            ),
          ])
      },
    })
    app = createApp(Parent).use(createDecant())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const select = root.querySelector('[data-field="pick"]') as HTMLSelectElement
    if (select === null) throw new Error('select not rendered')
    expect(select.value).toBe('a')
    expect(handle.api?.values.pick).toBe('a')

    select.value = 'b'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(handle.api?.values.pick).toBe('a')
    expect(select.value).toBe('a')
  })
})
