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
 * `form.blankPaths` introspection accessor and the per-field
 * `getFieldState(...).value.blank` view.
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
    expect(form.values.count).toBe(0)
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(true)
  })

  it('string leaf: storage is "", set is populated', () => {
    const { app, form } = setupForm(z.object({ name: z.string() }), { name: unset })
    apps.push(app)
    expect(form.values.name).toBe('')
    expect(form.blankPaths.value.has(canonicalizePath('name').key)).toBe(true)
  })

  it('boolean leaf: storage is false, set is populated', () => {
    const { app, form } = setupForm(z.object({ agreed: z.boolean() }), { agreed: unset })
    apps.push(app)
    expect(form.values.agreed).toBe(false)
    expect(form.blankPaths.value.has(canonicalizePath('agreed').key)).toBe(true)
  })

  it('multiple leaves can be marked', () => {
    const { app, form } = setupForm(z.object({ income: z.number(), name: z.string() }), {
      income: unset,
      name: unset,
    })
    apps.push(app)
    expect(form.blankPaths.value.size).toBe(2)
  })

  it('nested leaves are marked at their canonical paths', () => {
    const { app, form } = setupForm(
      z.object({ user: z.object({ name: z.string(), age: z.number() }) }),
      { user: { name: unset, age: unset } }
    )
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('user.name').key)).toBe(true)
    expect(form.blankPaths.value.has(canonicalizePath('user.age').key)).toBe(true)
  })

  it('mixed marked and unmarked leaves coexist', () => {
    const { app, form } = setupForm(z.object({ income: z.number(), name: z.string() }), {
      income: unset,
      name: 'alice',
    })
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('income').key)).toBe(true)
    expect(form.blankPaths.value.has(canonicalizePath('name').key)).toBe(false)
    expect(form.values.name).toBe('alice')
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
    expect(form.blankPaths.value.size).toBe(0)

    form.setValue('count', unset)
    expect(form.values.count).toBe(0)
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(true)
  })

  it('subsequent regular write removes the path', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }))
    apps.push(app)
    form.setValue('count', unset)
    expect(form.blankPaths.value.size).toBe(1)

    form.setValue('count', 42)
    expect(form.blankPaths.value.size).toBe(0)
    expect(form.values.count).toBe(42)
  })

  it('callback returning unset is translated', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }))
    apps.push(app)
    form.setValue('count', 5)
    form.setValue('count', () => unset)
    expect(form.values.count).toBe(0)
    expect(form.blankPaths.value.size).toBe(1)
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
    expect(form.blankPaths.value.size).toBe(0)

    form.reset({ count: unset })
    expect(form.values.count).toBe(0)
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(true)
    // Dirty resets to false: the new baseline is "blank for this path".
    expect(form.state.isDirty).toBe(false)
  })
})

describe('getFieldState meta.blank + flat blank', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('reports blank for a path marked via defaultValues', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }), { count: unset })
    apps.push(app)
    const fs = form.fieldState.count
    expect((fs as unknown as { blank: boolean }).blank).toBe(true)
  })

  it('flips back to false after a real write', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }), { count: unset })
    apps.push(app)
    form.setValue('count', 5)
    const fs = form.fieldState.count
    expect((fs as unknown as { blank: boolean }).blank).toBe(false)
  })
})

describe('form.blankPaths bulk accessor', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('returns a readonly snapshot — consumers cannot mutate', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }), { count: unset })
    apps.push(app)
    const snapshot = form.blankPaths.value
    // The snapshot is a Proxy that traps add / delete / clear so
    // consumers can't pollute the cached view. `Object.isFrozen` is
    // not a meaningful test here: frozen Sets remain mutable, so the
    // real protection is the runtime throw on the mutating methods.
    expect(() => (snapshot as unknown as Set<string>).add('foo')).toThrow(TypeError)
    expect(() => (snapshot as unknown as Set<string>).delete('count')).toThrow(TypeError)
    expect(() => (snapshot as unknown as Set<string>).clear()).toThrow(TypeError)
  })

  it('reflects marks and unmarks reactively', () => {
    // Explicit defaults so the bulk view starts at size 0; the unspecified-
    // leaf auto-mark covered separately in the auto-mark suite below.
    const { app, form } = setupForm(z.object({ count: z.number() }), { count: 0 })
    apps.push(app)
    expect(form.blankPaths.value.size).toBe(0)
    form.setValue('count', unset)
    expect(form.blankPaths.value.size).toBe(1)
    form.setValue('count', 5)
    expect(form.blankPaths.value.size).toBe(0)
  })
})

