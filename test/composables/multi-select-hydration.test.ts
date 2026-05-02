// @vitest-environment jsdom
//
// Hydration repro for spike-cx 16h's "starting visual state is incorrect"
// regression. The client-side mount test in `multi-select-cmd-click.test.ts`
// passes — but the user's bug is in a Nuxt-rendered (SSR + hydration)
// app, where after mount `option.selected` is `false` on every option
// despite the model containing `['red', 'blue']`. Snapshot also showed
// `hasAttribute('selected') === true` for red/blue, so the SSR HTML
// somehow carries those attributes — yet the IDL state is false.
//
// This test runs the same SSR → hydrate flow inside jsdom to find out
// where in the lifecycle the selectedness gets lost.
import { afterEach, describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createDecant } from '../../src/runtime/core/plugin'

const schema = z.object({ colors: z.array(z.string()) })

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

const Parent = defineComponent({
  setup() {
    const api = useForm({
      schema,
      defaultValues: { colors: ['red', 'blue'] },
      key: `multi-hydration-${Math.random().toString(36).slice(2)}`,
    })
    const rv = api.register('colors')
    return () =>
      withDirectives(
        h('select', { multiple: true, size: 4 }, [
          h('option', { value: 'red' }, 'Red'),
          h('option', { value: 'green' }, 'Green'),
          h('option', { value: 'blue' }, 'Blue'),
          h('option', { value: 'yellow' }, 'Yellow'),
        ]),
        [[vRegister, rv]]
      )
  },
})

describe('<select multiple v-register> — SSR + hydration', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('SSR HTML output for the select', async () => {
    const ssrApp = createSSRApp(Parent).use(createDecant({ override: true }))
    const html = await renderToString(ssrApp)
    // Surface the SSR HTML so we can see what attributes (if any) the
    // server emits on options. The user's browser snapshot showed
    // `hasAttribute('selected') === true` for red/blue, so the SSR side
    // is the prime suspect for emitting those attrs.
    // eslint-disable-next-line no-console
    console.log('SSR HTML:', html)
    expect(html).toContain('<select')
    expect(html).toContain('value="red"')
  })

  it('after hydration, red and blue options have selected=true on the IDL property', async () => {
    // SSR pass.
    const ssrApp = createSSRApp(Parent).use(createDecant({ override: true }))
    const html = await renderToString(ssrApp)

    // Plant the SSR HTML in the document so the client can hydrate it.
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.innerHTML = html

    // Pre-hydration state — what the browser parsed from the SSR HTML.
    const select = root.querySelector('select') as HTMLSelectElement | null
    if (select === null) throw new Error('select missing from SSR HTML')
    const preHydration = Array.from(select.options).map((o) => ({
      value: o.value,
      selected: o.selected,
      hasAttr: o.hasAttribute('selected'),
    }))
    // eslint-disable-next-line no-console
    console.log('pre-hydration option state:', preHydration)

    // Client hydration. createSSRApp + mount on the populated container
    // performs hydration (vs createApp + mount which does a fresh render).
    app = createSSRApp(Parent).use(createDecant())
    app.mount(root)
    await flush()

    const postHydration = Array.from(select.options).map((o) => ({
      value: o.value,
      selected: o.selected,
      hasAttr: o.hasAttribute('selected'),
    }))
    // eslint-disable-next-line no-console
    console.log('post-hydration option state:', postHydration)

    // The model is ['red', 'blue']; the directive's mounted hook should
    // have applied that to the DOM. red and blue must be selected.
    expect(postHydration[0]?.selected).toBe(true) // red
    expect(postHydration[1]?.selected).toBe(false) // green
    expect(postHydration[2]?.selected).toBe(true) // blue
    expect(postHydration[3]?.selected).toBe(false) // yellow
  })
})
