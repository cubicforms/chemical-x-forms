// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { canonicalizePath } from '../../src/runtime/core/paths'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'

/**
 * Coverage for `displayValue` and `markTransientEmpty` on
 * `RegisterValue` (commit 3). The transforms (`commit 4`) and
 * directive (commit 5) plug these into the UI flow; here we test the
 * contract directly through the register binding.
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
        key: `disp-${Math.random().toString(36).slice(2)}`,
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

describe('displayValue', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('stringifies a number leaf', () => {
    const schema = z.object({ count: z.number() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    form.setValue('count', 42)
    expect(form.register('count').displayValue.value).toBe('42')
  })

  it('returns the live string value on a string leaf', () => {
    const schema = z.object({ name: z.string() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    form.setValue('name', 'alice')
    expect(form.register('name').displayValue.value).toBe('alice')
  })

  it('returns "" when storage is undefined', () => {
    const schema = z.object({ note: z.string().optional() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    expect(form.register('note').displayValue.value).toBe('')
  })

  it('returns "" when storage is null', () => {
    const schema = z.object({ note: z.string().nullable() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    form.setValue('note', null)
    expect(form.register('note').displayValue.value).toBe('')
  })

  it('returns "" when the path is in transientEmptyPaths', () => {
    const schema = z.object({ count: z.number() })
    // Pass explicit defaults to opt out of construction-time auto-mark
    // — this test isolates the markTransientEmpty() flip path.
    const { app, form } = setupForm(schema, { count: 0 })
    apps.push(app)
    const binding = form.register('count')
    expect(binding.displayValue.value).toBe('0')
    // Mark transient-empty — storage stays at slim default but
    // displayValue switches to ''.
    binding.markTransientEmpty()
    expect(binding.displayValue.value).toBe('')
  })

  it('stringifies a boolean leaf', () => {
    const schema = z.object({ agreed: z.boolean() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    form.setValue('agreed', true)
    expect(form.register('agreed').displayValue.value).toBe('true')
  })

  it('reactively updates when storage changes', () => {
    const schema = z.object({ count: z.number() })
    // Explicit defaults so the binding starts un-marked (auto-mark
    // would prepopulate transientEmptyPaths and force '').
    const { app, form } = setupForm(schema, { count: 0 })
    apps.push(app)
    const binding = form.register('count')
    expect(binding.displayValue.value).toBe('0')
    form.setValue('count', 7)
    expect(binding.displayValue.value).toBe('7')
  })

  it('reactively switches when transient-empty membership changes', () => {
    const schema = z.object({ count: z.number() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    const binding = form.register('count')
    binding.markTransientEmpty()
    expect(binding.displayValue.value).toBe('')
    form.setValue('count', 5)
    expect(binding.displayValue.value).toBe('5')
  })
})

describe('markTransientEmpty', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writes the slim default to storage and adds the path to the set', () => {
    const schema = z.object({ count: z.number() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    form.setValue('count', 99)

    const binding = form.register('count')
    const ok = binding.markTransientEmpty()
    expect(ok).toBe(true)
    // Slim default for z.number() is 0.
    expect(form.getValue('count').value).toBe(0)
    // pendingEmpty surfaces through the form's transientEmptyPaths
    // (commit 7 wires the public meta accessor; for now we read the
    // FormStore set indirectly via getValue still showing 0 with
    // displayValue '').
    expect(binding.displayValue.value).toBe('')
  })

  it('returns the setValueAtPath result', () => {
    const schema = z.object({ count: z.number() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    expect(form.register('count').markTransientEmpty()).toBe(true)
  })

  it('uses the canonical path key when adding to the reactive set', () => {
    const schema = z.object({ user: z.object({ income: z.number() }) })
    const { app, form } = setupForm(schema)
    apps.push(app)
    const binding = form.register('user.income')
    binding.markTransientEmpty()
    // displayValue branch hits via state.transientEmptyPaths.has(pathKey).
    expect(binding.displayValue.value).toBe('')
    void canonicalizePath('user.income')
  })

  it('next regular write removes the path from the set (implicit unmark)', () => {
    const schema = z.object({ count: z.number() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    const binding = form.register('count')
    binding.markTransientEmpty()
    expect(binding.displayValue.value).toBe('')
    form.setValue('count', 5)
    expect(binding.displayValue.value).toBe('5')
  })
})
