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

  it('does not mark the object path itself, but recurses into the slim subtree to auto-mark numeric children', () => {
    // Object leaf — schema's getDefaultAtPath returns the structural
    // default `{ age: 0 }`. The walker emits a dev-warn for the
    // misuse, replaces with the slim default, and recurses into the
    // subtree so unspecified NUMERIC children still get auto-marked
    // (consistent with omitting the object entirely). String children
    // do NOT auto-mark — see `docs/blank.md` on the storage / display
    // divergence rule.
    const { app, form } = setupForm(
      z.object({ profile: z.object({ name: z.string(), age: z.number() }) }),
      { profile: unset as unknown as { name: string; age: number } }
    )
    apps.push(app)
    // Object path itself NOT marked — `unset` at non-primitive is a
    // misuse; the dev-warn signals "library is recovering."
    expect(form.blankPaths.value.has(canonicalizePath('profile').key)).toBe(false)
    // Numeric child auto-marked: storage / display divergence applies.
    expect(form.blankPaths.value.has(canonicalizePath('profile.age').key)).toBe(true)
    // String child NOT auto-marked: storage `''` matches DOM `''`,
    // no side-channel needed.
    expect(form.blankPaths.value.has(canonicalizePath('profile.name').key)).toBe(false)
  })
})

describe('auto-mark: unspecified numeric leaves are blank on construction', () => {
  // Rationale: numeric primitives (`number`, `bigint`) have a
  // genuine storage / display divergence — storage is forced to `0`
  // / `0n` while the DOM input shows `''`, so the runtime needs the
  // `blank` side-channel to tell "user typed 0" from "user supplied
  // nothing." Strings and booleans don't have this divergence (`''`
  // / `false` match what the DOM shows natively), so they are NOT
  // auto-marked — the schema is the authority on whether `''` /
  // `false` is acceptable. See `docs/blank.md` for the conceptual
  // model. Explicit `unset` opts ANY primitive in regardless of type.
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('z.string() leaf is NOT auto-marked at mount', () => {
    const { app, form } = setupForm(z.object({ email: z.string() }))
    apps.push(app)
    // Storage `''` matches DOM `''` — no side-channel needed; the
    // schema (`z.string()`) accepts `''` and the library doesn't
    // override that verdict.
    expect(form.blankPaths.value.has(canonicalizePath('email').key)).toBe(false)
    expect(form.blankPaths.value.size).toBe(0)
  })

  it('marks numeric leaves only when defaultValues is omitted entirely', () => {
    const { app, form } = setupForm(
      z.object({ name: z.string(), age: z.number(), agreed: z.boolean() })
    )
    apps.push(app)
    // String / boolean: storage matches DOM; no auto-mark.
    expect(form.blankPaths.value.has(canonicalizePath('name').key)).toBe(false)
    expect(form.blankPaths.value.has(canonicalizePath('agreed').key)).toBe(false)
    // Number: storage `0` ≠ DOM `''`; auto-mark fires.
    expect(form.blankPaths.value.has(canonicalizePath('age').key)).toBe(true)
    expect(form.blankPaths.value.size).toBe(1)
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

  it('nested object: omitting the outer object recurses, marks numeric children only', () => {
    const { app, form } = setupForm(
      z.object({ user: z.object({ name: z.string(), age: z.number() }) })
    )
    apps.push(app)
    // String child: not auto-marked.
    expect(form.blankPaths.value.has(canonicalizePath('user.name').key)).toBe(false)
    // Numeric child: auto-marked.
    expect(form.blankPaths.value.has(canonicalizePath('user.age').key)).toBe(true)
    // The object path itself is NOT marked — only primitive leaves are.
    expect(form.blankPaths.value.has(canonicalizePath('user').key)).toBe(false)
  })

  it('optional string leaf is NOT auto-marked (slim is undefined, no divergence)', () => {
    const { app, form } = setupForm(z.object({ note: z.string().optional() }))
    apps.push(app)
    // `undefined` isn't a numeric primitive — no auto-mark.
    expect(form.blankPaths.value.has(canonicalizePath('note').key)).toBe(false)
    expect(form.values.note).toBeUndefined()
  })

  it('nullable string leaf is NOT auto-marked (slim is null, no divergence)', () => {
    const { app, form } = setupForm(z.object({ note: z.string().nullable() }))
    apps.push(app)
    // `null` isn't a numeric primitive — no auto-mark.
    expect(form.blankPaths.value.has(canonicalizePath('note').key)).toBe(false)
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

  it('explicit unset opts string leaves in (universal opt-in beats type-gated auto-mark)', () => {
    // `count` via explicit unset, `name` ALSO via explicit unset.
    // Auto-mark is numeric-only, but `unset` is the documented
    // consumer signal that overrides the type gate — explicit intent
    // wins everywhere.
    const { app, form } = setupForm(z.object({ count: z.number(), name: z.string() }), {
      count: unset,
      name: unset,
    })
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(true)
    expect(form.blankPaths.value.has(canonicalizePath('name').key)).toBe(true)
  })

  it('explicit unset on numeric + omitted string: only numeric is marked', () => {
    // Without an explicit `unset` for `name`, the string leaf isn't
    // auto-marked (storage `''` already matches what the DOM shows).
    const { app, form } = setupForm(z.object({ count: z.number(), name: z.string() }), {
      count: unset,
    })
    apps.push(app)
    expect(form.blankPaths.value.has(canonicalizePath('count').key)).toBe(true)
    expect(form.blankPaths.value.has(canonicalizePath('name').key)).toBe(false)
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
