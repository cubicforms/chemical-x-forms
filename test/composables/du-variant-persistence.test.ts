// @vitest-environment jsdom
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createAttaform } from '../../src/runtime/core/plugin'
import { fingerprintZodSchema } from '../../src/runtime/adapters/zod-v4/fingerprint'
import { hashStableString } from '../../src/runtime/core/hash'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'

/**
 * Variant memory × persistence interaction. The contract under test:
 *
 *   - Persistence saves only `form.value` — the ACTIVE variant's data.
 *     Inactive-variant typed data lives in `variantMemory` (in-RAM
 *     only) and is therefore LOST across a page refresh.
 *
 *   - A fresh mount (same persist key, after unmount) hydrates the
 *     persisted active variant but starts with an empty
 *     `variantMemory`. Switches in the new instance behave as if no
 *     prior session existed — fall back to slim defaults until the
 *     new instance captures something to remember.
 *
 * These were called out as gaps in the rememberVariants coverage
 * audit; pinning them here so any future change to either the
 * persistence pipeline or the variant-memory snapshot/restore flow
 * surfaces a regression.
 */

// Same MemoryStorage shim as persistence.test.ts — Node 25's
// experimental localStorage is unreliable without --localstorage-file,
// and jsdom loses the race. Install in-memory replacements.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}
const origLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const origSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
})
Object.defineProperty(globalThis, 'sessionStorage', {
  value: new MemoryStorage(),
  configurable: true,
})
afterAll(() => {
  if (origLocal !== undefined) Object.defineProperty(globalThis, 'localStorage', origLocal)
  else delete (globalThis as { localStorage?: Storage }).localStorage
  if (origSession !== undefined) Object.defineProperty(globalThis, 'sessionStorage', origSession)
  else delete (globalThis as { sessionStorage?: Storage }).sessionStorage
})

const profileSchema = z.object({
  notify: z.discriminatedUnion('channel', [
    z.object({ channel: z.literal('email'), address: z.string() }),
    z.object({ channel: z.literal('sms'), number: z.string() }),
  ]),
})

const FP = hashStableString(fingerprintZodSchema(profileSchema))
const fpKey = (base: string): string => `${base}:${FP}`

type Api = Omit<UseFormReturnType<z.output<typeof profileSchema>>, 'setValue'> & {
  setValue: (path: string, value: unknown) => boolean
}

/**
 * Mount with a select for the discriminator and conditional inputs
 * for the variant leaves, all persistence-opted-in. Returns helpers
 * to type into the active variant's input and to switch the
 * discriminator through the directive (so all writes hit the
 * persistence pipeline).
 */
function mount(persistKey: string): {
  app: App
  api: Api
  setAddress: (v: string) => void
  setNumber: (v: string) => void
  setChannel: (v: 'email' | 'sms') => void
} {
  const refs: { addr?: HTMLInputElement; num?: HTMLInputElement; sel?: HTMLSelectElement } = {}
  const handle: { api?: Api } = {}
  const App = defineComponent({
    setup() {
      const api = useForm({
        schema: profileSchema,
        key: `du-persist-${persistKey}`,
        defaultValues: { notify: { channel: 'email', address: '' } },
        persist: { storage: 'local', key: persistKey, debounceMs: 10 },
        // Sync field validation — irrelevant to this contract but keeps
        // tests deterministic against the new sync pre-pass.
        validateOn: 'change',
        debounceMs: 0,
      }) as unknown as Api
      handle.api = api
      return () =>
        h('div', [
          withDirectives(
            h(
              'select',
              {
                ref: (el: unknown) => {
                  if (el !== null) refs.sel = el as HTMLSelectElement
                },
              },
              [h('option', { value: 'email' }, 'email'), h('option', { value: 'sms' }, 'sms')]
            ),
            [[vRegister, api.register('notify.channel', { persist: true })]]
          ),
          api.values.notify.channel === 'email'
            ? withDirectives(
                h('input', {
                  type: 'text',
                  ref: (el: unknown) => {
                    if (el !== null) refs.addr = el as HTMLInputElement
                  },
                }),
                [[vRegister, api.register('notify.address', { persist: true })]]
              )
            : withDirectives(
                h('input', {
                  type: 'text',
                  ref: (el: unknown) => {
                    if (el !== null) refs.num = el as HTMLInputElement
                  },
                }),
                [[vRegister, api.register('notify.number', { persist: true })]]
              ),
        ])
    },
  })
  const app = createApp(App).use(createAttaform())
  app.config.warnHandler = () => {}
  app.config.errorHandler = () => {}
  app.mount(document.createElement('div'))

  const setAddress = (v: string): void => {
    if (refs.addr === undefined) throw new Error('email input not mounted')
    refs.addr.value = v
    refs.addr.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const setNumber = (v: string): void => {
    if (refs.num === undefined) throw new Error('sms input not mounted')
    refs.num.value = v
    refs.num.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const setChannel = (v: 'email' | 'sms'): void => {
    if (refs.sel === undefined) throw new Error('select not mounted')
    for (const opt of Array.from(refs.sel.options)) opt.selected = opt.value === v
    refs.sel.value = v
    refs.sel.dispatchEvent(new Event('change', { bubbles: true }))
  }

  return { app, api: handle.api as Api, setAddress, setNumber, setChannel }
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms))
}

