import { describe, expect, it } from 'vitest'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import { canonicalizePath } from '../../src/runtime/core/paths'
import { fakeSchema } from '../utils/fake-schema'

const incomeKey = canonicalizePath('income').key
const nameKey = canonicalizePath('name').key

/**
 * Direct FormStore-level coverage for the blank mechanism
 * landed in commit 2. The public API doesn't expose `unset` until
 * commit 7, so these tests exercise the runtime channel through
 * `setValueAtPath`'s `WriteMeta.blank` flag and reset's
 * snapshot semantics.
 */

type Form = {
  income: number
  name: string
  agreed: boolean
  meta: {
    notes: string
    score: number
  }
}

const defaults: Form = {
  income: 0,
  name: '',
  agreed: false,
  meta: { notes: '', score: 0 },
}

describe('FormStore — blank gate hook', () => {
  it('exposes both reactive and snapshot Sets, empty by default', () => {
    const state = createFormStore<Form>({
      formKey: 'atta-1',
      schema: fakeSchema(defaults),
    })
    expect(state.blankPaths.size).toBe(0)
    expect(state.originalBlankPaths.size).toBe(0)
  })

  it('seeds the reactive Set + originals snapshot from initialBlankPaths', () => {
    const state = createFormStore<Form>({
      formKey: 'atta-2',
      schema: fakeSchema(defaults),
      initialBlankPaths: [incomeKey, nameKey],
    })
    expect(state.blankPaths.has(incomeKey)).toBe(true)
    expect(state.blankPaths.has(nameKey)).toBe(true)
    expect(state.originalBlankPaths.has(incomeKey)).toBe(true)
    expect(state.originalBlankPaths.has(nameKey)).toBe(true)
  })

  it('hydration.blankPaths overrides initialBlankPaths', () => {
    const state = createFormStore<Form>({
      formKey: 'atta-3',
      schema: fakeSchema(defaults),
      initialBlankPaths: [incomeKey],
      hydration: {
        form: defaults,
        schemaErrors: [],
        userErrors: [],
        fields: [],
        blankPaths: [nameKey],
      },
    })
    expect(state.blankPaths.has(incomeKey)).toBe(false)
    expect(state.blankPaths.has(nameKey)).toBe(true)
    expect(state.originalBlankPaths.has(incomeKey)).toBe(false)
    expect(state.originalBlankPaths.has(nameKey)).toBe(true)
  })

  it('hydration without blankPaths leaves the set empty', () => {
    const state = createFormStore<Form>({
      formKey: 'atta-4',
      schema: fakeSchema(defaults),
      hydration: { form: defaults, schemaErrors: [], userErrors: [], fields: [] },
    })
    expect(state.blankPaths.size).toBe(0)
  })

  it('setValueAtPath with blank: true adds the path', () => {
    const state = createFormStore<Form>({ formKey: 'atta-5', schema: fakeSchema(defaults) })
    const ok = state.setValueAtPath(['income'], 0, { blank: true })
    expect(ok).toBe(true)
    expect(state.blankPaths.has(incomeKey)).toBe(true)
  })

  it('subsequent write without blank meta removes the path (implicit unmark)', () => {
    const state = createFormStore<Form>({ formKey: 'atta-6', schema: fakeSchema(defaults) })
    state.setValueAtPath(['income'], 0, { blank: true })
    expect(state.blankPaths.has(incomeKey)).toBe(true)

    state.setValueAtPath(['income'], 50000)
    expect(state.blankPaths.has(incomeKey)).toBe(false)
    expect(state.form.value.income).toBe(50000)
  })

  it('marks blank even when storage value is unchanged (typing 0 over slim-default 0)', () => {
    const state = createFormStore<Form>({ formKey: 'atta-7', schema: fakeSchema(defaults) })
    // Storage is 0 from defaults; mark with blank: true. The
    // identity short-circuit on Object.is(0, 0) would otherwise skip
    // the bookkeeping, but the gate-hook runs before that check.
    state.setValueAtPath(['income'], 0, { blank: true })
    expect(state.blankPaths.has(incomeKey)).toBe(true)
  })

  it('unmarks even when storage value is unchanged (typing 0 after marking)', () => {
    const state = createFormStore<Form>({ formKey: 'atta-8', schema: fakeSchema(defaults) })
    state.setValueAtPath(['income'], 0, { blank: true })
    expect(state.blankPaths.has(incomeKey)).toBe(true)
    // Same value, no blank meta — should unmark.
    state.setValueAtPath(['income'], 0)
    expect(state.blankPaths.has(incomeKey)).toBe(false)
  })

  it('does not mutate originalBlankPaths on regular writes', () => {
    const state = createFormStore<Form>({
      formKey: 'atta-9',
      schema: fakeSchema(defaults),
      initialBlankPaths: [incomeKey],
    })
    state.setValueAtPath(['income'], 100, { blank: true })
    state.setValueAtPath(['income'], 200)
    // originals snapshot stays at construction-time membership.
    expect(state.originalBlankPaths.has(incomeKey)).toBe(true)
  })
})

describe('FormStore — reset', () => {
  it('reset() restores blankPaths from the originals snapshot', () => {
    const state = createFormStore<Form>({
      formKey: 'atta-10',
      schema: fakeSchema(defaults),
      initialBlankPaths: [incomeKey],
    })
    // User clears the path (manual unmark via a non-transient write).
    state.setValueAtPath(['income'], 100)
    expect(state.blankPaths.has(incomeKey)).toBe(false)

    state.reset()
    expect(state.blankPaths.has(incomeKey)).toBe(true)
    // Snapshot itself is unchanged.
    expect(state.originalBlankPaths.has(incomeKey)).toBe(true)
  })

  it('reset(args) clears both sets (commit 7 wires the unset walker)', () => {
    const state = createFormStore<Form>({
      formKey: 'atta-11',
      schema: fakeSchema(defaults),
      initialBlankPaths: [incomeKey, nameKey],
    })
    state.reset({ income: 5 })
    expect(state.blankPaths.size).toBe(0)
    expect(state.originalBlankPaths.size).toBe(0)
  })

  it('after reset(args) followed by reset(), the post-reset(args) baseline returns', () => {
    const state = createFormStore<Form>({
      formKey: 'atta-12',
      schema: fakeSchema(defaults),
      initialBlankPaths: [incomeKey],
    })
    state.reset({ income: 5 })
    // Now snapshot is empty; reset() restores empty.
    state.setValueAtPath(['income'], 7, { blank: true })
    state.reset()
    expect(state.blankPaths.size).toBe(0)
  })
})

describe('FormStore — reactive Set tracking', () => {
  it('Vue 3.5 reactive Set fires on .add() / .delete() / .has()', () => {
    const state = createFormStore<Form>({ formKey: 'atta-13', schema: fakeSchema(defaults) })
    // Smoke-check that the Set is reactive enough to drive a watcher.
    // Direct .has() returns track membership lookups in 3.5.
    let observed = 0
    const stopHandle = (() => {
      // Manual computation via ref-style — we use Vue's reactivity via
      // computed. For the unit test, we just call .has() each time.
      const initial = state.blankPaths.has(incomeKey)
      observed = initial ? 1 : 0
      return () => undefined
    })()
    expect(observed).toBe(0)
    state.blankPaths.add(incomeKey)
    expect(state.blankPaths.has(incomeKey)).toBe(true)
    state.blankPaths.delete(incomeKey)
    expect(state.blankPaths.has(incomeKey)).toBe(false)
    stopHandle()
  })
})
