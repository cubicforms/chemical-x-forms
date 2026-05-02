// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { canonicalizePath } from '../../src/runtime/core/paths'
import { useForm } from '../../src/zod'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Initial validation seed: when a form is constructed in strict mode
 * and its default values fail schema validation, `schemaErrors` is
 * populated immediately at construction time (without requiring a user
 * mutation or an explicit `validateAsync` call).
 *
 * Three invariants locked here:
 *   1. STRICT mode + invalid defaults  → seed populates schemaErrors.
 *   2. LAX mode    + invalid defaults  → no seed (lax explicitly opts
 *      out of construction-time validation).
 *   3. Hydration provided              → hydration replaces the seed
 *      wholesale; the server's snapshot is authoritative.
 */

const tightSchema = z.object({
  email: z.email('bad email'),
  password: z.string().min(8, 'min 8 chars'),
})

type Tight = z.infer<typeof tightSchema>

function mountWithZod(options: { strict?: boolean; defaultValues?: Partial<Tight> }): {
  app: App
  api: ReturnType<typeof useForm<typeof tightSchema>>
} {
  type API = ReturnType<typeof useForm<typeof tightSchema>>
  const handle: { api?: API } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: tightSchema,
        key: 'init-seed',
        ...(options.strict !== undefined ? { strict: options.strict } : {}),
        ...(options.defaultValues ? { defaultValues: options.defaultValues } : {}),
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as API }
}

