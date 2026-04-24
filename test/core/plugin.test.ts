// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
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
    expect(ctx.directives['register']).toBeDefined()
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
})
