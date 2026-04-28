// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { CxErrorCode } from '../../src/runtime/core/error-codes'
import { canonicalizePath } from '../../src/runtime/core/paths'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'

/**
 * `handleSubmit` / `validate` / `validateAsync` synthesise a "Required"
 * error for every path in the form's `transientEmptyPaths` set whose
 * schema is required (no `.optional()` / `.nullable()` / `.default()` /
 * `.catch()` wrapper). This is the public-housing footgun fix: a user
 * who didn't answer "what is your income?" must NOT silently submit
 * `$0` and pass validation.
 *
 * The set is populated through the FormStore's `setValueAtPath` gate-
 * hook (commit 2 plumbs it; commit 5 wires the directive's input
 * listener to mark on numeric clear, commit 7 adds the `unset` symbol
 * for declarative / imperative API). These tests exercise the
 * augmentation layer directly via the runtime channel so they're
 * independent of the directive / API wiring.
 */

function setupForm<F extends z.ZodObject<Record<string, z.ZodType>>>(schema: F) {
  let captured!: UseAbstractFormReturnType<z.output<F> & Record<string, unknown>>
  const Probe = defineComponent({
    setup() {
      captured = useForm({
        schema,
        key: `req-empty-${Math.random().toString(36).slice(2)}`,
      }) as unknown as UseAbstractFormReturnType<z.output<F> & Record<string, unknown>>
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  attachRegistryToApp(app, createRegistry())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('handleSubmit — required-empty raises a synthesised error', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('raises "Required" for a transient-empty z.number() path', async () => {
    const schema = z.object({
      income: z.number(),
      name: z.string(),
      agreedToTerms: z.boolean(),
    })
    const { app, form } = setupForm(schema)
    apps.push(app)

    const incomeKey = canonicalizePath('income').key
    // Mark income as transient-empty via the runtime channel.
    // setValueWithInternalPath isn't exposed; call setValueAtPath
    // directly through the form store via setValue's leaf form +
    // a meta-aware injector. For this test we reach into the store
    // — the directive wiring lands in commit 5.
    // Since `setValue` doesn't accept WriteMeta, drop a path into
    // the set directly via the reactive interface.
    const Probe = (app as unknown as { _instance?: { proxy?: unknown } })._instance
    expect(Probe).toBeDefined()
    // Better path: register a hook that calls the gate via the
    // RegisterValue.setValueWithInternalPath. The register binding
    // exposes that internal method to the directive — we use it
    // here as a back door.
    const binding = form.register('income') as unknown as {
      setValueWithInternalPath: (
        v: unknown,
        meta?: { transientEmpty?: boolean; persist?: boolean }
      ) => boolean
    }
    binding.setValueWithInternalPath(0, { transientEmpty: true })

    const onSubmit = vi.fn()
    const onError = vi.fn()
    const handler = form.handleSubmit(onSubmit, onError)
    await handler()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    const errors = onError.mock.calls[0]?.[0] as Array<{
      message: string
      code: string
      path: unknown[]
    }>
    const requiredErr = errors.find((e) => e.code === CxErrorCode.NoValueSupplied)
    expect(requiredErr).toBeDefined()
    expect(requiredErr?.path).toEqual(['income'])
    // Anchor the human-readable message once; downstream tests assert on `code`.
    expect(requiredErr?.message).toBe('No value supplied')
    expect(form.fieldErrors['income']?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
    void incomeKey
  })

  it('does NOT raise for an optional path even when transient-empty', async () => {
    const schema = z.object({
      income: z.number().optional(),
    })
    const { app, form } = setupForm(schema)
    apps.push(app)

    const binding = form.register('income') as unknown as {
      setValueWithInternalPath: (v: unknown, meta?: { transientEmpty?: boolean }) => boolean
    }
    binding.setValueWithInternalPath(undefined, { transientEmpty: true })

    const onSubmit = vi.fn()
    const onError = vi.fn()
    const handler = form.handleSubmit(onSubmit, onError)
    await handler()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('does NOT raise for a .default(N) path even when transient-empty', async () => {
    const schema = z.object({
      income: z.number().default(0),
    })
    const { app, form } = setupForm(schema)
    apps.push(app)

    const binding = form.register('income') as unknown as {
      setValueWithInternalPath: (v: unknown, meta?: { transientEmpty?: boolean }) => boolean
    }
    binding.setValueWithInternalPath(0, { transientEmpty: true })

    const onSubmit = vi.fn()
    const onError = vi.fn()
    const handler = form.handleSubmit(onSubmit, onError)
    await handler()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('does NOT raise for a .nullable() path even when transient-empty', async () => {
    const schema = z.object({
      income: z.number().nullable(),
    })
    const { app, form } = setupForm(schema)
    apps.push(app)

    const binding = form.register('income') as unknown as {
      setValueWithInternalPath: (v: unknown, meta?: { transientEmpty?: boolean }) => boolean
    }
    binding.setValueWithInternalPath(null, { transientEmpty: true })

    const onSubmit = vi.fn()
    const onError = vi.fn()
    const handler = form.handleSubmit(onSubmit, onError)
    await handler()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('raises "Required" for required strings (public-housing applies to non-numeric leaves)', async () => {
    const schema = z.object({
      name: z.string(),
    })
    const { app, form } = setupForm(schema)
    apps.push(app)

    const binding = form.register('name') as unknown as {
      setValueWithInternalPath: (v: unknown, meta?: { transientEmpty?: boolean }) => boolean
    }
    binding.setValueWithInternalPath('', { transientEmpty: true })

    const onSubmit = vi.fn()
    const onError = vi.fn()
    const handler = form.handleSubmit(onSubmit, onError)
    await handler()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    const errors = onError.mock.calls[0]?.[0] as Array<{
      code: string
      path: unknown[]
    }>
    expect(errors.some((e) => e.code === CxErrorCode.NoValueSupplied && e.path[0] === 'name')).toBe(
      true
    )
  })

  it('raises "Required" for required booleans', async () => {
    const schema = z.object({
      agreed: z.boolean(),
    })
    const { app, form } = setupForm(schema)
    apps.push(app)

    const binding = form.register('agreed') as unknown as {
      setValueWithInternalPath: (v: unknown, meta?: { transientEmpty?: boolean }) => boolean
    }
    binding.setValueWithInternalPath(false, { transientEmpty: true })

    const onSubmit = vi.fn()
    const onError = vi.fn()
    const handler = form.handleSubmit(onSubmit, onError)
    await handler()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

describe('validateAsync — surfaces required-empty errors', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('reports "Required" in the errors array', async () => {
    const schema = z.object({ income: z.number() })
    const { app, form } = setupForm(schema)
    apps.push(app)

    const binding = form.register('income') as unknown as {
      setValueWithInternalPath: (v: unknown, meta?: { transientEmpty?: boolean }) => boolean
    }
    binding.setValueWithInternalPath(0, { transientEmpty: true })

    const result = await form.validateAsync()
    expect(result.success).toBe(false)
    const errors = result.errors ?? []
    expect(
      errors.some((e) => e.code === CxErrorCode.NoValueSupplied && e.path[0] === 'income')
    ).toBe(true)
  })

  it('per-path validate(path) only contributes paths inside the scope', async () => {
    const schema = z.object({
      income: z.number(),
      name: z.string(),
    })
    const { app, form } = setupForm(schema)
    apps.push(app)

    const incomeBinding = form.register('income') as unknown as {
      setValueWithInternalPath: (v: unknown, meta?: { transientEmpty?: boolean }) => boolean
    }
    const nameBinding = form.register('name') as unknown as {
      setValueWithInternalPath: (v: unknown, meta?: { transientEmpty?: boolean }) => boolean
    }
    incomeBinding.setValueWithInternalPath(0, { transientEmpty: true })
    nameBinding.setValueWithInternalPath('', { transientEmpty: true })

    // Validate just the income subtree — the name's required-empty
    // error should NOT contribute (different path scope).
    const result = await form.validateAsync('income')
    expect(result.success).toBe(false)
    const errors = result.errors ?? []
    const paths = errors.map((e) => e.path[0])
    expect(paths).toContain('income')
    expect(paths).not.toContain('name')
  })
})

describe('public-housing scenario', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('forgetting to answer income on a required z.number() fails the submit with Required', async () => {
    const schema = z.object({
      income: z.number(),
      name: z.string(),
      agreedToTerms: z.boolean(),
    })
    const { app, form } = setupForm(schema)
    apps.push(app)

    // Simulate the user opening the form and immediately clicking
    // submit. The directive (commit 5) marks transient-empty on
    // numeric clear; here we mark income directly to mirror the
    // user's "didn't type anything" state.
    const incomeBinding = form.register('income') as unknown as {
      setValueWithInternalPath: (v: unknown, meta?: { transientEmpty?: boolean }) => boolean
    }
    incomeBinding.setValueWithInternalPath(0, { transientEmpty: true })

    // Fill in name + agreedToTerms so the only error is Required on income.
    form.setValue('name', 'alice')
    form.setValue('agreedToTerms', true)

    const onSubmit = vi.fn()
    const onError = vi.fn()
    const handler = form.handleSubmit(onSubmit, onError)
    await handler()

    expect(onSubmit).not.toHaveBeenCalled()
    const errors = onError.mock.calls[0]?.[0] as Array<{
      code: string
      path: unknown[]
    }>
    const incomeErrors = errors.filter((e) => e.path[0] === 'income')
    expect(incomeErrors.length).toBe(1)
    expect(incomeErrors[0]?.code).toBe(CxErrorCode.NoValueSupplied)
  })

  it('the same form with z.number().optional() submits cleanly with `undefined` storage', async () => {
    const schema = z.object({
      income: z.number().optional(),
      name: z.string(),
    })
    const { app, form } = setupForm(schema)
    apps.push(app)

    const incomeBinding = form.register('income') as unknown as {
      setValueWithInternalPath: (v: unknown, meta?: { transientEmpty?: boolean }) => boolean
    }
    incomeBinding.setValueWithInternalPath(undefined, { transientEmpty: true })
    form.setValue('name', 'alice')

    const onSubmit = vi.fn()
    const onError = vi.fn()
    const handler = form.handleSubmit(onSubmit, onError)
    await handler()

    expect(onError).not.toHaveBeenCalled()
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
