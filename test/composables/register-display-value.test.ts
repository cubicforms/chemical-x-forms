// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { canonicalizePath } from '../../src/runtime/core/paths'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'

/**
 * Coverage for `displayValue` and `markBlank` on
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

  it('returns "" when the path is in blankPaths', () => {
    const schema = z.object({ count: z.number() })
    // Pass explicit defaults to opt out of construction-time auto-mark
    // — this test isolates the markBlank() flip path.
    const { app, form } = setupForm(schema, { count: 0 })
    apps.push(app)
    const binding = form.register('count')
    expect(binding.displayValue.value).toBe('0')
    // Mark blank — storage stays at slim default but
    // displayValue switches to ''.
    binding.markBlank()
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
    // would prepopulate blankPaths and force '').
    const { app, form } = setupForm(schema, { count: 0 })
    apps.push(app)
    const binding = form.register('count')
    expect(binding.displayValue.value).toBe('0')
    form.setValue('count', 7)
    expect(binding.displayValue.value).toBe('7')
  })

  it('reactively switches when blank membership changes', () => {
    const schema = z.object({ count: z.number() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    const binding = form.register('count')
    binding.markBlank()
    expect(binding.displayValue.value).toBe('')
    form.setValue('count', 5)
    expect(binding.displayValue.value).toBe('5')
  })

  it('prefers `lastTypedForm` over `String(storage)` when it parses to the same number', () => {
    // `1e2 === 100` in JS; the typed form `'1e2'` and the canonical
    // `String(100) === '100'` are both legitimate views. The directive
    // populates `lastTypedForm` mid-typing so the input keeps showing
    // what the user typed even though storage holds 100.
    const schema = z.object({ count: z.number() })
    const { app, form } = setupForm(schema, { count: 0 })
    apps.push(app)
    const binding = form.register('count')
    form.setValue('count', 100)
    expect(binding.displayValue.value).toBe('100')
    binding.lastTypedForm.value = '1e2'
    expect(binding.displayValue.value).toBe('1e2')
    // Clearing falls back to the canonical String form (post-blur path).
    binding.lastTypedForm.value = null
    expect(binding.displayValue.value).toBe('100')
  })

  it('falls back to `String(storage)` when `lastTypedForm` no longer parses to current storage', () => {
    // Programmatic `setValue` (or hydration / reset) advances storage
    // out from under a stale `lastTypedForm` — the parse-equality
    // check naturally invalidates without explicit reset wiring.
    const schema = z.object({ count: z.number() })
    const { app, form } = setupForm(schema, { count: 0 })
    apps.push(app)
    const binding = form.register('count')
    form.setValue('count', 100)
    binding.lastTypedForm.value = '1e2'
    expect(binding.displayValue.value).toBe('1e2')
    // Storage advances to 200; `parseFloat('1e2') === 100 ≠ 200`, so
    // the typed form is ignored and the honest canonical wins.
    form.setValue('count', 200)
    expect(binding.displayValue.value).toBe('200')
  })

  it('shares `lastTypedForm` across multiple register() calls for the same path', () => {
    // Two `<input v-register>` bindings to the same path each call
    // `register('count')` — every render produces fresh RegisterValue
    // objects, but they must share the typed-form state so the
    // sibling input doesn't desync mid-typing. Storage updates live;
    // both bindings' displayValue must surface the typed form.
    const schema = z.object({ count: z.number() })
    const { app, form } = setupForm(schema, { count: 0 })
    apps.push(app)
    const a = form.register('count')
    const b = form.register('count')
    // Same ref instance — sharing is by identity, not by copy.
    expect(a.lastTypedForm).toBe(b.lastTypedForm)
    form.setValue('count', 100)
    a.lastTypedForm.value = '1e2'
    // B sees A's write because they share the ref.
    expect(b.lastTypedForm.value).toBe('1e2')
    expect(a.displayValue.value).toBe('1e2')
    expect(b.displayValue.value).toBe('1e2')
  })
})

describe('markBlank', () => {
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
    const ok = binding.markBlank()
    expect(ok).toBe(true)
    // Slim default for z.number() is 0.
    expect(form.values.count).toBe(0)
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
    expect(form.register('count').markBlank()).toBe(true)
  })

  it('uses the canonical path key when adding to the reactive set', () => {
    const schema = z.object({ user: z.object({ income: z.number() }) })
    const { app, form } = setupForm(schema)
    apps.push(app)
    const binding = form.register('user.income')
    binding.markBlank()
    // displayValue branch hits via state.blankPaths.has(pathKey).
    expect(binding.displayValue.value).toBe('')
    void canonicalizePath('user.income')
  })

  it('next regular write removes the path from the set (implicit unmark)', () => {
    const schema = z.object({ count: z.number() })
    const { app, form } = setupForm(schema)
    apps.push(app)
    const binding = form.register('count')
    binding.markBlank()
    expect(binding.displayValue.value).toBe('')
    form.setValue('count', 5)
    expect(binding.displayValue.value).toBe('5')
  })
})
