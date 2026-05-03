// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { useForm } from '../../src/zod'
import { z } from 'zod'
import { createDecant } from '../../src/runtime/core/plugin'

/**
 * Debounced field-level validation.
 *
 * `validateOn: 'change'` (default) + `debounceMs > 0` schedules
 * validation on every `setValueAtPath` write; `validateOn: 'blur'`
 * fires immediately on blur; `validateOn: 'submit'` is the explicit
 * opt-out — writes never schedule a field run, errors only update
 * at submit time. With `debounceMs: 0` (the new default) writes
 * still validate per keystroke but go through the immediate (no
 * `setTimeout`) branch.
 *
 * Runs concurrently with handleSubmit — submit-entry aborts in-flight
 * field runs so submit's full-form result is authoritative.
 */

const baseSchema = z.object({
  email: z.string().email('bad email'),
  password: z.string().min(8, 'min 8 chars'),
})

function mountWith(options: { validateOn?: 'change' | 'blur' | 'submit'; debounceMs?: number }) {
  type Returned = ReturnType<typeof useForm<typeof baseSchema>>
  const handle: { api?: Returned } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: baseSchema,
        key: 'field-validation',
        // Pin lax: tests here exercise debounced field validation, not
        // the construction-time strict-mode seed. The schema is two
        // strings — neither auto-marks blank (only numeric primitives
        // do), so `derivedBlankErrors` stays empty and each test can
        // observe the debounced run without confounding entries.
        strict: false,
        ...(options.validateOn !== undefined ? { validateOn: options.validateOn } : {}),
        ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
      } as Parameters<typeof useForm<typeof baseSchema>>[0])
      return () => h('div')
    },
  })
  const app = createApp(App).use(createDecant({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as Returned, root }
}

async function drainMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('validateOn: "change", debounceMs > 0', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    vi.useRealTimers()
  })

  it('debounces writes — only the most recent value is validated', async () => {
    vi.useFakeTimers()
    const { app, api } = mountWith({ validateOn: 'change', debounceMs: 200 })
    apps.push(app)

    // Rapid writes within the debounce window.
    api.setValue('email', 'n')
    api.setValue('email', 'no')
    api.setValue('email', 'notanemail')
    // Nothing written yet — debounce hasn't elapsed.
    expect(api.errors.email).toBeUndefined()

    // Advance past the debounce and flush microtasks to let the async
    // safeParseAsync settle.
    await vi.advanceTimersByTimeAsync(250)
    await drainMicrotasks()

    const err = api.errors.email?.[0]
    expect(err?.message).toBe('bad email')
  })

  it('clears the errored path when the new value validates cleanly', async () => {
    vi.useFakeTimers()
    const { app, api } = mountWith({ validateOn: 'change', debounceMs: 50 })
    apps.push(app)

    api.setValue('email', 'not-email')
    await vi.advanceTimersByTimeAsync(100)
    await drainMicrotasks()
    expect(api.errors.email?.[0]?.message).toBe('bad email')

    api.setValue('email', 'fixed@example.com')
    await vi.advanceTimersByTimeAsync(100)
    await drainMicrotasks()
    expect(api.errors.email).toBeUndefined()
  })

  it('submit entry aborts pending field runs — submit result wins', async () => {
    vi.useFakeTimers()
    const { app, api } = mountWith({ validateOn: 'change', debounceMs: 500 })
    apps.push(app)

    // Queue a field validation but don't let it fire yet.
    api.setValue('email', 'invalid')
    // Submit fires before the debounce elapses.
    const handler = api.handleSubmit(async () => {})
    const pending = handler()
    // Advance past the debounce — the field timer is already cleared
    // at submit entry, so no field run kicks off.
    await vi.advanceTimersByTimeAsync(600)
    await pending
    await drainMicrotasks()

    // Submit's full-form validation has populated errors for every
    // failing field — including email ('bad email') and password
    // ('min 8 chars').
    expect(api.errors.email?.[0]?.message).toBe('bad email')
    expect(api.errors.password?.[0]?.message).toBe('min 8 chars')
  })

  it('validateOn defaults to "change" with debounceMs: 0 — writes validate synchronously', async () => {
    const { app, api } = mountWith({})
    apps.push(app)

    api.setValue('email', 'not-an-email')
    // No setTimeout to wait on — microtask flush is enough.
    await drainMicrotasks()
    expect(api.errors.email?.[0]?.message).toBe('bad email')
  })

  it('explicit validateOn: "submit" opts out: writes never schedule a field run', async () => {
    vi.useFakeTimers()
    const { app, api } = mountWith({ validateOn: 'submit' })
    apps.push(app)

    api.setValue('email', 'not-an-email')
    await vi.advanceTimersByTimeAsync(1000)
    await drainMicrotasks()
    expect(api.errors.email).toBeUndefined()
  })
})

describe('validateOn: "blur"', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writing the value does NOT validate — only blur does', async () => {
    const { app, api } = mountWith({ validateOn: 'blur' })
    apps.push(app)

    api.setValue('email', 'invalid')
    await drainMicrotasks()
    // No write-path validation in blur mode.
    expect(api.errors.email).toBeUndefined()
  })
})

describe('field validation: reset cancels pending runs', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    vi.useRealTimers()
  })

  it('reset() prevents a scheduled field-run timer from firing', async () => {
    vi.useFakeTimers()
    const { app, api } = mountWith({ validateOn: 'change', debounceMs: 300 })
    apps.push(app)

    api.setValue('email', 'not-an-email')
    api.reset()
    await vi.advanceTimersByTimeAsync(500)
    await drainMicrotasks()
    // Reset cleared the timer — no field-run wrote anything to errors.
    expect(api.errors.email).toBeUndefined()
  })
})
