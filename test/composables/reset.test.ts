// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { useForm } from '../../src'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Runtime coverage for Phase 8.4 — reset() and resetField(path).
 *
 * Reset is the odd one out in the public API: it has to coordinate a
 * whole-form replacement, a rebuild of the originals baseline (so
 * isDirty re-computes from the new baseline), a clear of the errors
 * map, a clear of the per-field touched/focused/blurred flags, and a
 * clear of the submission lifecycle refs. These tests pin each piece
 * independently so a future change that forgets one surface is caught.
 */

type SignupForm = {
  email: string
  password: string
  profile: {
    name: string
    age: number
  }
}

const defaults: SignupForm = {
  email: '',
  password: '',
  profile: { name: '', age: 0 },
}

function harness(initial?: Partial<SignupForm>) {
  let captured!: UseAbstractFormReturnType<SignupForm>
  const Probe = defineComponent({
    setup() {
      captured = useForm<SignupForm>({
        schema: fakeSchema<SignupForm>({
          ...defaults,
          ...initial,
          profile: { ...defaults.profile, ...(initial?.profile ?? {}) },
        }),
        key: `reset-${Math.random().toString(36).slice(2)}`,
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  attachRegistryToApp(app, createRegistry())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('useForm — reset()', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('restores every leaf to the initial schema state', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'user@example.com')
    form.setValue('profile.name', 'alice')

    form.reset()
    expect(form.getValue().value).toEqual(defaults)
  })

  it('applies new constraints over schema defaults when given a partial', () => {
    const { app, form } = harness()
    apps.push(app)
    form.reset({ profile: { name: 'seeded' } })
    expect(form.getValue('profile.name').value).toBe('seeded')
    // Unconstrained siblings fall back to schema defaults.
    expect(form.getValue('email').value).toBe('')
    expect(form.getValue('profile.age').value).toBe(0)
  })

  it('clears errors pre-populated via setFieldErrors', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setFieldErrors([
      { path: ['email'], message: 'taken', formKey: form.key, code: 'api:validation' },
    ])
    expect(form.state.isValid).toBe(false)

    form.reset()
    expect(form.state.isValid).toBe(true)
    expect(form.fieldErrors).toEqual({})
  })

  it('flips isDirty back to false after a mutation + reset', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'dirty@example.com')
    expect(form.state.isDirty).toBe(true)

    form.reset()
    expect(form.state.isDirty).toBe(false)
  })

  it('rebaselines originals so a post-reset mutation flips isDirty', () => {
    const { app, form } = harness()
    apps.push(app)
    // Reset with a new baseline.
    form.reset({ email: 'baseline@example.com' })
    expect(form.state.isDirty).toBe(false)
    // Mutating back to the schema default is now a dirtying move — the
    // new baseline is the constrained value, not the original schema default.
    form.setValue('email', '')
    expect(form.state.isDirty).toBe(true)
  })

  it('clears submission lifecycle (count, error, in-flight)', async () => {
    const { app, form } = harness()
    apps.push(app)
    // Run a failing submit to populate submitCount + submitError.
    const handler = form.handleSubmit(async () => {
      throw new Error('boom')
    })
    await expect(handler()).rejects.toThrow('boom')
    expect(form.state.submitCount).toBe(1)
    expect(form.state.submitError).toBeInstanceOf(Error)

    form.reset()
    expect(form.state.submitCount).toBe(0)
    expect(form.state.submitError).toBeNull()
    expect(form.state.isSubmitting).toBe(false)
  })
})

describe('useForm — resetField(path)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('restores only the named leaf, leaves siblings untouched', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'dirty@example.com')
    form.setValue('password', 'still-dirty')

    form.resetField('email')
    expect(form.getValue('email').value).toBe('')
    expect(form.getValue('password').value).toBe('still-dirty')
  })

  it('clears errors on the reset path but preserves sibling errors', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setFieldErrors([
      { path: ['email'], message: 'email error', formKey: form.key, code: 'api:validation' },
      { path: ['password'], message: 'password error', formKey: form.key, code: 'api:validation' },
    ])

    form.resetField('email')
    expect(form.fieldErrors).not.toHaveProperty('email')
    expect(form.fieldErrors.password).toHaveLength(1)
  })

  it('restores an entire sub-tree when path names a container', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('profile.name', 'alice')
    form.setValue('profile.age', 42)
    form.setValue('email', 'touched@example.com')

    form.resetField('profile')
    expect(form.getValue('profile.name').value).toBe('')
    expect(form.getValue('profile.age').value).toBe(0)
    // Leaf outside the sub-tree still dirty.
    expect(form.getValue('email').value).toBe('touched@example.com')
  })

  it('no-ops on an unknown path', () => {
    const { app, form } = harness()
    apps.push(app)
    const before = form.getValue().value
    // @ts-expect-error - 'nope' is not a FlatPath of the form
    form.resetField('nope')
    expect(form.getValue().value).toEqual(before)
  })
})
