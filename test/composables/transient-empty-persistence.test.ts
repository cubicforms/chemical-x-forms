// @vitest-environment jsdom
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { CxErrorCode } from '../../src/runtime/core/error-codes'
import { canonicalizePath } from '../../src/runtime/core/paths'
import { fingerprintZodSchema } from '../../src/runtime/adapters/zod-v4/fingerprint'
import { hashStableString } from '../../src/runtime/core/hash'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * Round-trip coverage for blank across `localStorage`
 * persistence + the v=2→v=3 envelope bump.
 */

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

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
})

afterAll(() => {
  // Restore the platform localStorage so later test files in the
  // same worker observe jsdom's real implementation.
  if (originalLocalStorageDescriptor !== undefined) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor)
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage
  }
})

const schema = z.object({ income: z.number() })
// Storage keys hash the structural fingerprint via cyrb53; mirror that
// transformation here so tests pre-seeding or reading keys directly
// resolve to the same suffix the form looks up.
const FP = hashStableString(fingerprintZodSchema(schema))
const fpKey = (base: string): string => `${base}:${FP}`

async function flushAll(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    await nextTick()
  }
  await new Promise((r) => setTimeout(r, 30))
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('persistence — v=2 envelope rejection emits a one-time dev-warn', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  const apps: App[] = []

  beforeEach(() => {
    localStorage.clear()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    document.body.innerHTML = ''
    warnSpy.mockRestore()
  })

  it('warns once when a v=2 payload is dropped', async () => {
    localStorage.setItem(
      fpKey('te-v2-warn-x'),
      JSON.stringify({ v: 2, data: { form: { income: 5 } } })
    )

    const App = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'te-v2-warn-form',
          persist: { storage: 'local', key: 'te-v2-warn-x', debounceMs: 10 },
        })
        return () =>
          withDirectives(h('input', { type: 'number' }), [
            [vRegister, form.register('income', { persist: true })],
          ])
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    apps.push(app)
    app.mount(document.createElement('div'))

    await flushAll()

    const v2Warns = warnSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0] ?? '').includes('envelope v=2')
    )
    expect(v2Warns.length).toBeGreaterThanOrEqual(1)
  })
})

describe('persistence — blank round-trips across mount', () => {
  const apps: App[] = []

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    document.body.innerHTML = ''
  })

  it('a v=3 payload with blankPaths restores the empty UI state on next mount', async () => {
    const incomeKey = canonicalizePath('income').key
    // Pre-seed a v=3 payload that mirrors what the lib would have
    // written on a previous session: storage holds the slim default
    // (0) but the path is in `blankPaths` so the UI
    // re-renders blank.
    localStorage.setItem(
      fpKey('te-rt'),
      JSON.stringify({
        v: 4,
        data: { form: { income: 0 }, blankPaths: [incomeKey] },
      })
    )

    let captured: ReturnType<typeof useForm<typeof schema>> | undefined
    const App = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'te-rt-form',
          persist: { storage: 'local', key: 'te-rt', debounceMs: 10 },
        })
        captured = form
        return () =>
          withDirectives(
            h('input', {
              type: 'number',
              'data-test': 'income',
            }),
            [[vRegister, form.register('income', { persist: true })]]
          )
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    apps.push(app)
    app.mount(document.createElement('div'))

    await flushAll()

    if (captured === undefined) throw new Error('form not captured')
    const binding = captured.register('income')
    expect(binding.displayValue.value).toBe('')
    // Submit fails with "Required" — the persisted empty state
    // survived the round-trip and the validation augmentation
    // honours it.
    const onSubmit = vi.fn()
    const onError = vi.fn()
    const handler = captured.handleSubmit(onSubmit, onError)
    await handler()
    expect(onSubmit).not.toHaveBeenCalled()
    const errs = onError.mock.calls[0]?.[0] as Array<{ code: string }>
    expect(errs?.some((e) => e.code === CxErrorCode.NoValueSupplied)).toBe(true)
  })

  it('writes the blankPaths field after a numeric clear', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const App = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'te-write-form',
          persist: { storage: 'local', key: 'te-write', debounceMs: 10 },
        })
        return () =>
          withDirectives(
            h('input', {
              type: 'number',
              'data-test': 'income',
            }),
            [[vRegister, form.register('income', { persist: true })]]
          )
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    apps.push(app)
    app.mount(root)

    await flushAll()

    const input = document.querySelector('input[data-test="income"]') as HTMLInputElement
    // Type a value to trigger the persistence opt-in path, then
    // clear to trigger markBlank + a follow-up persist.
    input.value = '5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAll()

    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushAll()

    const raw = localStorage.getItem(fpKey('te-write'))
    expect(raw).not.toBeNull()
    const payload = JSON.parse(raw as string)
    expect(payload.v).toBe(4)
    const incomeKey = canonicalizePath('income').key
    expect(payload.data.blankPaths).toContain(incomeKey)
  })

  it('hydration overrides construction-time auto-mark — persisted empty list wins', async () => {
    // The form has no defaultValues, so construction-time auto-mark
    // would mark `income`. But a v=3 payload pre-seeded with an EMPTY
    // `blankPaths` list (representing "user previously filled
    // this in") must override — the hydrated set is the truth.
    localStorage.setItem(
      fpKey('te-hyd'),
      JSON.stringify({
        v: 4,
        data: { form: { income: 100 }, blankPaths: [] },
      })
    )

    let captured: ReturnType<typeof useForm<typeof schema>> | undefined
    const App = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'te-hyd-form',
          persist: { storage: 'local', key: 'te-hyd', debounceMs: 10 },
        })
        captured = form
        return () =>
          withDirectives(
            h('input', {
              type: 'number',
              'data-test': 'income',
            }),
            [[vRegister, form.register('income', { persist: true })]]
          )
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    apps.push(app)
    app.mount(document.createElement('div'))

    await flushAll()

    if (captured === undefined) throw new Error('form not captured')
    expect(captured.blankPaths.value.size).toBe(0)
    expect(captured.values.income).toBe(100)
  })
})
