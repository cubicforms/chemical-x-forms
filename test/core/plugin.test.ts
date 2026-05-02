// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { getRegistryFromApp } from '../../src/runtime/core/registry'

describe('createChemicalXForms', () => {
  it('installs a registry on the Vue app', () => {
    const app = createApp({ render: () => null })
    app.use(createChemicalXForms())
    expect(getRegistryFromApp(app)).toBeDefined()
  })

  it('registers the v-register directive on the app', () => {
    const app = createApp({ render: () => null })
    app.use(createChemicalXForms())
    // Vue exposes directive lookup via app._context.directives (stable internal).
    // Mount a throwaway root so _context is populated.
    const host = document.createElement('div')
    app.mount(host)
    // _context is the public-ish AppContext that holds directives/components/mixins.
    // Stable across Vue 3 versions; used here as the most direct lookup.
    const ctx = app._context as unknown as { directives: Record<string, unknown> }
    // A custom directive registers as an object keyed by lifecycle
    // hooks — `created` is mandatory (the v-register variants all
    // implement it). Tightened from `.toBeDefined()`, which would
    // pass for `null` or any plain object.
    expect(ctx.directives['register']).toEqual(
      expect.objectContaining({ created: expect.any(Function) })
    )
    app.unmount()
  })

  it('passes the ssr option through to the registry', () => {
    const app = createApp({ render: () => null })
    app.use(createChemicalXForms({ override: true }))
    expect(getRegistryFromApp(app).isSSR).toBe(true)
  })

  it('multiple apps in the same process get independent registries', () => {
    // Bare Vue + SSR ships one module across many requests. This test proves
    // that `createChemicalXForms()` does not rely on module-scoped state.
    const a = createApp({ render: () => null })
    const b = createApp({ render: () => null })
    a.use(createChemicalXForms())
    b.use(createChemicalXForms())
    expect(getRegistryFromApp(a)).not.toBe(getRegistryFromApp(b))
  })

  // D1 — installing twice on the same app is a no-op (idempotent).
  // Pre-fix, the second install overwrote `app._chemicalX`, orphaning
  // every form the first registry had built.
  it('a second install on the same app is a no-op and warns in dev', () => {
    const app = createApp({ render: () => null })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      app.use(createChemicalXForms())
      const firstRegistry = getRegistryFromApp(app)
      // Second install with a fresh factory call (Vue's Plugin dedupe
      // only catches identical plugin objects).
      app.use(createChemicalXForms())
      const secondRegistry = getRegistryFromApp(app)
      // Same registry — no overwrite.
      expect(secondRegistry).toBe(firstRegistry)
      // Single dev warning fired.
      const matched = warnSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('createChemicalXForms() install was called twice')
      )
      expect(matched.length).toBe(1)
    } finally {
      warnSpy.mockRestore()
    }
  })
})
