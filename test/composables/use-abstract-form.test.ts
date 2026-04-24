import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { useForm } from '../../src'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Belt-and-braces coverage for `requireFormKey` in use-abstract-form.ts.
 *
 * Phase 7.2 tightened the type-level contract — `UseFormConfiguration.key`
 * is no longer optional — but the runtime guard still catches non-TS
 * callers (e.g. JS consumers, `as` casts, null from dynamic inputs). These
 * tests prove the throw fires for the three shapes the guard intercepts.
 */

type Form = { name: string }

function mountWith(keyValue: unknown): Promise<string> {
  const App = defineComponent({
    setup() {
      // Bypass the type-level `key: FormKey` constraint to simulate a
      // non-TS caller. The runtime guard is the last line of defence.
      useForm<Form>({
        schema: fakeSchema<Form>({ name: '' }),
        key: keyValue as string,
      })
      return () => h('div')
    },
  })
  const app = createSSRApp(App)
  app.use(createChemicalXForms({ override: true }))
  return renderToString(app)
}

describe('useForm — runtime requireFormKey guard', () => {
  // Vue logs `[Vue warn]: Unhandled error during execution of setup`
  // via `console.warn` when setup() throws during renderToString. The
  // three throw-tests below intentionally exercise that throw; silencing
  // the expected warn keeps test output clean without losing a
  // real regression signal — Vue's native warn channel is the only
  // thing we suppress.
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('throws when key is undefined', async () => {
    await expect(mountWith(undefined)).rejects.toThrow(/requires an explicit `key`/)
  })

  it('throws when key is null', async () => {
    await expect(mountWith(null)).rejects.toThrow(/requires an explicit `key`/)
  })

  it('throws when key is an empty string', async () => {
    await expect(mountWith('')).rejects.toThrow(/requires an explicit `key`/)
  })

  it('accepts a non-empty key', async () => {
    await expect(mountWith('form-1')).resolves.toContain('<div')
  })
})
