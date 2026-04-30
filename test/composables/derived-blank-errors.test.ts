// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { unset } from '../../src/zod'
import { useForm } from '../../src/zod'
import { CxErrorCode } from '../../src/runtime/core/error-codes'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * Reactive `derivedBlankErrors` contract — the founding principle is
 * `errors = f(schema, state)`. The blank-required class is purely
 * derivable from `(blankPaths, schema.isRequiredAtPath)`, so it lives
 * on a reactive computed on the FormStore. The `errors` proxy and
 * `fieldState.<path>.errors` and `getErrorsForPath` all merge it in
 * alongside the imperatively-written `schemaErrors` (refinement) and
 * `userErrors` (server / manual) maps. The error appears the moment a
 * required path becomes blank, vanishes the moment it's filled — no
 * `validate()` / `handleSubmit` call required.
 *
 * The library is not responsible for rendering. The UI layer decides
 * when to show errors (e.g. gate on `fieldState.touched`); this file
 * only proves the data flows reactively from state.
 */

const tightSchema = z.object({
  email: z.string(),
  age: z.number(),
})
type TightApi = ReturnType<typeof useForm<typeof tightSchema>>

function mountTight(): { app: App; api: TightApi } {
  const handle: { api?: TightApi } = {}
  const App = defineComponent({
    setup() {
      // No `defaultValues` → every primitive leaf auto-marks blank at
      // construction. Required schema → both leaves should surface the
      // synthesised "No value supplied" error reactively, with no
      // validate() / submit() call.
      handle.api = useForm({ schema: tightSchema, key: 'derived-blank-tight' })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as TightApi }
}

describe('derivedBlankErrors — reactive at mount', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('populates errors[path] for every required+blank leaf at mount', () => {
    const { app, api } = mountTight()
    apps.push(app)

    expect(api.errors.email?.[0]?.message).toBe('No value supplied')
    expect(api.errors.email?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    expect(api.errors.age?.[0]?.message).toBe('No value supplied')
    expect(api.errors.age?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
  })

  it('isValid is false when derived blank errors exist', () => {
    const { app, api } = mountTight()
    apps.push(app)
    expect(api.state.isValid).toBe(false)
  })

  it('exposes the same errors via fieldState.<path>.errors', () => {
    const { app, api } = mountTight()
    apps.push(app)

    const emailState = api.fieldState.email
    expect(emailState.errors[0]?.message).toBe('No value supplied')
    expect(emailState.errors[0]?.code).toBe(CxErrorCode.NoValueSupplied)
  })
})

describe('derivedBlankErrors — vanishes on write, returns on clear', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writing a value removes the derived error reactively', async () => {
    const { app, api } = mountTight()
    apps.push(app)

    expect(api.errors.email?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    api.setValue('email', 'a@a.com')
    await nextTick()

    expect(api.errors.email).toBeUndefined()
  })

  it('writing `unset` re-adds the derived error reactively', async () => {
    const { app, api } = mountTight()
    apps.push(app)

    api.setValue('email', 'a@a.com')
    await nextTick()
    expect(api.errors.email).toBeUndefined()

    api.setValue('email', unset)
    await nextTick()
    expect(api.errors.email?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
  })

  it('isValid flips with the derived class', async () => {
    const { app, api } = mountTight()
    apps.push(app)

    expect(api.state.isValid).toBe(false)
    api.setValue('email', 'a@a.com')
    api.setValue('age', 30)
    await nextTick()
    expect(api.state.isValid).toBe(true)

    api.setValue('age', unset)
    await nextTick()
    expect(api.state.isValid).toBe(false)
  })
})

describe('derivedBlankErrors — schema modifiers gate the synthesis', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does NOT synthesise for `.optional()` leaves', () => {
    const schema = z.object({ note: z.string().optional() })
    type Api = ReturnType<typeof useForm<typeof schema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: 'derived-blank-optional' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    expect(handle.api?.errors.note).toBeUndefined()
    expect(handle.api?.state.isValid).toBe(true)
  })

  it('does NOT synthesise for `.nullable()` leaves', () => {
    const schema = z.object({ note: z.string().nullable() })
    type Api = ReturnType<typeof useForm<typeof schema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: 'derived-blank-nullable' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    expect(handle.api?.errors.note).toBeUndefined()
    expect(handle.api?.state.isValid).toBe(true)
  })

  it('does NOT synthesise for `.default(...)` leaves', () => {
    const schema = z.object({ note: z.string().default('') })
    type Api = ReturnType<typeof useForm<typeof schema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: 'derived-blank-default' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    expect(handle.api?.errors.note).toBeUndefined()
    expect(handle.api?.state.isValid).toBe(true)
  })

  it('does NOT synthesise when the consumer provides an explicit value', () => {
    type Api = ReturnType<typeof useForm<typeof tightSchema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: tightSchema,
          key: 'derived-blank-explicit-defaults',
          // Explicit non-blank defaults — `''` and `0` opt out of
          // auto-blank because the consumer signalled "this default is
          // intentional, not a placeholder."
          defaultValues: { email: '', age: 0 },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    expect(handle.api?.errors.email).toBeUndefined()
    expect(handle.api?.errors.age).toBeUndefined()
    expect(handle.api?.state.isValid).toBe(true)
  })
})

