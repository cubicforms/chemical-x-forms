// @vitest-environment jsdom
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { fingerprintZodSchema } from '../../src/runtime/adapters/zod-v4/fingerprint'
import { hashStableString } from '../../src/runtime/core/hash'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { useForm } from '../../src/zod'

/**
 * Persistence hydration must run validation to completion against the
 * rehydrated value. Pre-fix, `wirePersistence` only called
 * `applyFormReplacement(merged)` and stopped — async refines never re-
 * fired against the persisted value. A consumer who persisted an
 * invalid email like `"taken@example.com"` (passes `z.email()` sync,
 * fails the async uniqueness refine) would refresh into a form the
 * runtime considered VALID, surfacing a "Nice choice!" message for an
 * email that should still be flagged as taken.
 *
 * Construction-time strict-mode validation is `safeParse` (sync); zod
 * raises "Encountered Promise during synchronous parse" when a schema
 * carries an async refine, so the seed pass returns success silently.
 * That makes construction-time errors absent on async-refine schemas
 * AND stale on rehydrated forms regardless of refine presence — both
 * paths converge on "post-hydration validation is required."
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
const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'sessionStorage'
)
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
})
Object.defineProperty(globalThis, 'sessionStorage', {
  value: new MemoryStorage(),
  configurable: true,
})

afterAll(() => {
  if (originalLocalStorageDescriptor !== undefined) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor)
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage
  }
  if (originalSessionStorageDescriptor !== undefined) {
    Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorageDescriptor)
  } else {
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage
  }
})

const asyncSchema = z.object({
  email: z.email().refine(async (v) => {
    await new Promise((r) => setTimeout(r, 50))
    return v !== 'taken@example.com'
  }, 'That email is already registered.'),
})
type AsyncForm = z.infer<typeof asyncSchema>

const syncSchema = z.object({
  email: z.email('Invalid email'),
})
type SyncForm = z.infer<typeof syncSchema>

const ASYNC_FP = hashStableString(fingerprintZodSchema(asyncSchema))
const SYNC_FP = hashStableString(fingerprintZodSchema(syncSchema))

async function wait(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitUntil<T>(
  predicate: () => T | null | undefined,
  timeoutMs = 2000,
  intervalMs = 5
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = predicate()
    if (v !== null && v !== undefined) return v
    if (Date.now() >= deadline) return null
    await wait(intervalMs)
  }
}

type AsyncApi = ReturnType<typeof useForm<typeof asyncSchema>>
type SyncApi = ReturnType<typeof useForm<typeof syncSchema>>

function mountAsyncForm(persistKey: string, strict: boolean = true): { app: App; api: AsyncApi } {
  const handle: { api?: AsyncApi } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: asyncSchema,
        key: `async-hydrate-${persistKey}`,
        strict,
        persist: { storage: 'local', key: persistKey, debounceMs: 20 },
        defaultValues: { email: '' } as AsyncForm,
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as AsyncApi }
}

function mountSyncForm(persistKey: string): { app: App; api: SyncApi } {
  const handle: { api?: SyncApi } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: syncSchema,
        key: `sync-hydrate-${persistKey}`,
        persist: { storage: 'local', key: persistKey, debounceMs: 20 },
        // Valid default keeps construction-time seed clean. The
        // persisted value below fails — only post-hydration
        // revalidation can flag it.
        defaultValues: { email: 'valid@example.com' } as SyncForm,
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as SyncApi }
}

describe('persistence hydration — validation runs against the rehydrated value', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('strict + async refine: persisted refine-failing value gets flagged after hydration', async () => {
    // taken@example.com passes z.email() sync but fails the async refine.
    // Pre-fix the refine never fired on hydration; the form looked valid.
    localStorage.setItem(
      `test-async-hydrate-strict:${ASYNC_FP}`,
      JSON.stringify({ v: 4, data: { form: { email: 'taken@example.com' } } })
    )
    const { app, api } = mountAsyncForm('test-async-hydrate-strict', true)
    apps.push(app)
    await waitUntil(() => (api.values.email === 'taken@example.com' ? true : null))
    expect(api.values.email).toBe('taken@example.com')
    const errorMessage = await waitUntil(() => api.errors.email?.[0]?.message ?? null)
    expect(errorMessage).toBe('That email is already registered.')
    expect(api.meta.isValid).toBe(false)
    await waitUntil(() => (api.meta.isValidating === false ? true : null))
    expect(api.meta.isValidating).toBe(false)
  })

  it('lax + async refine: same behavior — hydration triggers refine validation', async () => {
    // Lax skips the construction-time seed entirely; this proves the
    // post-hydration revalidation is independent of `strict`.
    localStorage.setItem(
      `test-async-hydrate-lax:${ASYNC_FP}`,
      JSON.stringify({ v: 4, data: { form: { email: 'taken@example.com' } } })
    )
    const { app, api } = mountAsyncForm('test-async-hydrate-lax', false)
    apps.push(app)
    await waitUntil(() => (api.values.email === 'taken@example.com' ? true : null))
    const errorMessage = await waitUntil(() => api.errors.email?.[0]?.message ?? null)
    expect(errorMessage).toBe('That email is already registered.')
    expect(api.meta.isValid).toBe(false)
  })

  it('strict + sync schema: persisted sync-failing value gets flagged after hydration', async () => {
    // No async refine here — the post-hydration validation also covers
    // the case where the persisted value fails ordinary sync
    // constraints. Pre-fix this also slipped through whenever the
    // construction-time seed disagreed with the rehydrated value.
    localStorage.setItem(
      `test-sync-hydrate:${SYNC_FP}`,
      JSON.stringify({ v: 4, data: { form: { email: 'not-an-email' } } })
    )
    const { app, api } = mountSyncForm('test-sync-hydrate')
    apps.push(app)
    await waitUntil(() => (api.values.email === 'not-an-email' ? true : null))
    const errorMessage = await waitUntil(() => api.errors.email?.[0]?.message ?? null)
    expect(errorMessage).toBe('Invalid email')
    expect(api.meta.isValid).toBe(false)
  })

  it('strict + async refine: persisted valid value clears stale construction-time errors', async () => {
    // The construction-time seed runs against the EMPTY default. The
    // persisted value (a fresh, untaken email) is valid. Post-hydration
    // validation must overwrite the seed so the form ends valid — not
    // carrying a stale "Invalid email" about the empty default.
    localStorage.setItem(
      `test-async-hydrate-valid:${ASYNC_FP}`,
      JSON.stringify({ v: 4, data: { form: { email: 'fresh@example.com' } } })
    )
    const { app, api } = mountAsyncForm('test-async-hydrate-valid', true)
    apps.push(app)
    await waitUntil(() => (api.values.email === 'fresh@example.com' ? true : null))
    await waitUntil(() => (api.meta.isValidating === false ? true : null))
    await nextTick()
    expect(api.errors.email).toBeUndefined()
    expect(api.meta.isValid).toBe(true)
  })

  it('flips isValidating during the post-hydration validation pass', async () => {
    // The 50 ms refine delay leaves a comfortable window to observe
    // `isValidating: true`. Pre-fix no validation ran on hydration;
    // `isValidating` never flipped true.
    localStorage.setItem(
      `test-async-hydrate-flag:${ASYNC_FP}`,
      JSON.stringify({ v: 4, data: { form: { email: 'taken@example.com' } } })
    )
    const { app, api } = mountAsyncForm('test-async-hydrate-flag', true)
    apps.push(app)
    await waitUntil(() => (api.values.email === 'taken@example.com' ? true : null))
    const sawValidating = await waitUntil(() => (api.meta.isValidating === true ? true : null), 500)
    expect(sawValidating).toBe(true)
    await waitUntil(() => (api.meta.isValidating === false ? true : null))
    expect(api.meta.isValidating).toBe(false)
  })
})
