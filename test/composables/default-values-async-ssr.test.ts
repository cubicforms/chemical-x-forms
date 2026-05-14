// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToString } from '@vue/server-renderer'
import { createApp, createSSRApp, defineComponent, h } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import { hydrateAttaformState, renderAttaformState } from '../../src/runtime/core/serialize'
import { getRegistryFromApp } from '../../src/runtime/core/registry'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'

/**
 * SSR + hydration path for async-defaults forms.
 *
 * On the server, function-form `defaultValues` factories fire via
 * `onServerPrefetch`. The framework's SSR awaiter waits for them to
 * resolve before the payload is serialised, so the resolved values
 * bake into the hydration transfer state. On the client, the matching
 * `useForm({ key })` call consumes `pendingHydration` at construction
 * time AND skips re-firing the factory — same data, no double-fetch.
 *
 * Tests run under @vitest-environment node so `@vue/server-renderer`'s
 * `renderToString` can run.
 */

const schema = z.object({ email: z.string(), name: z.string() })

describe('async-defaults SSR + hydration', () => {
  it('resolves the factory server-side before payload serialization', async () => {
    let calls = 0
    const App = defineComponent({
      setup() {
        useForm({
          schema,
          key: 'ssr-async-defaults',
          defaultValues: () => {
            calls += 1
            return Promise.resolve({ email: 'server@example.com', name: 'Ada' })
          },
        })
        return () => h('div')
      },
    })
    const ssrApp = createSSRApp(App).use(createAttaform({ ssr: true }))
    await renderToString(ssrApp)
    expect(calls).toBe(1)

    const payload = renderAttaformState(ssrApp)
    expect(payload.forms).toHaveLength(1)
    const entry = payload.forms[0]
    expect(entry).toBeDefined()
    if (entry === undefined) return
    const [key, data] = entry
    expect(key).toBe('ssr-async-defaults')
    // Resolved values rode the payload — proves `onServerPrefetch`
    // awaited the factory before serialization.
    expect(data.form).toMatchObject({ email: 'server@example.com', name: 'Ada' })
  })

  it('client consumes pendingHydration and skips re-firing the factory', async () => {
    // Server side: same as above.
    let serverCalls = 0
    const ServerApp = defineComponent({
      setup() {
        useForm({
          schema,
          key: 'ssr-async-no-refire',
          defaultValues: () => {
            serverCalls += 1
            return Promise.resolve({ email: 'server@example.com', name: 'Ada' })
          },
        })
        return () => h('div')
      },
    })
    const ssrApp = createSSRApp(ServerApp).use(createAttaform({ ssr: true }))
    await renderToString(ssrApp)
    const payload = renderAttaformState(ssrApp)
    expect(serverCalls).toBe(1)

    // Client side: fresh app, stage hydration, then mount a form with
    // the same key and async factory. The factory must NOT fire.
    let clientCalls = 0
    const clientHandle: { api?: UseFormReturnType<{ email: string; name: string }> } = {}
    const ClientApp = defineComponent({
      setup() {
        clientHandle.api = useForm({
          schema,
          key: 'ssr-async-no-refire',
          defaultValues: () => {
            clientCalls += 1
            return Promise.resolve({ email: 'client-would-fetch@example.com', name: 'Hopper' })
          },
        }) as unknown as UseFormReturnType<{ email: string; name: string }>
        return () => h('div')
      },
    })
    const clientApp = createApp(ClientApp).use(createAttaform())
    hydrateAttaformState(clientApp, payload)
    const registry = getRegistryFromApp(clientApp)
    expect(registry.pendingHydration.has('ssr-async-no-refire')).toBe(true)
    clientApp.config.warnHandler = () => {}
    clientApp.mount(document.createElement('div'))

    const api = clientHandle.api
    expect(api).toBeDefined()
    if (api === undefined) return
    expect(clientCalls).toBe(0)
    expect(api.isHydrating.value).toBe(false)
    expect(api.values.email).toBe('server@example.com')
    expect(api.values.name).toBe('Ada')
  })
})