describe('derivedBlankErrors — independent of imperative writers', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('clearFieldErrors() does NOT remove derived errors (they re-derive from state)', async () => {
    const { app, api } = mountTight()
    apps.push(app)

    expect(api.errors.email?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    api.clearFieldErrors('email')
    await nextTick()
    // Derived class is a pure function of state — clearing the
    // imperative stores can't make it go away. Only changing the
    // underlying state (filling the field) does.
    expect(api.errors.email?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
  })

  it('setFieldErrors at the same path coexists with derived', async () => {
    const { app, api } = mountTight()
    apps.push(app)

    api.setFieldErrors([
      {
        path: ['email'],
        message: 'taken',
        formKey: api.key,
        code: 'api:duplicate',
      },
    ])
    await nextTick()

    const emailErrors = api.errors.email ?? []
    // Order: schema → derived → user.
    expect(emailErrors).toHaveLength(2)
    expect(emailErrors[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    expect(emailErrors[1]?.code).toBe('api:duplicate')
  })

  it('schemaErrors-class refinement coexists with derived', async () => {
    const refineSchema = z.object({
      email: z.string().refine((v) => v.includes('@'), 'must contain @'),
    })
    type Api = ReturnType<typeof useForm<typeof refineSchema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: refineSchema,
          key: 'derived-blank-coexist-refine',
          // strict mode + auto-blank → at construction, schemaErrors
          // gets the refinement entry AND derivedBlankErrors gets the
          // synthesised entry. Both should appear in errors[email].
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    const emailErrors = handle.api?.errors.email ?? []
    expect(emailErrors.length).toBeGreaterThanOrEqual(2)
    // Schema (refinement) first, derived second.
    expect(emailErrors.some((e) => e.message === 'must contain @')).toBe(true)
    expect(emailErrors.some((e) => e.code === CxErrorCode.NoValueSupplied)).toBe(true)
  })
})

describe('derivedBlankErrors — lifecycle integration', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('validateAsync() response includes the derived class', async () => {
    const { app, api } = mountTight()
    apps.push(app)

    const result = await api.validateAsync()
    expect(result.success).toBe(false)
    expect(result.errors?.some((e) => e.code === CxErrorCode.NoValueSupplied)).toBe(true)
  })

  it('handleSubmit blocks when derived blank errors exist', async () => {
    const { app, api } = mountTight()
    apps.push(app)

    let submitted = false
    let onErrorCalled = false
    let onErrorPayload: unknown = null
    const handler = api.handleSubmit(
      () => {
        submitted = true
      },
      (errors) => {
        onErrorCalled = true
        onErrorPayload = errors
      }
    )
    await handler()

    expect(submitted).toBe(false)
    expect(onErrorCalled).toBe(true)
    const errors = onErrorPayload as Array<{ code: string }>
    expect(errors.some((e) => e.code === CxErrorCode.NoValueSupplied)).toBe(true)
  })

  it('handleSubmit succeeds once every blank-required path is filled', async () => {
    const { app, api } = mountTight()
    apps.push(app)

    api.setValue('email', 'a@a.com')
    api.setValue('age', 30)
    await nextTick()

    let submitted = false
    const handler = api.handleSubmit(() => {
      submitted = true
    })
    await handler()

    expect(submitted).toBe(true)
    expect(api.errors.email).toBeUndefined()
    expect(api.errors.age).toBeUndefined()
  })
})
