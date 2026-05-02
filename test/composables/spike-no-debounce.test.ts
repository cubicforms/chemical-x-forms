// @vitest-environment jsdom
//
// Spike: `fieldValidation.debounceMs: 0` and `persist.debounceMs: 0`
// as the off switch. Demonstrates the user-visible difference between
// the default debounced flow and the synchronous flow: every keystroke
// produces immediate error feedback / immediate persistence write,
// without waiting for a `setTimeout(fn, 0)` macrotask.
//
// "Synchronous" here means "no `setTimeout` indirection on the
// debounce side." The schema work itself still rides
// `Promise.resolve().then(validateAtPath)` — async but microtask, so
// `await Promise.resolve()` between keystrokes is enough to surface
// errors. The default-debounced form needs a real `setTimeout(>0)`
// flush to surface anything.
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
})

async function microtaskFlush(): Promise<void> {
  // Several microtask hops for the schema's
  // `Promise.resolve().then(validateAtPath).then(applySchemaErrors)`
  // chain plus Vue's render scheduler. Crucially: NO `setTimeout` —
  // if the test passes after this, validation is genuinely off the
  // debounce timer.
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

async function timerFlush(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
  await nextTick()
}

describe('spike — fieldValidation.debounceMs: 0 disables the debounce timer', () => {
  const schema = z.object({
    email: z.string().email('Enter a valid email.'),
  })

  it('default debounce: post-keystroke errors do NOT surface until the timer fires', async () => {
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          // Mount with a VALID value so the construction-time validation
          // (which runs immediately regardless of `debounceMs`) seeds no
          // error. We're testing the per-keystroke debounce, not mount.
          defaultValues: { email: 'good@example.com' },
          key: `default-${Math.random().toString(36).slice(2)}`,
          // Implicit: debounceMs: 125 (the library default).
          fieldValidation: { on: 'change' },
        })
        const rv = handle.api.register('email')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'text', 'data-field': 'email' }), [[vRegister, rv]]),
          ])
      },
    })
    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await microtaskFlush()
    expect(handle.api?.errors.email).toBeUndefined()

    const input = root.querySelector('[data-field="email"]') as HTMLInputElement
    input.value = 'a'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    // Microtask flush only — the default debounce timer hasn't fired,
    // so no per-keystroke re-validation has run. Errors stay empty.
    await microtaskFlush()
    expect(handle.api?.errors.email).toBeUndefined()

    // Wait long enough for the 125 ms timer to fire, then errors land.
    await timerFlush(150)
    expect(handle.api?.errors.email?.[0]?.message).toBe('Enter a valid email.')
  })

  it('debounceMs: 0: errors surface on the next microtask — no timer wait', async () => {
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          defaultValues: { email: 'good@example.com' },
          key: `nodebounce-${Math.random().toString(36).slice(2)}`,
          fieldValidation: { on: 'change', debounceMs: 0 },
        })
        const rv = handle.api.register('email')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'text', 'data-field': 'email' }), [[vRegister, rv]]),
          ])
      },
    })
    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await microtaskFlush()
    expect(handle.api?.errors.email).toBeUndefined()

    const input = root.querySelector('[data-field="email"]') as HTMLInputElement
    input.value = 'a'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    // Microtask flush is enough — no setTimeout to wait on. Validation
    // ran synchronously inside the input handler; the schema's async
    // resolution lands on the next microtask.
    await microtaskFlush()
    expect(handle.api?.errors.email?.[0]?.message).toBe('Enter a valid email.')
  })

  it('debounceMs: 0: per-keystroke errors track the live value with no lag', async () => {
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          defaultValues: { email: 'good@example.com' },
          key: `live-${Math.random().toString(36).slice(2)}`,
          fieldValidation: { on: 'change', debounceMs: 0 },
        })
        const rv = handle.api.register('email')
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'text', 'data-field': 'email' }), [[vRegister, rv]]),
          ])
      },
    })
    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await microtaskFlush()
    expect(handle.api?.errors.email).toBeUndefined()

    const input = root.querySelector('[data-field="email"]') as HTMLInputElement

    // Walk through a typing sequence. Each keystroke produces a
    // re-validation; with debounceMs: 0 we observe the schema's
    // verdict on every step on the next microtask. With the default
    // debounce, only the last value would surface (after the timer).
    const sequence = [
      { typed: 'a', valid: false },
      { typed: 'a@', valid: false },
      { typed: 'a@b', valid: false },
      { typed: 'a@b.com', valid: true },
      { typed: 'a@b.', valid: false },
    ] as const

    for (const step of sequence) {
      input.value = step.typed
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await microtaskFlush()
      const hasError = handle.api?.errors.email !== undefined
      expect(hasError).toBe(!step.valid)
    }
  })
})

describe('spike — persist.debounceMs: 0 writes immediately on every form change', () => {
  const schema = z.object({ note: z.string() })

  it('default debounce: storage is empty until the 300 ms timer fires', async () => {
    const writes: { key: string; value: unknown }[] = []
    const memoryAdapter = {
      async getItem(): Promise<unknown> {
        return null
      },
      async setItem(key: string, value: unknown): Promise<void> {
        writes.push({ key, value })
      },
      async removeItem(): Promise<void> {},
      async listKeys(): Promise<string[]> {
        return []
      },
    }

    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          defaultValues: { note: '' },
          key: `persist-default-${Math.random().toString(36).slice(2)}`,
          persist: { storage: memoryAdapter },
        })
        const rv = handle.api.register('note', { persist: true })
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'text', 'data-field': 'note' }), [[vRegister, rv]]),
          ])
      },
    })
    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await microtaskFlush()

    const input = root.querySelector('[data-field="note"]') as HTMLInputElement
    input.value = 'hello'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    // Microtask flush — write hasn't happened yet (300 ms timer pending).
    await microtaskFlush()
    expect(writes.length).toBe(0)

    // After the timer, exactly one coalesced write lands.
    await timerFlush(350)
    expect(writes.length).toBe(1)
  })

  it('debounceMs: 0: every keystroke kicks off a write immediately', async () => {
    const writes: { key: string; value: unknown }[] = []
    const memoryAdapter = {
      async getItem(): Promise<unknown> {
        return null
      },
      async setItem(key: string, value: unknown): Promise<void> {
        writes.push({ key, value })
      },
      async removeItem(): Promise<void> {},
      async listKeys(): Promise<string[]> {
        return []
      },
    }

    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          defaultValues: { note: '' },
          key: `persist-zero-${Math.random().toString(36).slice(2)}`,
          persist: { storage: memoryAdapter, debounceMs: 0 },
        })
        const rv = handle.api.register('note', { persist: true })
        return () =>
          h('div', null, [
            withDirectives(h('input', { type: 'text', 'data-field': 'note' }), [[vRegister, rv]]),
          ])
      },
    })
    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await microtaskFlush()

    const input = root.querySelector('[data-field="note"]') as HTMLInputElement

    // Three keystrokes → three writes. No coalescing since the timer
    // is the gate that would have collapsed bursts.
    for (const typed of ['h', 'he', 'hel']) {
      input.value = typed
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await microtaskFlush()
    }
    expect(writes.length).toBe(3)
    // Last write reflects the last typed value.
    const lastEnvelope = writes[writes.length - 1]?.value as {
      data: { form: { note: string } }
    }
    expect(lastEnvelope.data.form.note).toBe('hel')
  })
})
