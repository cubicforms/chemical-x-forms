// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { useForm } from '../../src'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Runtime coverage for Phase 8.2 — form-level `isDirty` / `isValid`
 * computed aggregates. Type-level coverage lives in
 * test/composables/type-inference.test.ts.
 *
 * The aggregates are thin wrappers around existing reactive stores
 * (`state.originals` for dirty comparisons, `state.schemaErrors` +
 * `state.userErrors` for the validity check) — the tests pin their
 * semantics so a future refactor of those stores can't silently break
 * the aggregates.
 */

type SignupForm = {
  email: string
  password: string
}

const defaults: SignupForm = { email: '', password: '' }

function harness(initial?: Partial<SignupForm>) {
  let captured!: UseAbstractFormReturnType<SignupForm>
  const Probe = defineComponent({
    setup() {
      captured = useForm<SignupForm>({
        schema: fakeSchema<SignupForm>({ ...defaults, ...initial }),
        key: `agg-${Math.random().toString(36).slice(2)}`,
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  attachRegistryToApp(app, createRegistry())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('useForm — isDirty / isValid form-level aggregates', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('pristine form is !isDirty && isValid', () => {
    const { app, form } = harness()
    apps.push(app)
    expect(form.state.isDirty).toBe(false)
    expect(form.state.isValid).toBe(true)
  })

  it('setValue on any leaf flips isDirty true', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'user@example.com')
    expect(form.state.isDirty).toBe(true)
  })

  it('undoing all mutations flips isDirty back to false', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'user@example.com')
    expect(form.state.isDirty).toBe(true)
    form.setValue('email', '')
    expect(form.state.isDirty).toBe(false)
  })

  it('recording errors via setFieldErrors flips isValid false', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setFieldErrors([{ path: ['email'], message: 'required', formKey: form.key }])
    expect(form.state.isValid).toBe(false)
  })

  it('clearing errors flips isValid back to true', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setFieldErrors([{ path: ['email'], message: 'required', formKey: form.key }])
    expect(form.state.isValid).toBe(false)
    form.clearFieldErrors()
    expect(form.state.isValid).toBe(true)
  })

  it('isDirty and isValid are independent — dirty-but-valid is a real state', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'a@b')
    // No errors recorded → still valid.
    expect(form.state.isDirty).toBe(true)
    expect(form.state.isValid).toBe(true)
  })
})