describe('runtime guard: unset on non-primitive leaf', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does not mark the object path itself, but recurses into the slim subtree to auto-mark primitive children', () => {
    // Object leaf — schema's getDefaultAtPath returns the structural
    // default `{ name: '' }`. The walker emits a dev-warn for the
    // misuse, replaces with the slim default, and recurses into the
    // subtree so unspecified primitive children still get auto-marked
    // (consistent with omitting the object entirely).
    const { app, form } = setupForm(z.object({ profile: z.object({ name: z.string() }) }), {
      profile: unset as unknown as { name: string },
    })
    apps.push(app)
    // Object path itself NOT marked — `unset` at non-primitive is a
    // misuse; the dev-warn signals "library is recovering."
    expect(form.blankPaths.value.has(canonicalizePath('profile').key)).toBe(false)
    // Children auto-marked: the consumer didn't supply `profile.name`,
    // so it's logically "blank" in the freshly opened form.
    expect(form.blankPaths.value.has(canonicalizePath('profile.name').key)).toBe(true)
  })
})

describe('auto-mark: unspecified primitive leaves are blank on construction', () => {
  // Rationale: a freshly opened form has no user input yet, so every
  // primitive leaf the consumer didn't explicitly fill is logically
  // "blank." This is the public-housing footgun fix taken to its
  // logical conclusion — devs no longer have to remember `unset` for
  // every leaf to get the right submit semantics. To opt a leaf out
  // of auto-mark, supply a non-`unset` value for it in defaultValues.
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('email example: useForm({ schema: z.object({ email: z.string() }) }) marks email', () => {
    const { app, form } = setupForm(z.object({ email: z.string() }))
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('email').key)).toBe(true)
    expect(form.blankPaths.value.size).toBe(1)
  })

  it('marks every primitive leaf when defaultValues is omitted entirely', () => {
    const { app, form } = setupForm(
      z.object({ name: z.string(), age: z.number(), agreed: z.boolean() })
    )
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('name').key)).toBe(true)
    expect(form.blankPaths.value.has(canonicalizePath('age').key)).toBe(true)
    expect(form.blankPaths.value.has(canonicalizePath('agreed').key)).toBe(true)
    expect(form.blankPaths.value.size).toBe(3)
  })

  it('partial defaults: auto-marks only unspecified leaves', () => {
    const { app, form } = setupForm(z.object({ name: z.string(), age: z.number() }), {
      name: 'alice',
    })
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('name').key)).toBe(false)
    expect(form.blankPaths.value.has(canonicalizePath('age').key)).toBe(true)
    expect(form.values.name).toBe('alice')
    expect(form.values.age).toBe(0)
  })

  it('explicit slim-default value still opts the leaf out of auto-mark', () => {
    // `defaultValues: { count: 0 }` — the consumer wrote 0 explicitly,
    // so the leaf is NOT blank even though storage matches
    // the slim default. The opt-out signal is "consumer supplied a
    // non-`unset` value", not "consumer supplied a non-default value".
    const { app, form } = setupForm(z.object({ count: z.number() }), { count: 0 })
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(false)
    expect(form.blankPaths.value.size).toBe(0)
  })

  it('nested object: marks unspecified leaves at their canonical paths', () => {
    const { app, form } = setupForm(
      z.object({ user: z.object({ name: z.string(), age: z.number() }) }),
      { user: { name: 'alice' } }
    )
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('user.name').key)).toBe(false)
    expect(form.blankPaths.value.has(canonicalizePath('user.age').key)).toBe(true)
  })

  it('nested object: omitting the outer object recurses to mark all primitive leaves below', () => {
    const { app, form } = setupForm(
      z.object({ user: z.object({ name: z.string(), age: z.number() }) })
    )
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('user.name').key)).toBe(true)
    expect(form.blankPaths.value.has(canonicalizePath('user.age').key)).toBe(true)
    // The object path itself is NOT marked — only primitive leaves are.
    expect(form.blankPaths.value.has(canonicalizePath('user').key)).toBe(false)
  })

  it('optional leaf: marks the path even though slim default is undefined', () => {
    const { app, form } = setupForm(z.object({ note: z.string().optional() }))
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('note').key)).toBe(true)
    // Storage is undefined per the optional schema — the mark is
    // about UI/display intent, not about validation requiredness.
    expect(form.values.note).toBeUndefined()
  })

  it('nullable leaf: marks the path even though slim default is null', () => {
    const { app, form } = setupForm(z.object({ note: z.string().nullable() }))
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('note').key)).toBe(true)
    expect(form.values.note).toBeNull()
  })

  it('.default(N): marks the path; storage holds N (the default-author intent)', () => {
    const { app, form } = setupForm(z.object({ count: z.number().default(7) }))
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(true)
    expect(form.values.count).toBe(7)
  })

  it('arrays: pass through without marking elements (runtime-added)', () => {
    const { app, form } = setupForm(z.object({ tags: z.array(z.string()) }))
    apps.push(app)
    // `tags` itself is a non-primitive leaf — not marked.
    expect(form.blankPaths.value.has(canonicalizePath('tags').key)).toBe(false)
    // No spurious indexed marks either.
    expect(form.blankPaths.value.size).toBe(0)
  })

  it('explicit value at a leaf does NOT mark even if value happens to equal slim default', () => {
    const { app, form } = setupForm(z.object({ name: z.string(), age: z.number() }), {
      name: '',
      age: 0,
    })
    apps.push(app)
    // Both leaves had user-supplied values (matching slim defaults)
    // — neither is auto-marked.
    expect(form.blankPaths.value.size).toBe(0)
  })

  it('explicit unset still works alongside auto-mark', () => {
    // `count` via explicit unset, `name` via auto-mark — same outcome
    // (both end up in the set). The difference is documentation: `unset`
    // is the dev's deliberate signal, auto-mark is the inferred default.
    const { app, form } = setupForm(z.object({ count: z.number(), name: z.string() }), {
      count: unset,
    })
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(true)
    expect(form.blankPaths.value.has(canonicalizePath('name').key)).toBe(true)
  })

  it('auto-marks ride into the post-construction baseline (reset restores them)', () => {
    const { app, form } = setupForm(z.object({ count: z.number() }))
    apps.push(app)
    // Construction auto-marks `count`.
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(true)
    // User types a value — mark is removed.
    form.setValue('count', 42)
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(false)
    // reset() with no args should restore the construction baseline.
    form.reset()
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(true)
  })

  it('reset(args) auto-marks unspecified leaves in the new defaults', () => {
    const { app, form } = setupForm(z.object({ name: z.string(), age: z.number() }), {
      name: 'alice',
      age: 30,
    })
    apps.push(app)
    expect(form.blankPaths.value.size).toBe(0)
    // Reset with a partial — `age` is omitted, so it gets auto-marked.
    form.reset({ name: 'bob' })
    expect(form.blankPaths.value.has(canonicalizePath('name').key)).toBe(false)
    expect(form.blankPaths.value.has(canonicalizePath('age').key)).toBe(true)
    expect(form.values.name).toBe('bob')
    expect(form.values.age).toBe(0)
  })

  it('isDirty stays false on construction even with auto-marks', () => {
    // Construction-time auto-marks ARE the baseline — they shouldn't
    // count as "dirty" (the user hasn't done anything yet).
    const { app, form } = setupForm(z.object({ count: z.number(), name: z.string() }))
    apps.push(app)
    expect(form.state.isDirty).toBe(false)
  })
})
