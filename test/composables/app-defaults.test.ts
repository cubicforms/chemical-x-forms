// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm as useFormV3 } from '../../src/zod-v3'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'
import { useForm } from '../../src/zod'
import { z as zV3 } from 'zod-v3'

/**
 * App-level defaults: `createChemicalXForms({ defaults: ... })` lets
 * consumers configure cx-wide preferences once. Per-form options
 * always win.
 *
 * Invariants locked here:
 *   1. Default applied when per-form omits the option.
 *   2. Per-form value wins for each scalar.
 *   3. `fieldValidation` shallow-merges at the field level
 *      (consumer can set `debounceMs` globally and override `on`
 *      per-form without losing the global debounce).
 *   4. Anonymous `useForm()` (no key) picks up defaults.
 *   5. Multiple useForm calls in the same app share the defaults.
 *   6. v3 wrapper picks up app-level `validationMode` (regression
 *      lock for the dropped `?? 'strict'` resolution).
 */

const tightSchema = z.object({
  email: z.email('bad email'),
  password: z.string().min(8, 'min 8 chars'),
})

type Tight = z.infer<typeof tightSchema>
type API = ReturnType<typeof useForm<typeof tightSchema>>

function mountWithDefaults(
  defaults: Parameters<typeof createChemicalXForms>[0] extends infer T
    ? T extends { defaults?: infer D }
      ? D
      : never
    : never,
  formOptions: {
    validationMode?: 'strict' | 'lax'
    fieldValidation?: { on?: 'change' | 'blur' | 'none'; debounceMs?: number }
    defaultValues?: Partial<Tight>
    key?: string
  } = {}
): { app: App; api: API } {
  const handle: { api?: API } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: tightSchema,
        ...(formOptions.key !== undefined ? { key: formOptions.key } : {}),
        ...(formOptions.validationMode !== undefined
          ? { validationMode: formOptions.validationMode }
          : {}),
        ...(formOptions.fieldValidation !== undefined
          ? { fieldValidation: formOptions.fieldValidation }
          : {}),
        ...(formOptions.defaultValues !== undefined
          ? { defaultValues: formOptions.defaultValues }
          : {}),
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(
    createChemicalXForms({
      override: true,
      ...(defaults !== undefined ? { defaults } : {}),
    })
  )
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as API }
}

async function drainMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('app-level defaults — validationMode', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("applies the registry's default when per-form omits validationMode", () => {
    // Default is 'lax'; without per-form override the form should NOT
    // seed schemaErrors at construction (lax behavior), even though
    // empty defaults fail .email() / .min(8). Without app-level
    // defaults the library would have applied 'strict' and seeded the
    // errors.
    const { app, api } = mountWithDefaults({ validationMode: 'lax' }, {})
    apps.push(app)
    expect(api.fieldErrors.email).toBeUndefined()
    expect(api.fieldErrors.password).toBeUndefined()
    expect(api.state.isValid).toBe(true)
  })

  it('per-form validationMode wins over the registry default', () => {
    // Registry says 'lax', but per-form says 'strict' — strict wins,
    // errors get seeded.
    const { app, api } = mountWithDefaults({ validationMode: 'lax' }, { validationMode: 'strict' })
    apps.push(app)
    expect(api.fieldErrors.email?.[0]?.message).toBe('bad email')
    expect(api.fieldErrors.password?.[0]?.message).toBe('min 8 chars')
    expect(api.state.isValid).toBe(false)
  })

  it('falls back to library default (strict) when neither registry nor per-form sets it', () => {
    // No registry default for validationMode → library fallback in
    // createFormStore applies → 'strict' → seed fires.
    const { app, api } = mountWithDefaults({}, {})
    apps.push(app)
    expect(api.fieldErrors.email?.[0]?.message).toBe('bad email')
    expect(api.state.isValid).toBe(false)
  })
})

