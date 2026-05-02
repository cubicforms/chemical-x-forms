// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { useForm } from '../../src'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Runtime coverage for `setValue` — both signatures, both forms.
 *
 * The type system has long advertised the callback form
 * (`SetValuePayload<X> = X | (X => X)`) but the runtime silently stuffed
 * the function into form state. These tests pin the restored behaviour:
 * functions are invoked with the current value, the return value is
 * applied. The value form is unchanged.
 *
 * Sequential-freshness coverage proves the callback reads the live ref,
 * not a captured snapshot — this is the property that makes
 * `setValue('n', n => n + 1)` safe under back-to-back invocations.
 */

type SignupForm = {
  email: string
  counter: number
  profile: {
    name: string
    age: number
  }
  posts: { title: string; views: number }[]
}

const defaults: SignupForm = {
  email: '',
  counter: 0,
  profile: { name: '', age: 0 },
  posts: [{ title: 'first', views: 0 }],
}

function harness() {
  let captured!: UseFormReturnType<SignupForm>
  const Probe = defineComponent({
    setup() {
      captured = useForm<SignupForm>({
        schema: fakeSchema<SignupForm>(defaults),
        key: `set-value-${Math.random().toString(36).slice(2)}`,
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  attachRegistryToApp(app, createRegistry())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('setValue — value form (existing behaviour)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('replaces the whole form when called with a single object', () => {
    const { app, form } = harness()
    apps.push(app)
    const next: SignupForm = {
      email: 'alice@example.com',
      counter: 5,
      profile: { name: 'alice', age: 30 },
      posts: [{ title: 'hello', views: 42 }],
    }
    const result = form.setValue(next)
    expect(result).toBe(true)
    expect(form.values()).toEqual(next)
  })

  it('writes a leaf when called with (path, value)', () => {
    const { app, form } = harness()
    apps.push(app)
    const result = form.setValue('email', 'bob@example.com')
    expect(result).toBe(true)
    expect(form.values.email).toBe('bob@example.com')
  })

  it('writes a nested leaf', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('profile.name', 'carol')
    expect(form.values.profile.name).toBe('carol')
  })

  it('writes an array-index nested leaf', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('posts.0.views', 99)
    // posts[0] is `T | undefined` (array index honesty); the harness
    // seeds posts so `[0]` exists at this point.
    expect(form.values.posts[0]?.views).toBe(99)
  })
})

describe('setValue — callback form', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('whole-form callback receives the current form and applies the return', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'alice@example.com')

    let received: SignupForm | undefined
    const result = form.setValue((prev) => {
      received = prev as SignupForm
      return { ...(prev as SignupForm), email: 'changed@example.com' }
    })

    expect(result).toBe(true)
    expect(received?.email).toBe('alice@example.com')
    expect(form.values.email).toBe('changed@example.com')
    // Other paths preserved by the spread.
    expect(form.values.counter).toBe(0)
  })

  it('path callback receives the leaf value and applies the return', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'alice@example.com')

    let received: unknown
    const result = form.setValue('email', (prev) => {
      received = prev
      return prev + '!'
    })

    expect(result).toBe(true)
    expect(received).toBe('alice@example.com')
    expect(form.values.email).toBe('alice@example.com!')
  })

  it('nested-path callback receives the nested leaf', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('profile.name', 'carol')

    form.setValue('profile.name', (prev) => prev.toUpperCase())
    expect(form.values.profile.name).toBe('CAROL')
  })

  it('array-index nested callback receives the indexed leaf', () => {
    const { app, form } = harness()
    apps.push(app)

    form.setValue('posts.0.views', (prev) => prev + 7)
    expect(form.values.posts[0]?.views).toBe(7)
  })

  it('sequential callback invocations each see the latest committed value', () => {
    const { app, form } = harness()
    apps.push(app)

    form.setValue('counter', (n) => n + 1)
    form.setValue('counter', (n) => n + 1)
    form.setValue('counter', (n) => n + 1)

    // Each call read the prior committed value, not a stale snapshot.
    expect(form.values.counter).toBe(3)
  })

  it('callback return value flows through reactivity (form.values updates)', () => {
    const { app, form } = harness()
    apps.push(app)
    expect(form.values.counter).toBe(0)
    form.setValue('counter', (n) => n + 41)
    expect(form.values.counter).toBe(41)
  })

  it('does not store the function itself in form state', () => {
    const { app, form } = harness()
    apps.push(app)

    form.setValue('email', (prev) => prev + 'x')
    const stored = form.values.email
    expect(typeof stored).toBe('string')
    expect(stored).toBe('x')
  })
})