async function drain(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

async function waitUntil<T>(
  predicate: () => T | null | undefined,
  timeoutMs = 500,
  intervalMs = 10
): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = predicate()
    if (v !== null && v !== undefined) return v
    await wait(intervalMs)
  }
  throw new Error('waitUntil: predicate never resolved')
}

describe('rememberVariants × persistence — refresh-survives contract', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('persisted draft holds only the active variant; inactive-variant typed data is lost across refresh', async () => {
    // Session 1: type email, switch to sms, type sms — variantMemory
    // captures the email-variant state on switch-out.
    const s1 = mount('s1')
    apps.push(s1.app)
    await drain()
    s1.setAddress('a@b.com')
    await waitUntil(() => (localStorage.getItem(fpKey('s1')) !== null ? true : null))
    s1.setChannel('sms')
    await nextTick()
    s1.setNumber('1234567')
    await waitUntil(() => {
      const raw = localStorage.getItem(fpKey('s1'))
      if (raw === null) return null
      const parsed = JSON.parse(raw) as { data: { form: { notify: { number?: string } } } }
      return parsed.data.form.notify.number === '1234567' ? true : null
    })

    // Storage holds the sms-shaped active variant — no `address` field
    // (memory entry is in-RAM only, not in the persisted payload).
    const raw = localStorage.getItem(fpKey('s1'))
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string) as {
      data: { form: { notify: Record<string, unknown> } }
    }
    expect(payload.data.form.notify).toEqual({ channel: 'sms', number: '1234567' })
    expect(payload.data.form.notify['address']).toBeUndefined()

    // Session 1 ends.
    s1.app.unmount()
    apps.pop()

    // Session 2: re-mount with the same persist key — simulates a
    // page refresh. Hydration restores the sms-shaped form;
    // variantMemory in the new instance starts EMPTY.
    const s2 = mount('s1')
    apps.push(s2.app)
    await waitUntil(() => (s2.api.values.notify.channel === 'sms' ? true : null))
    expect(s2.api.values.notify).toEqual({ channel: 'sms', number: '1234567' })

    // Switch to email in the fresh instance — no memory entry for
    // 'email', so the reshape falls back to the slim default.
    // CRITICAL: 'a@b.com' from session 1 is NOT recovered. That
    // typed data lived in variantMemory only and is gone forever.
    s2.api.setValue('notify.channel', 'email')
    await nextTick()
    expect(s2.api.values.notify).toEqual({ channel: 'email', address: '' })
  })

  it('variantMemory in a fresh mount only captures from the new session onward', async () => {
    // Session 1: email → sms (memory captures email='first-session@x.com'),
    // unmount.
    const s1 = mount('s2')
    apps.push(s1.app)
    s1.setAddress('first-session@x.com')
    await waitUntil(() => {
      const raw = localStorage.getItem(fpKey('s2'))
      if (raw === null) return null
      const parsed = JSON.parse(raw) as { data: { form: { notify: { address?: string } } } }
      return parsed.data.form.notify.address === 'first-session@x.com' ? true : null
    })
    s1.setChannel('sms')
    await nextTick()
    // Drain any pending persist writes triggered by the reshape.
    await wait(30)
    s1.app.unmount()
    apps.pop()

    // Session 2: hydrate, type sms data, switch to email.
    const s2 = mount('s2')
    apps.push(s2.app)
    await waitUntil(() => (s2.api.values.notify.channel === 'sms' ? true : null))
    s2.setNumber('9876543')
    await wait(30)

    // Switch to email — fresh instance's memory is empty for 'email'
    // (despite session 1 having typed 'first-session@x.com'). Fall
    // back to slim default — the prior session's typed data is gone.
    s2.api.setValue('notify.channel', 'email')
    await nextTick()
    expect(s2.api.values.notify).toEqual({ channel: 'email', address: '' })

    // Switch back to sms — memory entry CAPTURED IN THIS SESSION
    // restores '9876543'. Confirms memory is functional in the new
    // instance, just empty at start.
    s2.api.setValue('notify.channel', 'sms')
    await nextTick()
    expect(s2.api.values.notify).toEqual({ channel: 'sms', number: '9876543' })
  })

  it('hydration into a DU + variant memory empty: first switch falls back to slim default', async () => {
    // Pre-seed storage to simulate "user previously typed sms data,
    // refreshed cleanly" without going through session 1. Mount
    // hydrates to sms; memory empty; switching to email yields slim
    // default. Pins the no-prior-session path explicitly.
    localStorage.setItem(
      fpKey('seed'),
      JSON.stringify({
        v: 4,
        data: { form: { notify: { channel: 'sms', number: 'pre-seeded' } } },
      })
    )
    const s = mount('seed')
    apps.push(s.app)
    await waitUntil(() => (s.api.values.notify.channel === 'sms' ? true : null))
    expect(s.api.values.notify).toEqual({ channel: 'sms', number: 'pre-seeded' })

    s.api.setValue('notify.channel', 'email')
    await nextTick()
    expect(s.api.values.notify).toEqual({ channel: 'email', address: '' })
  })
})
