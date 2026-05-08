// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, createApp, type App } from 'vue'
import { z } from 'zod'

import { useForm } from '../../src/zod'
import { injectForm } from '../../src/runtime/composables/use-form-context'
import { useRegister } from '../../src/runtime/composables/use-register'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Coverage for the lazy-install path: `useForm`, `injectForm`, and
 * `useRegister` should each ensure the registry is attached on first
 * use, so consumers don't need to call `app.use(createAttaform())`
 * for the common CSR case.
 *
 * Each test creates a fresh app to keep the per-app `_attaform` slot
 * isolated.
 */

const mountedHosts: HTMLElement[] = []
const mountedApps: App[] = []

function mountWithSetup(setup: () => unknown): { app: App; host: HTMLElement } {
  const Probe = defineComponent({
    setup,
    render: () => h('div'),
  })
  const app = createApp(Probe)
  const host = document.createElement('div')
  app.mount(host)
  mountedHosts.push(host)
  mountedApps.push(app)
  return { app, host }
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  for (const host of mountedHosts.splice(0)) host.remove()
})

describe('useForm — lazy install', () => {
  it('attaches the registry on first call without an explicit createAttaform()', () => {
    const { app } = mountWithSetup(() => {
      useForm({
        schema: z.object({ email: z.string() }),
        key: 'lazy-useform',
      })
    })

    expect(app._attaform).toBeDefined()
    expect(app._attaform?.forms.has('lazy-useform')).toBe(true)
  })

  it('does not double-install when createAttaform() ran first (defaults preserved)', () => {
    const Probe = defineComponent({
      setup() {
        useForm({
          schema: z.object({ email: z.string() }),
          key: 'lazy-defaults',
        })
        return () => h('div')
      },
    })
    const app = createApp(Probe)
    app.use(createAttaform({ defaults: { debounceMs: 250 } }))
    const host = document.createElement('div')
    app.mount(host)
    mountedHosts.push(host)
    mountedApps.push(app)

    // Defaults flow through — the explicit install ran first, the lazy
    // path is a no-op, the registry's defaults reflect the explicit
    // install's options.
    expect(app._attaform?.defaults.debounceMs).toBe(250)
  })
})

describe('injectForm — lazy install', () => {
  it('returns null with a dev warning when called as the first attaform call (no useForm ancestor)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let resolved: unknown = 'not-set'
    const { app } = mountWithSetup(() => {
      // No useForm ancestor anywhere, no createAttaform() — pre-fix
      // this would throw RegistryNotInstalledError. Post-fix: lazy
      // install attaches the registry, the lookup misses, the warn
      // path fires, and injectForm returns null.
      resolved = injectForm('nonexistent')
    })

    expect(resolved).toBeNull()
    expect(app._attaform).toBeDefined()
    expect(warn).toHaveBeenCalled()
    const firstCall = warn.mock.calls[0] ?? []
    const message = (firstCall[0] ?? '') as string
    expect(message).toContain('injectForm')
    expect(message).toContain('nonexistent')
    warn.mockRestore()
  })

  it('returns null with a dev warning when called for an ambient form with no ancestor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let resolved: unknown = 'not-set'
    const { app } = mountWithSetup(() => {
      resolved = injectForm()
    })

    expect(resolved).toBeNull()
    expect(app._attaform).toBeDefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('useRegister — lazy install', () => {
  it('attaches the registry (and registers the v-register directive) on first call', () => {
    const { app } = mountWithSetup(() => {
      useRegister()
    })

    expect(app._attaform).toBeDefined()
    // Vue keeps directives on `app._context.directives`. The lazy
    // install path's `app.directive('register', vRegister)` populates
    // it; we assert by name to avoid a hard dep on an internal
    // shape.
    const directives = (app._context as unknown as { directives: Record<string, unknown> })
      .directives
    expect(directives['register']).toBeDefined()
  })
})
