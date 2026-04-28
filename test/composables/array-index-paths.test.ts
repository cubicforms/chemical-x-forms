// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'

/**
 * Runtime coverage for integer-keyed paths against `z.array(...)`
 * leaves. The form API accepts dotted (`'tags.0'`) and array-form
 * (`['tags', 0]`) paths interchangeably; both should resolve to the
 * same element. The slim-primitive write gate enforces the element
 * schema at the index boundary so per-index writes can't smuggle
 * the wrong type into the array.
 */

function setupForm<F extends z.ZodObject<Record<string, z.ZodType>>>(
  schema: F,
  defaultValues?: Parameters<typeof useForm<F>>[0]['defaultValues']
) {
  let captured!: UseAbstractFormReturnType<z.output<F> & Record<string, unknown>>
  const Probe = defineComponent({
    setup() {
      captured = useForm({
        schema,
        key: `arr-idx-${Math.random().toString(36).slice(2)}`,
        ...(defaultValues !== undefined ? { defaultValues } : {}),
      }) as unknown as UseAbstractFormReturnType<z.output<F> & Record<string, unknown>>
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  attachRegistryToApp(app, createRegistry())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('z.array(z.string()) — integer-keyed paths', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('register(`tags.0`) reads element 0', () => {
    const { app, form } = setupForm(z.object({ tags: z.array(z.string()) }), {
      tags: ['alpha', 'beta', 'gamma'],
    })
    apps.push(app)
    expect(form.register('tags.0').innerRef.value).toBe('alpha')
    expect(form.register('tags.1').innerRef.value).toBe('beta')
    expect(form.register('tags.2').innerRef.value).toBe('gamma')
  })

  it('register([`tags`, 0]) array-form path resolves to the same element (runtime cast)', () => {
    // The typed wrapper narrows `register` to dotted-string paths
    // for ergonomic inference, but the underlying runtime
    // (`canonicalizePath`) accepts both forms equivalently. Cast
    // through `unknown` to exercise the array-form runtime path.
    const { app, form } = setupForm(z.object({ tags: z.array(z.string()) }), {
      tags: ['alpha', 'beta'],
    })
    apps.push(app)
    type AnyRegister = (path: unknown) => { innerRef: { value: unknown } }
    const register = form.register as unknown as AnyRegister
    expect(register(['tags', 0]).innerRef.value).toBe('alpha')
    expect(register(['tags', 1]).innerRef.value).toBe('beta')
  })

  it('getValue(`tags.0`) reads element 0 reactively', () => {
    const { app, form } = setupForm(z.object({ tags: z.array(z.string()) }), {
      tags: ['x', 'y'],
    })
    apps.push(app)
    expect(form.getValue('tags.0').value).toBe('x')
    expect(form.getValue('tags.1').value).toBe('y')
  })

  it('setValue(`tags.1`, …) updates only that index — siblings preserved', () => {
    const { app, form } = setupForm(z.object({ tags: z.array(z.string()) }), {
      tags: ['a', 'b', 'c'],
    })
    apps.push(app)
    const ok = form.setValue('tags.1', 'BANG')
    expect(ok).toBe(true)
    expect(form.getValue('tags').value).toEqual(['a', 'BANG', 'c'])
  })

  it('setValue with array-form path writes equivalently (runtime cast)', () => {
    const { app, form } = setupForm(z.object({ tags: z.array(z.string()) }), {
      tags: ['a', 'b', 'c'],
    })
    apps.push(app)
    type AnySetValue = (path: unknown, value: unknown) => boolean
    const setValue = form.setValue as unknown as AnySetValue
    const ok = setValue(['tags', 2], 'POW')
    expect(ok).toBe(true)
    expect(form.getValue('tags').value).toEqual(['a', 'b', 'POW'])
  })

  it('per-index write of the wrong primitive type is rejected by the gate', () => {
    // The slim-primitive gate sees `tags.0`'s slim default as `''`
    // (empty string), so writing a number to that index is rejected.
    // Storage stays as it was.
    const { app, form } = setupForm(z.object({ tags: z.array(z.string()) }), {
      tags: ['a', 'b'],
    })
    apps.push(app)
    const ok = form.setValue('tags.0', 99 as unknown as string)
    expect(ok).toBe(false)
    expect(form.getValue('tags').value).toEqual(['a', 'b'])
  })

  it('register binding for an index reflects subsequent setValue at that index', () => {
    const { app, form } = setupForm(z.object({ tags: z.array(z.string()) }), {
      tags: ['old', 'unchanged'],
    })
    apps.push(app)
    const binding = form.register('tags.0')
    expect(binding.innerRef.value).toBe('old')
    form.setValue('tags.0', 'new')
    expect(binding.innerRef.value).toBe('new')
    expect(form.register('tags.1').innerRef.value).toBe('unchanged')
  })

  it('reset() restores the original array', () => {
    const { app, form } = setupForm(z.object({ tags: z.array(z.string()) }), {
      tags: ['a', 'b', 'c'],
    })
    apps.push(app)
    form.setValue('tags.1', 'changed')
    expect(form.getValue('tags').value).toEqual(['a', 'changed', 'c'])
    form.reset()
    expect(form.getValue('tags').value).toEqual(['a', 'b', 'c'])
  })

  it('nested object inside array — `posts.0.title` resolves a deep leaf', () => {
    const schema = z.object({
      posts: z.array(z.object({ title: z.string(), views: z.number() })),
    })
    const { app, form } = setupForm(schema, {
      posts: [
        { title: 'first', views: 10 },
        { title: 'second', views: 20 },
      ],
    })
    apps.push(app)
    expect(form.register('posts.0.title').innerRef.value).toBe('first')
    expect(form.register('posts.1.views').innerRef.value).toBe(20)
    form.setValue('posts.0.title', 'edited')
    expect(form.getValue('posts').value).toEqual([
      { title: 'edited', views: 10 },
      { title: 'second', views: 20 },
    ])
  })
})
