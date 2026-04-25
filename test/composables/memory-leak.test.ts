// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { useForm } from '../../src'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Regression coverage for Phase 8.1 — registry cleanup on scope dispose.
 *
 * The pre-fix runtime stored every form in `registry.forms` on mount but
 * never removed it. A long-lived SPA that mounts and unmounts form-heavy
 * pages would accumulate detached FormStore instances (each holding a
 * reactive `form` ref, an `originals` Map, an `errors` Map, and field
 * records) for the lifetime of the app.
 *
 * Fix: `useForm` now pairs `registry.trackConsumer(key)` with an
 * `onScopeDispose` release. The registry evicts the FormStore once the
 * last consumer disposes. These tests assert the two invariants:
 *   1. Sole consumer unmounts → entry is gone.
 *   2. Multiple consumers share a key → only the last unmount clears it.
 */

type Form = { name: string }

function mountProbe(registry: ReturnType<typeof createRegistry>, key: string) {
  const Probe = defineComponent({
    setup() {
      useForm<Form>({
        schema: fakeSchema<Form>({ name: '' }),
        key,
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  attachRegistryToApp(app, registry)
  app.mount(document.createElement('div'))
  return app
}

describe('useForm — registry cleanup on scope dispose', () => {
  it('releases the FormStore when the sole consumer unmounts', () => {
    const registry = createRegistry()
    const app = mountProbe(registry, 'gc-solo')

    expect(registry.forms.has('gc-solo')).toBe(true)
    app.unmount()
    expect(registry.forms.has('gc-solo')).toBe(false)
  })

  it('ref-counts shared-key consumers — only the last unmount evicts', () => {
    const registry = createRegistry()
    const app1 = mountProbe(registry, 'gc-shared')
    const app2 = mountProbe(registry, 'gc-shared')

    expect(registry.forms.has('gc-shared')).toBe(true)

    app1.unmount()
    // Second consumer still active; the FormStore must stay reachable so
    // reactive subscriptions in app2 keep working.
    expect(registry.forms.has('gc-shared')).toBe(true)

    app2.unmount()
    expect(registry.forms.has('gc-shared')).toBe(false)
  })

  it('after full eviction, a remount rebuilds fresh state (no stale carry-over)', () => {
    const registry = createRegistry()
    const app = mountProbe(registry, 'gc-remount')
    const firstState = registry.forms.get('gc-remount')
    expect(firstState).toBeDefined()
    app.unmount()
    expect(registry.forms.has('gc-remount')).toBe(false)

    const app2 = mountProbe(registry, 'gc-remount')
    const secondState = registry.forms.get('gc-remount')
    expect(secondState).toBeDefined()
    // Identity check: the new mount created a NEW FormStore, not reused
    // the evicted one. Confirms the eviction + rebuild path is wired.
    expect(secondState).not.toBe(firstState)
    app2.unmount()
  })
})
