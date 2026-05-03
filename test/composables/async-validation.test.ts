// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Phase 5.6 — async validation end-to-end.
 *
 * Covers the AbstractSchema contract change (Promise-returning
 * validateAtPath) at the public useForm surface: async zod refinements
 * resolve through handleSubmit, validate()'s pending flag flips
 * correctly, validateAsync() returns a one-shot promise, stale runs are
 * dropped via the generation counter, and isValidating mirrors the
 * in-flight count.
 */

type SignupForm = z.infer<typeof signupSchema>

const signupSchema = z.object({
  email: z
    .string()
    .email()
    .refine(async (value) => {
      // Simulate a server uniqueness check. Any email starting with
      // "taken@" is rejected after a microtask.
      await Promise.resolve()
      return !value.startsWith('taken@')
    }, 'Email already registered'),
  password: z.string().min(8),
})

function mountForm(onCreated: (form: ReturnType<typeof useForm<typeof signupSchema>>) => void) {
  type Returned = ReturnType<typeof useForm<typeof signupSchema>>
  const handle: { api?: Returned } = {}
  const App = defineComponent({
    setup() {
      // Pin lax: these tests exercise async refinements via handleSubmit /
      // validate() / validateAsync, not the construction-time strict-mode
      // seed. Lax keeps the form mount-clean so each test drives the
      // async path explicitly.
      handle.api = useForm({
        schema: signupSchema,
        key: 'async-validation',
        strict: false,
      })
      onCreated(handle.api)
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as Returned, root }
}

describe('async validation — handleSubmit awaits async refinements', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('dispatches to onSubmit when an async refinement passes', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)
    api.setValue('email', 'alice@example.com')
    api.setValue('password', 'very-secret')
    let submittedWith: SignupForm | null = null
    const handler = api.handleSubmit(async (values) => {
      submittedWith = values
    })
    await handler()
    expect(submittedWith).toEqual({ email: 'alice@example.com', password: 'very-secret' })
  })

  it('routes async refinement failures into fieldErrors + onError', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)
    api.setValue('email', 'taken@example.com')
    api.setValue('password', 'very-secret')
    let onErrorFired = false
    const handler = api.handleSubmit(
      async () => {
        throw new Error('onSubmit should not fire when validation fails')
      },
      () => {
        onErrorFired = true
      }
    )
    await handler()
    expect(onErrorFired).toBe(true)
    const emailErrors = api.errors.email
    expect(emailErrors?.[0]?.message).toBe('Email already registered')
  })

  it('isValidating flips true during submit validation, false after', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)
    api.setValue('email', 'alice@example.com')
    api.setValue('password', 'very-secret')
    const handler = api.handleSubmit(async () => {})
    const pending = handler()
    // At least one microtask in: validate has started.
    await Promise.resolve()
    expect(api.meta.isValidating).toBe(true)
    await pending
    expect(api.meta.isValidating).toBe(false)
  })
})

describe('validateAsync — imperative one-shot', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('resolves to success when the current form state satisfies the schema', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)
    api.setValue('email', 'ok@example.com')
    api.setValue('password', 'very-secret')
    const response = await api.validateAsync()
    expect(response.success).toBe(true)
    expect(response.errors).toBeUndefined()
  })

  it('resolves to failure when the async refinement rejects', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)
    api.setValue('email', 'taken@x.com')
    api.setValue('password', 'very-secret')
    const response = await api.validateAsync()
    expect(response.success).toBe(false)
    const msg = response.errors?.find((e) => e.path[0] === 'email')?.message
    expect(msg).toBe('Email already registered')
  })
})

describe('validate() reactive ref — pending + cancellation', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('starts pending, then settles on the first form mutation after mount', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)
    const status = api.validate()
    expect(status.value.pending).toBe(true)
    // Drain several microtask + Vue ticks — the async parse needs to
    // resolve and the watchEffect callback needs to re-enter.
    for (let i = 0; i < 8 && status.value.pending; i++) {
      await Promise.resolve()
      await nextTick()
    }
    expect(status.value.pending).toBe(false)
  })

  it('newer form mutations drop earlier in-flight validations', async () => {
    // If cancellation isn't wired, the older "taken@" result would
    // clobber the newer "alice@" result after it resolves. With the
    // generation counter, only the newest run writes — the test
    // confirms the settled status reflects the *latest* form value.
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)
    api.setValue('email', 'taken@example.com')
    api.setValue('password', 'very-secret')
    const status = api.validate()
    // Fire a second mutation before the first run settles.
    api.setValue('email', 'alice@example.com')
    for (let i = 0; i < 16 && status.value.pending; i++) {
      await Promise.resolve()
      await nextTick()
    }
    // Drain a few more cycles to be sure the stale older run doesn't
    // land after the fresh one.
    for (let i = 0; i < 4; i++) {
      await Promise.resolve()
      await nextTick()
    }
    expect(status.value.pending).toBe(false)
    if (status.value.pending) throw new Error('unreachable')
    expect(status.value.success).toBe(true)
  })
})
