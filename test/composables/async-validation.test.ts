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
 * dropped via the generation counter, and validating mirrors the
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
  const app = createApp(App).use(createAttaform())
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

  it('validating flips true during submit validation, false after', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)
    api.setValue('email', 'alice@example.com')
    api.setValue('password', 'very-secret')
    const handler = api.handleSubmit(async () => {})
    const pending = handler()
    // At least one microtask in: validate has started.
    await Promise.resolve()
    expect(api.meta.validating).toBe(true)
    await pending
    expect(api.meta.validating).toBe(false)
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

describe('per-field validating — `form.fields.<path>.validating`', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('flips true synchronously after setValue, back to false once the per-field run settles', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)

    expect(api.fields.email.validating).toBe(false)

    // `validateOn: 'change'` (default) + `debounceMs: 0` (default) make
    // `scheduleFieldValidation` enter `run()` synchronously, which
    // increments the per-field counter before the microtask that runs
    // the schema. So immediately after `setValue` the flag is `true`,
    // and only after the microtask chain settles does it return to
    // `false`.
    api.setValue('email', 'alice@example.com')
    expect(api.fields.email.validating).toBe(true)

    for (let i = 0; i < 16 && api.fields.email.validating; i++) {
      await Promise.resolve()
      await nextTick()
    }
    expect(api.fields.email.validating).toBe(false)
  })

  it('sibling paths flip independently — email validating does not affect password', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)

    // Drive both fields back-to-back. Password's refinement is sync
    // (`z.string().min(8)`) so its flag is in flight only across the
    // single-microtask window of `Promise.resolve().then(...)`; email's
    // is async and stays in flight longer. Snapshot synchronously so
    // both are observed with their counters > 0.
    api.setValue('email', 'alice@example.com')
    api.setValue('password', 'very-secret')
    expect(api.fields.email.validating).toBe(true)
    expect(api.fields.password.validating).toBe(true)

    for (let i = 0; i < 16; i++) {
      await Promise.resolve()
      await nextTick()
      if (!api.fields.email.validating && !api.fields.password.validating) break
    }
    expect(api.fields.email.validating).toBe(false)
    expect(api.fields.password.validating).toBe(false)
  })

  it('whole-form validateAsync() does NOT flip per-field flags (only form.meta.validating)', async () => {
    // Per-field `validating` reflects field-LEVEL scheduled runs only,
    // by design. Whole-form validation drives the form-wide flag and the
    // per-field flag stays at its prior value (here, `false`).
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)

    api.setValue('email', 'alice@example.com')
    api.setValue('password', 'very-secret')
    // Drain the per-field runs scheduled by setValue so we start clean.
    for (let i = 0; i < 16; i++) {
      await Promise.resolve()
      await nextTick()
      if (!api.fields.email.validating && !api.fields.password.validating) break
    }
    expect(api.fields.email.validating).toBe(false)
    expect(api.fields.password.validating).toBe(false)

    const pending = api.validateAsync()
    // Crack the microtask so validateAsync's increment lands on
    // `activeValidations` before we observe.
    await Promise.resolve()
    expect(api.meta.validating).toBe(true)
    expect(api.fields.email.validating).toBe(false)
    expect(api.fields.password.validating).toBe(false)
    await pending
    expect(api.meta.validating).toBe(false)
  })

  it('stale-run safety — rapid setValues keep validating true across the abort/restart boundary', async () => {
    // Two writes to the same path back-to-back: the second aborts the
    // first's controller before the first's `.finally` can decrement.
    // With a counter (not a Set), the count goes 1 → 2 → 1 → 0 and the
    // accessor reports `true` continuously until both runs settle. A
    // Set-based regression would briefly read `false` between the
    // aborted run's delete and the fresh run's add.
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)

    api.setValue('email', 'taken@example.com')
    expect(api.fields.email.validating).toBe(true)
    api.setValue('email', 'alice@example.com')
    expect(api.fields.email.validating).toBe(true)

    for (let i = 0; i < 16 && api.fields.email.validating; i++) {
      await Promise.resolve()
      await nextTick()
    }
    expect(api.fields.email.validating).toBe(false)
  })
})

describe('per-field valid — `form.fields.<path>.valid`', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('false during a per-field run, true after settle when there are no errors', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)

    api.setValue('email', 'alice@example.com')
    expect(api.fields.email.validating).toBe(true)
    expect(api.fields.email.valid).toBe(false)

    for (let i = 0; i < 16 && api.fields.email.validating; i++) {
      await Promise.resolve()
      await nextTick()
    }
    expect(api.fields.email.validating).toBe(false)
    expect(api.fields.email.errors).toEqual([])
    expect(api.fields.email.valid).toBe(true)
  })

  it('false after a failed async refinement settles (no in-flight, errors present)', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)

    api.setValue('email', 'taken@example.com')
    for (let i = 0; i < 16 && api.fields.email.validating; i++) {
      await Promise.resolve()
      await nextTick()
    }
    expect(api.fields.email.validating).toBe(false)
    expect(api.fields.email.errors.length).toBeGreaterThan(0)
    expect(api.fields.email.valid).toBe(false)
  })
})

describe('form.meta.valid — `valid && !validating`', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('flips false during validateAsync, true after settle when no errors', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)

    api.setValue('email', 'alice@example.com')
    api.setValue('password', 'very-secret')
    // Drain per-field runs first.
    for (let i = 0; i < 16; i++) {
      await Promise.resolve()
      await nextTick()
      if (!api.meta.validating) break
    }
    expect(api.meta.validating).toBe(false)
    expect(api.meta.errors).toEqual([])
    expect(api.meta.valid).toBe(true)

    const pending = api.validateAsync()
    await Promise.resolve()
    expect(api.meta.validating).toBe(true)
    // `valid` is the stricter signal: an in-flight validation flips it
    // to `false` even when errors are still empty.
    expect(api.meta.valid).toBe(false)

    await pending
    expect(api.meta.validating).toBe(false)
    expect(api.meta.errors).toEqual([])
    expect(api.meta.valid).toBe(true)
  })

  it('false after a failed validateAsync (errors land, no in-flight)', async () => {
    let api!: ReturnType<typeof useForm<typeof signupSchema>>
    const { app } = mountForm((a) => (api = a))
    apps.push(app)

    api.setValue('email', 'taken@example.com')
    api.setValue('password', 'very-secret')
    const response = await api.validateAsync()
    expect(response.success).toBe(false)
    expect(api.meta.validating).toBe(false)
    expect(api.meta.errors.length).toBeGreaterThan(0)
    expect(api.meta.valid).toBe(false)
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
