// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { unset, useForm } from '../../src/zod'
import { canonicalizePath } from '../../src/runtime/core/paths'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'

/**
 * Public API coverage for the `unset` symbol — declarative
 * (`defaultValues: { x: unset }`) and imperative
 * (`setValue('x', unset)`, `reset({ x: unset })`). Plus the bulk
 * `form.transientEmptyPaths` introspection accessor and the per-field
 * `getFieldState(...).value.pendingEmpty` view.
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
        key: `te-${Math.random().toString(36).slice(2)}`,
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

describe('defaultValues with `unset`', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('numeric leaf: storage holds the slim default, set is populated', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }), { count: unset })
    apps.push(app)
    expect(form.getValue('count').value).toBe(0)
    expect(form.transientEmptyPaths.value.has(canonicalizePath('count').key)).toBe(true)
  })

  it('string leaf: storage is "", set is populated', () => {
    const { app, form } = setupForm(z.object({ name: z.string() }), { name: unset })
    apps.push(app)
    expect(form.getValue('name').value).toBe('')
    expect(form.transientEmptyPaths.value.has(canonicalizePath('name').key)).toBe(true)
  })

  it('boolean leaf: storage is false, set is populated', () => {
    const { app, form } = setupForm(z.object({ agreed: z.boolean() }), { agreed: unset })
    apps.push(app)
    expect(form.getValue('agreed').value).toBe(false)
    expect(form.transientEmptyPaths.value.has(canonicalizePath('agreed').key)).toBe(true)
  })

  it('multiple leaves can be marked', () => {
    const { app, form } = setupForm(z.object({ income: z.number(), name: z.string() }), {
      income: unset,
      name: unset,
    })
    apps.push(app)
    expect(form.transientEmptyPaths.value.size).toBe(2)
  })

  it('nested leaves are marked at their canonical paths', () => {
    const { app, form } = setupForm(
      z.object({ user: z.object({ name: z.string(), age: z.number() }) }),
      { user: { name: unset, age: unset } }
    )
    apps.push(app)
    expect(form.transientEmptyPaths.value.has(canonicalizePath('user.name').key)).toBe(true)
    expect(form.transientEmptyPaths.value.has(canonicalizePath('user.age').key)).toBe(true)
  })

  it('mixed marked and unmarked leaves coexist', () => {
    const { app, form } = setupForm(z.object({ income: z.number(), name: z.string() }), {
      income: unset,
      name: 'alice',
    })
    apps.push(app)
    expect(form.transientEmptyPaths.value.has(canonicalizePath('income').key)).toBe(true)
    expect(form.transientEmptyPaths.value.has(canonicalizePath('name').key)).toBe(false)
    expect(form.getValue('name').value).toBe('alice')
  })
})

describe('setValue(path, unset)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('marks the path and writes the slim default', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }))
    apps.push(app)
    form.setValue('count', 99)
    expect(form.transientEmptyPaths.value.size).toBe(0)

    form.setValue('count', unset)
    expect(form.getValue('count').value).toBe(0)
    expect(form.transientEmptyPaths.value.has(canonicalizePath('count').key)).toBe(true)
  })

  it('subsequent regular write removes the path', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }))
    apps.push(app)
    form.setValue('count', unset)
    expect(form.transientEmptyPaths.value.size).toBe(1)

    form.setValue('count', 42)
    expect(form.transientEmptyPaths.value.size).toBe(0)
    expect(form.getValue('count').value).toBe(42)
  })

  it('callback returning unset is translated', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }))
    apps.push(app)
    form.setValue('count', 5)
    form.setValue('count', () => unset)
    expect(form.getValue('count').value).toBe(0)
    expect(form.transientEmptyPaths.value.size).toBe(1)
  })
})

describe('reset(args) with unset', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('reset({ x: unset }) marks the path post-reset', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }))
    apps.push(app)
    form.setValue('count', 42)
    expect(form.transientEmptyPaths.value.size).toBe(0)

    form.reset({ count: unset })
    expect(form.getValue('count').value).toBe(0)
    expect(form.transientEmptyPaths.value.has(canonicalizePath('count').key)).toBe(true)
    // Dirty resets to false: the new baseline is "transient-empty for this path".
    expect(form.state.isDirty).toBe(false)
  })
})

describe('getFieldState meta.pendingEmpty + flat pendingEmpty', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('reports pendingEmpty for a path marked via defaultValues', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }), { count: unset })
    apps.push(app)
    const fs = form.getFieldState('count').value
    expect((fs as unknown as { pendingEmpty: boolean }).pendingEmpty).toBe(true)
  })

  it('flips back to false after a real write', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }), { count: unset })
    apps.push(app)
    form.setValue('count', 5)
    const fs = form.getFieldState('count').value
    expect((fs as unknown as { pendingEmpty: boolean }).pendingEmpty).toBe(false)
  })
})

describe('form.transientEmptyPaths bulk accessor', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('returns a frozen snapshot — consumers cannot mutate', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }), { count: unset })
    apps.push(app)
    const snapshot = form.transientEmptyPaths.value
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  it('reflects marks and unmarks reactively', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }))
    apps.push(app)
    expect(form.transientEmptyPaths.value.size).toBe(0)
    form.setValue('count', unset)
    expect(form.transientEmptyPaths.value.size).toBe(1)
    form.setValue('count', 5)
    expect(form.transientEmptyPaths.value.size).toBe(0)
  })
})

describe('runtime guard: unset on non-primitive leaf', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does not crash and does not mark when slim default is non-primitive (object)', () => {
    // Object leaf — schema's getDefaultAtPath returns {}. The walker
    // emits a dev-warn and writes the default without marking.
    const { app, form } = setupForm(z.object({ profile: z.object({ name: z.string() }) }), {
      profile: unset as unknown as { name: string },
    })
    apps.push(app)
    // No mark; storage gets the object default.
    expect(form.transientEmptyPaths.value.size).toBe(0)
  })
})
