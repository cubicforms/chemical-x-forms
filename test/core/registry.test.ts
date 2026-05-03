// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { defineComponent, h, createApp } from 'vue'
import { OutsideSetupError, RegistryNotInstalledError } from '../../src/runtime/core/errors'
import {
  attachRegistryToApp,
  createRegistry,
  getRegistryFromApp,
  useRegistry,
} from '../../src/runtime/core/registry'

describe('createRegistry', () => {
  it('produces isolated state per call (SSR multi-tenant safety)', () => {
    // This matters for SSR: one module, many requests. Different registries
    // must not share mutable state.
    const a = createRegistry()
    const b = createRegistry()
    expect(a).not.toBe(b)
    expect(a.forms).not.toBe(b.forms)
    // Two separate maps: writing to one cannot be observable on the other.
    // (We don't actually need to write a real FormStore for this check; Map
    // identity comparison is enough.)
    expect(a.pendingHydration).not.toBe(b.pendingHydration)
  })

  it('captures the SSR flag from options', () => {
    expect(createRegistry({ override: true }).isSSR).toBe(true)
    expect(createRegistry({ override: false }).isSSR).toBe(false)
  })

  it('initialises forms + pendingHydration as empty Maps', () => {
    const r = createRegistry()
    expect(r.forms.size).toBe(0)
    expect(r.pendingHydration.size).toBe(0)
  })
})

describe('useRegistry', () => {
  it('throws OutsideSetupError when called outside a Vue setup context', () => {
    // No `getCurrentInstance()` on the active call stack — typical when
    // a consumer (mistakenly) calls useForm / injectForm from a
    // click handler, watcher, or async callback after mount.
    expect(() => useRegistry()).toThrow(OutsideSetupError)
  })

  it('throws RegistryNotInstalledError when called inside setup but no plugin attached', () => {
    // Inside setup, `getCurrentInstance()` resolves — but the `inject`
    // for `kDecantRegistry` returns null because `app.use(...)` was
    // never called. Different cause, different fix from the case above.
    let captured: unknown
    const Probe = defineComponent({
      setup() {
        try {
          useRegistry()
        } catch (err) {
          captured = err
        }
        return () => h('div')
      },
    })
    const app = createApp(Probe)
    // Note: NO attachRegistryToApp call — that's the point of the test.
    const host = document.createElement('div')
    app.mount(host)
    expect(captured).toBeInstanceOf(RegistryNotInstalledError)
    app.unmount()
  })

  it('OutsideSetupError and RegistryNotInstalledError are distinct types', () => {
    // Sanity: each error is instance-checkable separately. Consumers
    // that want different recovery for each cause can `instanceof` test.
    const outside = new OutsideSetupError()
    const missing = new RegistryNotInstalledError()
    expect(outside).toBeInstanceOf(OutsideSetupError)
    expect(outside).not.toBeInstanceOf(RegistryNotInstalledError)
    expect(missing).toBeInstanceOf(RegistryNotInstalledError)
    expect(missing).not.toBeInstanceOf(OutsideSetupError)
  })

  it('returns the attached registry when called inside setup()', () => {
    const registry = createRegistry()
    let resolved: ReturnType<typeof useRegistry> | undefined
    const Probe = defineComponent({
      setup() {
        resolved = useRegistry()
        return () => h('div')
      },
    })
    const app = createApp(Probe)
    attachRegistryToApp(app, registry)
    const host = document.createElement('div')
    app.mount(host)
    expect(resolved).toBe(registry)
    app.unmount()
  })
})

describe('getRegistryFromApp / attachRegistryToApp', () => {
  it('round-trips via the app._decant escape hatch', () => {
    const registry = createRegistry()
    const app = createApp({ render: () => null })
    attachRegistryToApp(app, registry)
    expect(getRegistryFromApp(app)).toBe(registry)
  })

  it('getRegistryFromApp throws when no plugin was installed', () => {
    const app = createApp({ render: () => null })
    expect(() => getRegistryFromApp(app)).toThrow(RegistryNotInstalledError)
  })

  it('two apps hold their own registries without cross-talk', () => {
    const app1 = createApp({ render: () => null })
    const app2 = createApp({ render: () => null })
    const registry1 = createRegistry()
    const registry2 = createRegistry()
    attachRegistryToApp(app1, registry1)
    attachRegistryToApp(app2, registry2)
    expect(getRegistryFromApp(app1)).toBe(registry1)
    expect(getRegistryFromApp(app2)).toBe(registry2)
    expect(getRegistryFromApp(app1)).not.toBe(getRegistryFromApp(app2))
  })
})
