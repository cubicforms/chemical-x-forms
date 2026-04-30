// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { unset } from '../../src/zod'
import { useForm } from '../../src/zod'
import { CxErrorCode } from '../../src/runtime/core/error-codes'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * Reactive `derivedBlankErrors` contract — `errors = f(schema, state)`.
 *
 * The blank-required class is purely derivable from
 * `(blankPaths, schema.isRequiredAtPath)`, so it lives on the
 * FormStore as a reactive computed. The `errors` proxy,
 * `fields.<path>.errors`, and `getErrorsForPath` all merge it in
 * alongside `schemaErrors` (refinement, written by validation) and
 * `userErrors` (server / manual). The error appears the moment a
 * required path becomes blank, vanishes the moment it's filled — no
 * `validate()` / `handleSubmit` call required.
 *
 * Auto-mark for `blankPaths` is **numeric-only**: `number` and
 * `bigint` leaves where storage and DOM display diverge. Strings and
 * booleans don't auto-mark — the schema is the authority on whether
 * `''` / `false` is acceptable. Explicit `unset` is the universal
 * opt-in for any primitive type. See `docs/blank.md` for the full
 * conceptual model.
 *
 * The library is not responsible for rendering. The UI layer decides
 * when to show errors (e.g. gate on `fields.touched`); this file
 * only proves the data flows reactively from state.
 */

const numericSchema = z.object({
  income: z.number(),
  netWorth: z.bigint(),
})
type NumericApi = ReturnType<typeof useForm<typeof numericSchema>>

function mountNumeric(): { app: App; api: NumericApi } {
  const handle: { api?: NumericApi } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({ schema: numericSchema, key: 'derived-blank-numeric' })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as NumericApi }
}

