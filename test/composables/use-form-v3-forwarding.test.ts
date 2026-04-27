// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod-v3'
import type { FormStorage, UseAbstractFormReturnType } from '../../src/runtime/types/types-api'
import { vRegister } from '../../src/runtime/core/directive'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { useForm } from '../../src/zod-v3'

/**
 * Regression pin: the zod v3 `useForm` wrapper used to hand-pick the
 * options it forwarded to `useAbstractForm`, silently dropping the
 * opt-in ones (`onInvalidSubmit`, `fieldValidation`, `persist`,
 * `history`). These tests prove each option now reaches the runtime.
 */

const schema = z.object({ email: z.string(), password: z.string() })
type Form = { email: string; password: string }
type ApiReturn = UseAbstractFormReturnType<Form, Form>

// Mount helper that accepts any v3 useForm options bag. Using `never`
// here side-steps TS picking the wrong `useForm` overload at the
// outer-level type inference; at the call site below, `useForm`
// internally narrows based on whether `options.schema` is a Zod type.
type AnyUseFormOptions = Parameters<typeof useForm>[0]

function mount(options: AnyUseFormOptions): { app: App; api: ApiReturn } {
  const handle: { api?: ApiReturn } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm(options as never) as ApiReturn
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as ApiReturn }
}

async function drain(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('v3 useForm forwards opt-in options to useAbstractForm', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('forwards fieldValidation — live field errors populate without submit', async () => {
    const strictSchema = z.object({
      email: z.string().email('bad email'),
      password: z.string().min(8, 'min 8 chars'),
    })
    const { app, api } = mount({
      schema: strictSchema,
      key: 'v3-fieldvalidation',
      fieldValidation: { on: 'change', debounceMs: 20 },
    })
    apps.push(app)

    // A non-email string triggers the schema's leaf rule. The
    // field-validation scheduler — only active if the option
    // reached useAbstractForm — populates fieldErrors within the
    // debounce window.
    api.setValue('email', 'nope')
    await wait(60)
    await drain()

    expect(api.fieldErrors.email?.[0]?.message).toBe('bad email')
  })

  it('forwards persist — custom FormStorage receives setItem calls', async () => {
    const setItem = vi.fn().mockResolvedValue(undefined)
    const storage: FormStorage = {
      getItem: () => Promise.resolve(undefined),
      setItem,
      removeItem: () => Promise.resolve(),
    }

    // Persistence is per-element opt-in, so the test must drive its
    // mutation through a real <input v-register="register('email',
    // { persist: true })">. Programmatic `api.setValue` doesn't reach
    // the persistence pipeline by design.
    const handle: { api?: ApiReturn; emailInput?: HTMLInputElement } = {}
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: 'v3-persist',
          persist: { storage, debounceMs: 20 },
        } as never) as ApiReturn
        handle.api = api
        return () =>
          h('div', [
            withDirectives(
              h('input', {
                type: 'text',
                ref: (el): void => {
                  if (el !== null) handle.emailInput = el as HTMLInputElement
                },
              }),
              [[vRegister, api.register('email', { persist: true })]]
            ),
          ])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)

    // Simulate the user typing — the directive's input handler will
    // attach `meta.persist = true` (this element opted in) and the
    // persistence subscription will fire.
    const input = handle.emailInput
    if (input === undefined) throw new Error('email input not mounted')
    input.value = 'alice@example.com'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(50)
    await drain()

    expect(setItem).toHaveBeenCalled()
    const [key, payload] = setItem.mock.calls[0] ?? []
    expect(key).toBe('chemical-x-forms:v3-persist')
    expect(payload).toMatchObject({
      v: 2,
      data: { form: { email: 'alice@example.com' } },
    })
  })
})