describe('initial validation seed — strict mode', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('strict mode + async refine degrades gracefully — form mounts cleanly', () => {
    // Regression: strict mode's seed pass calls `rootSchema.safeParse(data)`
    // synchronously, which throws when the schema contains an async refine
    // (zod's "Encountered Promise during synchronous parse"). The adapter
    // catches the throw and returns success so the form still mounts.
    // Without this fallback, strict-default useForm calls would crash
    // setup for any form using `z.string().refine(async ...)`.
    //
    // Async refines fire on the next microtask via the construction-
    // time async-validation seed (the runtime asks the schema's
    // `needsAsyncValidation()` and queues a full validation pass when
    // true). The synchronous post-mount assertion below still sees
    // `errors.email === undefined` — the microtask hasn't run yet at
    // this point.
    const asyncSchema = z.object({
      email: z.email().refine(async () => Promise.resolve(true), 'taken'),
    })
    type AsyncApi = ReturnType<typeof useForm<typeof asyncSchema>>
    const handle: { api?: AsyncApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: asyncSchema,
          key: 'init-seed-async',
          defaultValues: { email: '' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    expect(typeof handle.api?.register).toBe('function')
    expect(handle.api?.errors.email).toBeUndefined()
  })

  it('strict is the default — omitting strict populates schemaErrors', () => {
    // Pin: useForm({ schema, ... }) with no explicit strict flag
    // must resolve to 'strict'. Flipping the default back to 'lax'
    // would silently regress consumers who expect "errors are a pure
    // function of (value, schema) at all times."
    const { app, api } = mountWithZod({})
    apps.push(app)
    expect(api.errors.email?.[0]?.message).toBe('bad email')
    expect(api.errors.password?.[0]?.message).toBe('min 8 chars')
    expect(api.meta.isValid).toBe(false)
  })

  it('populates schemaErrors at construction when defaults fail validation', () => {
    const { app, api } = mountWithZod({ strict: true })
    apps.push(app)
    // Empty defaults: '' fails .email(), '' fails .min(8). Both errors
    // surface in fieldErrors before any user interaction.
    expect(api.errors.email?.[0]?.message).toBe('bad email')
    expect(api.errors.password?.[0]?.message).toBe('min 8 chars')
    expect(api.meta.isValid).toBe(false)
  })

  it('does NOT seed when defaults validate cleanly', () => {
    const { app, api } = mountWithZod({
      strict: true,
      defaultValues: { email: 'a@a.com', password: 'longenough' },
    })
    apps.push(app)
    expect(api.errors.email).toBeUndefined()
    expect(api.errors.password).toBeUndefined()
    expect(api.meta.isValid).toBe(true)
  })
})

describe('initial validation seed — async-refine schema', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  async function flushMicrotasks(rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      await Promise.resolve()
    }
  }

  async function waitFor<T>(
    fn: () => T | null | undefined,
    timeoutMs = 1000,
    intervalMs = 5
  ): Promise<T | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const v = fn()
      if (v !== null && v !== undefined) return v
      if (Date.now() >= deadline) return null
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }

  it('strict mode fires async refines on the next microtask (no user input required)', async () => {
    // Schema combines a sync constraint (`z.email()`) with an async
    // refine that rejects "taken@example.com". Default value is
    // `taken@example.com` — passes sync, fails refine. Pre-fix the
    // construction-time seed silently dropped the safeParse throw and
    // returned success, so the form looked valid until the user typed.
    // With `needsAsyncValidation()` detection, the runtime queues a
    // full async pass that lands the refine error on the next
    // microtask.
    const asyncSchema = z.object({
      email: z
        .email()
        .refine(async (v) => v !== 'taken@example.com', 'That email is already registered.'),
    })
    type AsyncApi = ReturnType<typeof useForm<typeof asyncSchema>>
    const handle: { api?: AsyncApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: asyncSchema,
          key: 'init-seed-async-fires',
          defaultValues: { email: 'taken@example.com' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    const api = handle.api
    if (api === undefined) throw new Error('unreachable')
    // Synchronously, the form looks valid — the async pass hasn't run.
    expect(api.errors.email).toBeUndefined()
    // After microtasks settle, the refine error lands.
    const message = await waitFor(() => api.errors.email?.[0]?.message ?? null)
    expect(message).toBe('That email is already registered.')
    expect(api.meta.isValid).toBe(false)
  })

  it('lax mode does NOT fire the construction-time async seed', async () => {
    // Lax mode opts out of construction-time validation (sync OR
    // async). The async-refine seed is gated to strict mode so lax
    // consumers continue to mount with a clean error state.
    const asyncSchema = z.object({
      email: z
        .email()
        .refine(async (v) => v !== 'taken@example.com', 'That email is already registered.'),
    })
    type AsyncApi = ReturnType<typeof useForm<typeof asyncSchema>>
    const handle: { api?: AsyncApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: asyncSchema,
          key: 'init-seed-async-lax',
          strict: false,
          defaultValues: { email: 'taken@example.com' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    const api = handle.api
    if (api === undefined) throw new Error('unreachable')
    await flushMicrotasks()
    expect(api.errors.email).toBeUndefined()
    expect(api.meta.isValid).toBe(true)
  })

  it('SSR pass does not schedule the async seed (isValidating stays false through microtasks)', async () => {
    // Hydration mismatch regression: pre-fix the construction-time async
    // seed fired synchronously on every createFormStore call, including
    // SSR. SSR's `renderToString` doesn't await microtasks, so the async
    // chain never completed server-side, but the synchronous
    // `activeValidations += 1` inside `scheduleFieldValidation` was
    // captured in the SSR HTML — `meta.isValidating` rendered as `true`,
    // emitting whatever indicator the template gated on it. The client
    // then took the hydration branch (which doesn't schedule the seed)
    // and rendered `false` on first render — Vue logged a hydration
    // mismatch on the indicator element.
    const asyncSchema = z.object({
      email: z.email().refine(async (v) => v !== 'taken@example.com', 'taken'),
    })
    type AsyncApi = ReturnType<typeof useForm<typeof asyncSchema>>
    const handle: { api?: AsyncApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: asyncSchema,
          key: 'init-seed-ssr',
          defaultValues: { email: 'taken@example.com' },
        })
        return () => h('div')
      },
    })
    // Override the registry to SSR mode — `createChemicalXForms({
    // override: true })` flips `detectSSR` to true, matching what
    // happens during a Nuxt server pass.
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    const api = handle.api
    if (api === undefined) throw new Error('unreachable')
    // Synchronously: no async seed scheduled, no indicator flash.
    expect(api.meta.isValidating).toBe(false)
    // After microtasks settle: still false. SSR never schedules the
    // pass, so the validation never fires server-side.
    await flushMicrotasks()
    expect(api.meta.isValidating).toBe(false)
    expect(api.errors.email).toBeUndefined()
  })

  it('CSR first render observes isValidating: false; async pass fires on next microtask', async () => {
    // Parity contract: client-side, the seed defers via `queueMicrotask`
    // so synchronous post-mount reads (matching what Vue's first-render
    // sees during hydration) observe `activeValidations: 0`. Without the
    // deferral, a CSR-only mount of an async-refine schema would flash
    // `isValidating: true` synchronously — and any SSR→CSR pair would
    // disagree on first-render output.
    const asyncSchema = z.object({
      email: z.email().refine(async (v) => v !== 'taken@example.com', 'taken'),
    })
    type AsyncApi = ReturnType<typeof useForm<typeof asyncSchema>>
    const handle: { api?: AsyncApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: asyncSchema,
          key: 'init-seed-csr-deferred',
          defaultValues: { email: 'taken@example.com' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    const api = handle.api
    if (api === undefined) throw new Error('unreachable')
    // Synchronous post-mount: queueMicrotask hasn't fired.
    expect(api.meta.isValidating).toBe(false)
    // After microtasks settle: pass ran, errors landed, validation done.
    await waitFor(() => api.errors.email?.[0]?.message ?? null)
    expect(api.meta.isValidating).toBe(false)
    expect(api.errors.email?.[0]?.message).toBe('taken')
  })

  it('sync schema in strict mode lands errors synchronously and isValidating stays false', () => {
    // Detection's load-bearing invariant: sync schemas don't pay a
    // construction-time async pass. Errors don't flicker either way
    // (`applySchemaErrorsForSubtree` runs sync and Vue batches per
    // microtask, so the wipe-then-apply window is invisible to a
    // render). The visible cost would be `meta.isValidating` flashing
    // true at mount for every sync form — `scheduleFieldValidation`
    // increments `activeValidations` synchronously when called, then
    // decrements after the async safeParseAsync resolves. That'd
    // misrepresent "validation is running" when nothing async is
    // actually pending. Skipping the schedule for sync schemas keeps
    // `isValidating` honestly false at construction.
    const syncSchema = z.object({ email: z.email('Invalid email') })
    type SyncApi = ReturnType<typeof useForm<typeof syncSchema>>
    const handle: { api?: SyncApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: syncSchema,
          key: 'init-seed-sync',
          defaultValues: { email: '' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    const api = handle.api
    if (api === undefined) throw new Error('unreachable')
    expect(api.errors.email?.[0]?.message).toBe('Invalid email')
    expect(api.meta.isValid).toBe(false)
    expect(api.meta.isValidating).toBe(false)
  })
})

describe('initial validation seed — lax mode', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does NOT populate schemaErrors at construction even when defaults fail', () => {
    // Lax mode is the explicit opt-out for the construction-time
    // schemaErrors seed: "best-effort defaults, no refinement
    // enforcement at mount." The schema here is two strings — neither
    // auto-marks blank (only numeric primitives do), so
    // `derivedBlankErrors` stays empty and the test reads the
    // schemaErrors-seed channel cleanly. A separate test in
    // derived-blank-errors.test.ts covers the reactive blank class
    // for numeric leaves.
    const { app, api } = mountWithZod({ strict: false })
    apps.push(app)
    expect(api.errors.email).toBeUndefined()
    expect(api.errors.password).toBeUndefined()
    expect(api.meta.isValid).toBe(true)
  })
})