describe('derivedBlankErrors — auto-mark fires for numeric primitives', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('populates errors[path] for every required+blank numeric leaf at mount', () => {
    const { app, api } = mountNumeric()
    apps.push(app)

    // `income` is `z.number()` (slim default `0`, DOM input `''`) —
    // storage / display diverge, blank auto-marks, derived error fires.
    expect(api.errors.income?.[0]?.message).toBe('No value supplied')
    expect(api.errors.income?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    // `netWorth` is `z.bigint()` (slim default `0n`, DOM input `''`) —
    // same divergence, same auto-mark.
    expect(api.errors.netWorth?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
  })

  it('isValid is false when derived blank errors exist', () => {
    const { app, api } = mountNumeric()
    apps.push(app)
    expect(api.state.isValid).toBe(false)
  })

  it('exposes the same errors via fields.<path>.errors', () => {
    const { app, api } = mountNumeric()
    apps.push(app)

    expect(api.fields.income.errors[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    expect(api.fields.income.blank).toBe(true)
  })

  it('writing a value removes the derived error reactively', async () => {
    const { app, api } = mountNumeric()
    apps.push(app)

    expect(api.errors.income?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    api.setValue('income', 50_000)
    await nextTick()
    expect(api.errors.income).toBeUndefined()
  })

  it('writing `unset` re-adds the derived error reactively', async () => {
    const { app, api } = mountNumeric()
    apps.push(app)

    api.setValue('income', 50_000)
    await nextTick()
    expect(api.errors.income).toBeUndefined()

    api.setValue('income', unset)
    await nextTick()
    expect(api.errors.income?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
  })

  it('isValid flips with the derived class', async () => {
    const { app, api } = mountNumeric()
    apps.push(app)

    expect(api.state.isValid).toBe(false)
    api.setValue('income', 0)
    api.setValue('netWorth', 0n)
    await nextTick()
    expect(api.state.isValid).toBe(true)

    api.setValue('income', unset)
    await nextTick()
    expect(api.state.isValid).toBe(false)
  })
})

describe('derivedBlankErrors — string / boolean leaves do NOT auto-mark', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("required string leaf is blank-free at mount (storage `''` matches DOM `''`)", () => {
    const schema = z.object({ name: z.string() })
    type Api = ReturnType<typeof useForm<typeof schema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: 'no-auto-mark-string' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    expect(handle.api?.errors.name).toBeUndefined()
    expect(handle.api?.fields.name.blank).toBe(false)
    expect(handle.api?.state.isValid).toBe(true)
  })

  it('required boolean leaf is blank-free at mount (storage `false` matches unchecked)', () => {
    const schema = z.object({ agreed: z.boolean() })
    type Api = ReturnType<typeof useForm<typeof schema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: 'no-auto-mark-boolean' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    expect(handle.api?.errors.agreed).toBeUndefined()
    expect(handle.api?.fields.agreed.blank).toBe(false)
    expect(handle.api?.state.isValid).toBe(true)
  })

  it('user typing then deleting a string does NOT re-blank (schema is authority)', async () => {
    const schema = z.object({ name: z.string() })
    type Api = ReturnType<typeof useForm<typeof schema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: 'string-typed-deleted' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    // Lifecycle: mount → type "A" → delete back to "". The schema
    // (`z.string()`) accepts `''` as a valid string; the runtime does
    // NOT inject a "required string must be non-empty" rule that the
    // schema author didn't write. If the consumer wants non-empty
    // required, that's `z.string().min(1)` — a refinement error, not
    // a blank error.
    handle.api?.setValue('name', 'A')
    await nextTick()
    expect(handle.api?.errors.name).toBeUndefined()

    handle.api?.setValue('name', '')
    await nextTick()
    expect(handle.api?.errors.name).toBeUndefined()
    expect(handle.api?.fields.name.blank).toBe(false)
    expect(handle.api?.state.isValid).toBe(true)
  })

  it('explicit `unset` opts a string into blank (universal opt-in)', () => {
    const schema = z.object({ note: z.string() })
    type Api = ReturnType<typeof useForm<typeof schema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: 'explicit-unset-string',
          defaultValues: { note: unset },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    expect(handle.api?.errors.note?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    expect(handle.api?.fields.note.blank).toBe(true)
  })

  it('explicit `unset` opts a boolean into blank (universal opt-in)', () => {
    const schema = z.object({ agreed: z.boolean() })
    type Api = ReturnType<typeof useForm<typeof schema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: 'explicit-unset-boolean',
          defaultValues: { agreed: unset },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    expect(handle.api?.errors.agreed?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    expect(handle.api?.fields.agreed.blank).toBe(true)
  })

  it('schema-level non-empty rule (`.min(1)`) fires through schemaErrors, not blank', async () => {
    const schema = z.object({ name: z.string().min(1, 'name required') })
    type Api = ReturnType<typeof useForm<typeof schema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({ schema, key: 'min-1-refinement' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    // strict mode (default) seeds schemaErrors with the refinement
    // failure for `''`. blank stays false — the schema is the
    // authority on what "non-empty required" means.
    expect(handle.api?.errors.name?.[0]?.message).toBe('name required')
    expect(handle.api?.errors.name?.[0]?.code).not.toBe(CxErrorCode.NoValueSupplied)
    expect(handle.api?.fields.name.blank).toBe(false)
  })
})

describe('derivedBlankErrors — schema modifiers gate the synthesis', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does NOT synthesise for `.optional()` numeric leaves', () => {
    const schema = z.object({ income: z.number().optional() })
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

    expect(handle.api?.errors.income).toBeUndefined()
    expect(handle.api?.state.isValid).toBe(true)
  })

  it('does NOT synthesise for `.nullable()` numeric leaves', () => {
    const schema = z.object({ income: z.number().nullable() })
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

    expect(handle.api?.errors.income).toBeUndefined()
    expect(handle.api?.state.isValid).toBe(true)
  })

  it('does NOT synthesise for `.default(N)` numeric leaves', () => {
    const schema = z.object({ income: z.number().default(0) })
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

    expect(handle.api?.errors.income).toBeUndefined()
    expect(handle.api?.state.isValid).toBe(true)
  })

  it('does NOT synthesise when the consumer provides an explicit value', () => {
    type Api = ReturnType<typeof useForm<typeof numericSchema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: numericSchema,
          key: 'derived-blank-explicit-defaults',
          // Explicit values opt out of auto-blank — the consumer
          // signalled "this default is intentional, not a placeholder."
          defaultValues: { income: 0, netWorth: 0n },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    expect(handle.api?.errors.income).toBeUndefined()
    expect(handle.api?.errors.netWorth).toBeUndefined()
    expect(handle.api?.state.isValid).toBe(true)
  })
})

describe('derivedBlankErrors — independent of imperative writers', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('clearFieldErrors() does NOT remove derived errors (they re-derive from state)', async () => {
    const { app, api } = mountNumeric()
    apps.push(app)

    expect(api.errors.income?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    api.clearFieldErrors('income')
    await nextTick()
    // Derived class is a pure function of state — clearing the
    // imperative stores can't make it go away. Only changing the
    // underlying state (filling the field) does.
    expect(api.errors.income?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
  })

  it('setFieldErrors at the same path coexists with derived', async () => {
    const { app, api } = mountNumeric()
    apps.push(app)

    api.setFieldErrors([
      {
        path: ['income'],
        message: 'too low',
        formKey: api.key,
        code: 'api:tooLow',
      },
    ])
    await nextTick()

    const incomeErrors = api.errors.income ?? []
    // Order: schema → derived → user.
    expect(incomeErrors).toHaveLength(2)
    expect(incomeErrors[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    expect(incomeErrors[1]?.code).toBe('api:tooLow')
  })

  it('schemaErrors-class refinement coexists with derived', () => {
    const refineSchema = z.object({
      income: z.number().refine((v) => v > 1000, 'must be > 1000'),
    })
    type Api = ReturnType<typeof useForm<typeof refineSchema>>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: refineSchema,
          key: 'derived-blank-coexist-refine',
          // strict mode + auto-blank → at construction, schemaErrors
          // gets the refinement entry (0 fails > 1000) AND
          // derivedBlankErrors gets the synthesised entry. Both
          // should appear in errors.income.
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    const incomeErrors = handle.api?.errors.income ?? []
    expect(incomeErrors.length).toBeGreaterThanOrEqual(2)
    // Schema (refinement) first, derived second.
    expect(incomeErrors.some((e) => e.message === 'must be > 1000')).toBe(true)
    expect(incomeErrors.some((e) => e.code === CxErrorCode.NoValueSupplied)).toBe(true)
  })
})

describe('derivedBlankErrors — lifecycle integration', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('validateAsync() response includes the derived class', async () => {
    const { app, api } = mountNumeric()
    apps.push(app)

    const result = await api.validateAsync()
    expect(result.success).toBe(false)
    expect(result.errors?.some((e) => e.code === CxErrorCode.NoValueSupplied)).toBe(true)
  })

  it('handleSubmit blocks when derived blank errors exist', async () => {
    const { app, api } = mountNumeric()
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
    const { app, api } = mountNumeric()
    apps.push(app)

    api.setValue('income', 50_000)
    api.setValue('netWorth', 100_000n)
    await nextTick()

    let submitted = false
    const handler = api.handleSubmit(() => {
      submitted = true
    })
    await handler()

    expect(submitted).toBe(true)
    expect(api.errors.income).toBeUndefined()
    expect(api.errors.netWorth).toBeUndefined()
  })
})
