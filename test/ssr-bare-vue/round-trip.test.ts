import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { useAbstractForm } from '../../src/runtime/composables/use-abstract-form'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { getRegistryFromApp } from '../../src/runtime/core/registry'
import { hydrateChemicalXState, renderChemicalXState } from '../../src/runtime/core/serialize'
import { fakeSchema } from '../utils/fake-schema'

/*
 * End-to-end proof that `@chemical-x/forms` works under bare Vue 3 + SSR
 * via `@vue/server-renderer` — no Nuxt involved. Exercises the full round
 * trip: server creates app, useForm sets some state, render HTML,
 * serialize, hydrate on a fresh "client" app, confirm the reconstructed
 * state matches.
 *
 * Companion to test/core/serialize.test.ts — that file covers the
 * serialize helpers in isolation; this file proves they compose with
 * @vue/server-renderer's real rendering pipeline.
 */

type Form = { email: string; password: string }

function makeApp(opts: { ssr: boolean; initialEmail?: string }) {
  const App = defineComponent({
    setup() {
      const form = useAbstractForm<Form>({
        schema: fakeSchema<Form>({ email: opts.initialEmail ?? '', password: '' }),
        key: 'signup',
      })
      const emailRef = form.getValue('email')
      return () => h('div', { id: 'root' }, [h('span', { id: 'email' }, String(emailRef.value))])
    },
  })
  const app = createSSRApp(App)
  app.use(createChemicalXForms({ override: opts.ssr }))
  return app
}

describe('bare-Vue SSR round-trip', () => {
  it('renders HTML via @vue/server-renderer (no Nuxt)', async () => {
    const app = makeApp({ ssr: true, initialEmail: 'seeded@server' })
    const html = await renderToString(app)
    expect(html).toContain('seeded@server')
  })

  it('server-side form state survives serialization → hydration → new app', async () => {
    // Server
    const serverApp = makeApp({ ssr: true, initialEmail: 'alice@server' })
    await renderToString(serverApp)
    const serverRegistry = getRegistryFromApp(serverApp)
    const state = serverRegistry.forms.get('signup')
    expect(state).toBeDefined()
    if (state === undefined) return
    state.setValueAtPath(['email'], 'server-edited@x')

    // Serialize
    const payload = renderChemicalXState(serverApp)
    const serialised = JSON.stringify(payload)

    // Client: fresh app, fresh registry, hydrate from payload
    const clientApp = makeApp({ ssr: false })
    hydrateChemicalXState(
      clientApp,
      JSON.parse(serialised) as ReturnType<typeof renderChemicalXState>
    )

    // Render the client app — during setup, useForm should pick up the
    // hydrated state rather than re-initialising from schema defaults.
    const clientHtml = await renderToString(clientApp)
    expect(clientHtml).toContain('server-edited@x')
  })

  it('two separate apps in the same process do not share form state', async () => {
    // Multi-tenant SSR regression check.
    const app1 = makeApp({ ssr: true, initialEmail: 'tenant-a@x' })
    const app2 = makeApp({ ssr: true, initialEmail: 'tenant-b@x' })
    const html1 = await renderToString(app1)
    const html2 = await renderToString(app2)
    expect(html1).toContain('tenant-a@x')
    expect(html2).toContain('tenant-b@x')
    expect(html1).not.toContain('tenant-b@x')
    expect(html2).not.toContain('tenant-a@x')
  })

  it('serialization payload is JSON-safe for direct transport', async () => {
    const app = makeApp({ ssr: true, initialEmail: 'user@x' })
    await renderToString(app)
    const payload = renderChemicalXState(app)
    // Any attempt to stringify the full payload must succeed; nothing in
    // the structure should carry a symbol, function, or non-serialisable
    // reference.
    expect(() => JSON.stringify(payload)).not.toThrow()
    const restored = JSON.parse(JSON.stringify(payload)) as typeof payload
    expect(restored.forms).toHaveLength(1)
  })
})