describe('app-level defaults — fieldValidation field-level merge', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    vi.useRealTimers()
  })

  it('per-form on overrides while default debounceMs carries through', async () => {
    // Default sets debounceMs = 50. Per-form passes only { on: 'change' }
    // — the merged config should be { on: 'change', debounceMs: 50 }.
    // Pin lax so the construction-time seed doesn't pre-populate the
    // error we're trying to observe via debounced field-validation.
    vi.useFakeTimers()
    const { app, api } = mountWithDefaults(
      { fieldValidation: { debounceMs: 50 } },
      { fieldValidation: { on: 'change' }, validationMode: 'lax' }
    )
    apps.push(app)

    api.setValue('email', 'not-an-email')
    // Just past the default debounce (50ms). If the per-form `on:
    // 'change'` didn't merge correctly with the default debounceMs,
    // the test would either see no error (debounce never fired) or
    // need to wait the library default (125ms).
    await vi.advanceTimersByTimeAsync(75)
    await drainMicrotasks()
    expect(api.fieldErrors.email?.[0]?.message).toBe('bad email')
  })

  it('per-form debounceMs overrides default debounceMs', async () => {
    vi.useFakeTimers()
    const { app, api } = mountWithDefaults(
      { fieldValidation: { on: 'change', debounceMs: 500 } },
      { fieldValidation: { debounceMs: 25 }, validationMode: 'lax' }
    )
    apps.push(app)

    api.setValue('email', 'nope')
    // Per-form debounceMs wins → 25ms, not 500ms.
    await vi.advanceTimersByTimeAsync(40)
    await drainMicrotasks()
    expect(api.fieldErrors.email?.[0]?.message).toBe('bad email')
  })

  it("default fieldValidation applies entirely when per-form doesn't pass any", async () => {
    vi.useFakeTimers()
    const { app, api } = mountWithDefaults(
      { fieldValidation: { on: 'change', debounceMs: 30 } },
      { validationMode: 'lax' }
    )
    apps.push(app)

    api.setValue('password', 'x')
    await vi.advanceTimersByTimeAsync(50)
    await drainMicrotasks()
    expect(api.fieldErrors.password?.[0]?.message).toBe('min 8 chars')
  })
})

describe('app-level defaults — anonymous + multi-form', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('anonymous useForm() (no key) picks up app-level defaults', () => {
    // No `key` passed → synthetic `cx:anon:` key allocated; defaults
    // should still apply.
    const { app, api } = mountWithDefaults({ validationMode: 'lax' }, {})
    apps.push(app)
    expect(api.fieldErrors.email).toBeUndefined()
    // Sanity: this anonymous form's key starts with the reserved prefix.
    expect(api.key.startsWith('cx:anon:')).toBe(true)
  })

  it('multiple useForm calls in the same app share the same defaults', () => {
    // Two forms in one component, no per-form validationMode override
    // — both should pick up the registry's 'lax' and BOTH should mount
    // clean (no seeded errors).
    type FormA = typeof tightSchema
    type FormB = typeof tightSchema
    const handles: {
      a?: ReturnType<typeof useForm<FormA>>
      b?: ReturnType<typeof useForm<FormB>>
    } = {}
    const App = defineComponent({
      setup() {
        handles.a = useForm({ schema: tightSchema, key: 'shared-defaults-a' })
        handles.b = useForm({ schema: tightSchema, key: 'shared-defaults-b' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(
      createChemicalXForms({ override: true, defaults: { validationMode: 'lax' } })
    )
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    expect(handles.a?.fieldErrors.email).toBeUndefined()
    expect(handles.b?.fieldErrors.email).toBeUndefined()
  })
})

describe('app-level defaults — v3 wrapper regression', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('zod v3 useForm picks up app-level validationMode (no eager ?? strict short-circuit)', () => {
    // Regression lock for the dropped `validationMode: configuration.
    // validationMode ?? 'strict'` line in src/runtime/composables/
    // use-form.ts. Before the fix, the v3 wrapper would resolve `'strict'`
    // before the merge could see the registry default — so an app-level
    // `validationMode: 'lax'` would be silently overridden.
    const v3Schema = zV3.object({
      email: zV3.string().email(),
      password: zV3.string().min(8),
    })
    type V3Form = { email: string; password: string }
    type V3API = UseAbstractFormReturnType<V3Form, V3Form>
    const handle: { api?: V3API } = {}
    const App = defineComponent({
      setup() {
        handle.api = useFormV3({
          schema: v3Schema,
          key: 'v3-defaults',
        } as never) as V3API
        return () => h('div')
      },
    })
    const app = createApp(App).use(
      createChemicalXForms({ override: true, defaults: { validationMode: 'lax' } })
    )
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    // Lax → no construction-time seed → fieldErrors empty.
    expect(handle.api?.fieldErrors.email).toBeUndefined()
    expect(handle.api?.fieldErrors.password).toBeUndefined()
  })
})
