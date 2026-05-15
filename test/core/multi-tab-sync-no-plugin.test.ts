// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, createApp, type App } from 'vue'
import { z } from 'zod'

import { useForm } from '../../src/zod'

/**
 * Integration coverage for multi-tab sync in the no-plugin path.
 *
 * Context: consumers can mount a bare Vue 3 app and call `useForm()`
 * directly without ever running `app.use(createAttaform())`. The
 * library's `ensureAttaformInstalled` (src/runtime/core/plugin.ts) is
 * supposed to lazy-attach the registry on first `useForm` call, and
 * the multi-tab sync module is supposed to wire up off the registry
 * the same way it does under the explicit-plugin path.
 *
 * This file pins that contract: two apps in the same jsdom realm,
 * NEITHER calling `app.use(createAttaform())`, sharing a `key`, MUST
 * exchange patches via `BroadcastChannel`. A regression that gates
 * multi-tab wire-up behind a plugin-only signal would fail here.
 *
 * Why jsdom + Node's native `BroadcastChannel` is enough: Node 15+ has
 * a spec-compliant in-process `BroadcastChannel` that delivers between
 * separate instances with the same name within one realm — same
 * communication model the browser uses across tabs, just collapsed to
 * one process. The lib's gates (`isSecureContext`,
 * `typeof BroadcastChannel !== 'undefined'`) are satisfied with a
 * one-property override on `window`.
 */

const schema = z.object({
  username: z.string(),
  password: z.string(),
  comment: z.string(),
})

/**
 * Narrow projection of the `useForm` return — only the slice the test
 * touches. Avoids the full generic `UseFormReturnType<...>` shape,
 * which TypeScript declines to assign through a non-generic holder
 * type. Cast at capture-time; the cast is local to this file.
 */
type SyncForm = {
  readonly values: {
    readonly username: string
    readonly password: string
    readonly comment: string
  }
  setValue: (path: string, value: unknown) => boolean
}

const ORIGINAL_IS_SECURE_CONTEXT = window.isSecureContext

const mountedApps: App[] = []
const mountedHosts: HTMLElement[] = []

beforeEach(() => {
  // jsdom defaults `window.isSecureContext` to false, which would block
  // the multi-tab gate at use-abstract-form.ts:427-434. The real
  // browser delivers `true` on HTTPS or localhost; treat the test
  // environment as localhost-equivalent.
  Object.defineProperty(window, 'isSecureContext', {
    value: true,
    configurable: true,
  })
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  for (const host of mountedHosts.splice(0)) host.remove()
  Object.defineProperty(window, 'isSecureContext', {
    value: ORIGINAL_IS_SECURE_CONTEXT,
    configurable: true,
  })
})

function mountBareApp(setup: () => unknown): App {
  const Probe = defineComponent({ setup, render: () => h('div') })
  const app = createApp(Probe)
  const host = document.createElement('div')
  app.mount(host)
  mountedApps.push(app)
  mountedHosts.push(host)
  return app
}

/**
 * Wait until both forms' sync modules have transitioned out of the
 * `'joining'` lifecycle. The join handshake's collection window is
 * 50ms by design; we poll a touch longer to absorb timer jitter under
 * load without parking the test on a fixed sleep that may flake.
 */
async function waitForEstablished(apps: ReadonlyArray<App>, timeoutMs = 500): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const allEstablished = apps.every((app) => {
      const registry = app._attaform
      if (registry === undefined) return false
      for (const state of registry.forms.values()) {
        const mod = state.modules.get('multiTabSync') as
          | { lifecycle: () => 'joining' | 'established' }
          | undefined
        if (mod === undefined) return false
        if (mod.lifecycle() !== 'established') return false
      }
      return true
    })
    if (allEstablished) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(
    `Multi-tab sync did not reach 'established' in ${timeoutMs}ms — either the ` +
      `lazy-install path is gated behind the plugin, or the secure-context override ` +
      `did not stick.`
  )
}

/**
 * Wait for an inbound BroadcastChannel message to flush through
 * `handlePatches` and update the receiving form's values. Node's
 * native BroadcastChannel queues message delivery, so a single
 * microtask flush isn't enough — we poll the predicate up to
 * `timeoutMs` to absorb cross-realm scheduler variation.
 */
async function waitFor<T>(predicate: () => T | undefined, timeoutMs = 500): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = predicate()
    if (value !== undefined) return value
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`waitFor: predicate did not become defined within ${timeoutMs}ms`)
}

describe('multi-tab sync — no-plugin lazy-install path', () => {
  it('two bare Vue apps with the same form key exchange non-sensitive patches', async () => {
    const captureA: { form?: SyncForm } = {}
    const captureB: { form?: SyncForm } = {}

    const appA = mountBareApp(() => {
      captureA.form = useForm({
        schema,
        key: 'multitab-shared',
        defaultValues: { username: '', password: '', comment: '' },
      }) as unknown as SyncForm
    })
    const appB = mountBareApp(() => {
      captureB.form = useForm({
        schema,
        key: 'multitab-shared',
        defaultValues: { username: '', password: '', comment: '' },
      }) as unknown as SyncForm
    })

    const formA = captureA.form
    const formB = captureB.form
    if (formA === undefined || formB === undefined) throw new Error('setup did not capture form')

    // Sanity: neither app went through `createAttaform()` — registry
    // attachment is entirely the lazy-install path's doing.
    expect(appA._attaform).toBeDefined()
    expect(appB._attaform).toBeDefined()
    expect(appA._attaform).not.toBe(appB._attaform)

    await waitForEstablished([appA, appB])

    // App A writes a non-sensitive field; sync should propagate.
    formA.setValue('username', 'alice')

    const synced = await waitFor(() =>
      formB.values.username === 'alice' ? formB.values.username : undefined
    )
    expect(synced).toBe('alice')

    // App B writes back; sync should propagate the reverse direction
    // (proves the channel is bidirectional, not one-way).
    formB.setValue('comment', 'hello from B')
    const back = await waitFor(() =>
      formA.values.comment === 'hello from B' ? formA.values.comment : undefined
    )
    expect(back).toBe('hello from B')
  })

  it('sensitive-named paths are filtered from the broadcast (password stays local)', async () => {
    const captureA: { form?: SyncForm } = {}
    const captureB: { form?: SyncForm } = {}

    const appA = mountBareApp(() => {
      captureA.form = useForm({
        schema,
        key: 'multitab-sensitive',
        defaultValues: { username: '', password: '', comment: '' },
      }) as unknown as SyncForm
    })
    const appB = mountBareApp(() => {
      captureB.form = useForm({
        schema,
        key: 'multitab-sensitive',
        defaultValues: { username: '', password: '', comment: '' },
      }) as unknown as SyncForm
    })

    const formA = captureA.form
    const formB = captureB.form
    if (formA === undefined || formB === undefined) throw new Error('setup did not capture form')

    await waitForEstablished([appA, appB])

    // Write to `password` (matches DEFAULT_SENSITIVE_NAMES) AND to
    // `comment` (non-sensitive) in the same batch. The non-sensitive
    // arrival on B is our "the broadcast did fire" signal.
    formA.setValue('password', 'hunter2')
    formA.setValue('comment', 'visible')

    await waitFor(() => (formB.values.comment === 'visible' ? true : undefined))

    // Password did not propagate even though the channel demonstrably
    // worked for `comment` on the same handshake.
    expect(formB.values.password).toBe('')
    // Local-side state still carries the password (the sensitive
    // filter is an outbound/inbound gate, not a local write block).
    expect(formA.values.password).toBe('hunter2')
  })
})
