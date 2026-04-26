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

function mountWithZod(options: {
  validationMode?: 'strict' | 'lax'
  defaultValues?: Partial<Tight>
}): { app: App; api: ReturnType<typeof useForm<typeof tightSchema>> } {
  type API = ReturnType<typeof useForm<typeof tightSchema>>
  const handle: { api?: API } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: tightSchema,
        key: 'init-seed',
        ...(options.validationMode ? { validationMode: options.validationMode } : {}),
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

  it('populates schemaErrors at construction when defaults fail validation', () => {
    const { app, api } = mountWithZod({ validationMode: 'strict' })
    apps.push(app)
    // Empty defaults: '' fails .email(), '' fails .min(8). Both errors
    // surface in fieldErrors before any user interaction.
    expect(api.fieldErrors.email?.[0]?.message).toBe('bad email')
    expect(api.fieldErrors.password?.[0]?.message).toBe('min 8 chars')
    expect(api.state.isValid).toBe(false)
  })

  it('does NOT seed when defaults validate cleanly', () => {
    const { app, api } = mountWithZod({
      validationMode: 'strict',
      defaultValues: { email: 'a@a.com', password: 'longenough' },
    })
    apps.push(app)
    expect(api.fieldErrors.email).toBeUndefined()
    expect(api.fieldErrors.password).toBeUndefined()
    expect(api.state.isValid).toBe(true)
  })
})

describe('initial validation seed — lax mode', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does NOT populate schemaErrors at construction even when defaults fail', () => {
    // Lax mode is the explicit opt-out: "best-effort defaults, no
    // construction-time enforcement." A consumer who picked lax would
    // be surprised to see errors before they've touched anything.
    const { app, api } = mountWithZod({ validationMode: 'lax' })
    apps.push(app)
    expect(api.fieldErrors.email).toBeUndefined()
    expect(api.fieldErrors.password).toBeUndefined()
    expect(api.state.isValid).toBe(true)
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
        { path: ['email'], message: 'seeded email error', formKey: 'hyd' },
        { path: ['password'], message: 'seeded password error', formKey: 'hyd' },
      ],
      success: false,
      formKey: 'hyd',
    })

    const state = createFormStore<Form>({
      formKey: 'hyd',
      schema: failingDefaultsSchema,
      validationMode: 'strict',
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
        { path: ['email'], message: 'seed should not appear', formKey: 'hyd2' },
        { path: ['password'], message: 'seed should not appear', formKey: 'hyd2' },
      ],
      success: false,
      formKey: 'hyd2',
    })

    const onlyServerError = [
      { path: ['email'] as const, message: 'server email rejection', formKey: 'hyd2' },
    ]
    const emailKey = canonicalizePath(['email']).key

    const state = createFormStore<Form>({
      formKey: 'hyd2',
      schema: failingDefaultsSchema,
      validationMode: 'strict',
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