describe('initial validation seed — hydration takes precedence', () => {
  it('skips the seed when hydration is provided (server is authoritative)', () => {
    // Hand-roll a fakeSchema whose getDefaultValues reports a failure
    // — proves the seed code path WOULD fire if hydration weren't
    // taking precedence. Hydration carries an explicit empty errors
    // slot, modelling "the server validated and decided it was OK."
    type Form = { email: string; password: string }
    const failingDefaultsSchema = fakeSchema<Form>({ email: '', password: '' })
    failingDefaultsSchema.getDefaultValues = (config) => ({
      data: {
        email: config.constraints?.email ?? '',
        password: config.constraints?.password ?? '',
      },
      errors: [
        { path: ['email'], message: 'seeded email error', formKey: 'hyd', code: 'cx:test-fixture' },
        {
          path: ['password'],
          message: 'seeded password error',
          formKey: 'hyd',
          code: 'cx:test-fixture',
        },
      ],
      success: false,
      formKey: 'hyd',
    })

    const state = createFormStore<Form>({
      formKey: 'hyd',
      schema: failingDefaultsSchema,
      strict: true,
      hydration: {
        form: { email: 'server@x.com', password: 'serverpw' },
        // Empty stores — hydration says the server saw a valid form.
        // The seed must NOT fire and overwrite this with the schema's
        // errors-on-empty-defaults.
        schemaErrors: [],
        userErrors: [],
        fields: [],
      },
    })

    expect(state.schemaErrors.size).toBe(0)
  })

  it('replays hydrated schema errors verbatim, ignoring the seed', () => {
    // Same schema (would seed two errors on empty defaults), but
    // hydration carries ONE error at a different path. The hydrated
    // shape wins — the seed doesn't get to add its own entries on top.
    type Form = { email: string; password: string }
    const failingDefaultsSchema = fakeSchema<Form>({ email: '', password: '' })
    failingDefaultsSchema.getDefaultValues = () => ({
      data: { email: '', password: '' },
      errors: [
        {
          path: ['email'],
          message: 'seed should not appear',
          formKey: 'hyd2',
          code: 'cx:test-fixture',
        },
        {
          path: ['password'],
          message: 'seed should not appear',
          formKey: 'hyd2',
          code: 'cx:test-fixture',
        },
      ],
      success: false,
      formKey: 'hyd2',
    })

    const onlyServerError = [
      {
        path: ['email'] as const,
        message: 'server email rejection',
        formKey: 'hyd2',
        code: 'api:validation',
      },
    ]
    const emailKey = canonicalizePath(['email']).key

    const state = createFormStore<Form>({
      formKey: 'hyd2',
      schema: failingDefaultsSchema,
      strict: true,
      hydration: {
        form: { email: 'a@a', password: 'irrelevant' },
        schemaErrors: [[emailKey, onlyServerError]],
        userErrors: [],
        fields: [],
      },
    })

    expect(state.schemaErrors.size).toBe(1)
    expect(state.schemaErrors.get(emailKey)?.[0]?.message).toBe('server email rejection')
  })
})
