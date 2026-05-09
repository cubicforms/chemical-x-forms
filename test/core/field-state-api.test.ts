import { describe, expect, it } from 'vitest'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import { buildFieldStateAccessor } from '../../src/runtime/core/field-state-api'
import { canonicalizePath } from '../../src/runtime/core/paths'
import { fakeSchema } from '../utils/fake-schema'

type F = { email: string; profile: { name: string } }

function makeAccessor() {
  const state = createFormStore<F>({
    formKey: 'fs',
    schema: fakeSchema<F>({ email: 'initial@x', profile: { name: '' } }),
  })
  // Stub out `getFormMetaBase`; these tests don't exercise
  // `showErrors` / `firstError`, only the underlying field
  // aggregation. The predicate path is exercised in
  // `test/composables/should-show-errors.test.ts` where a real form
  // is mounted with the production code path. The cast bypasses the
  // full `FormMetaBase` shape (would require duplicating every
  // FieldState field) — fine for a test stub that's never read.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const getFormMetaBase = () => ({ submitCount: 0 }) as never
  return { state, getFieldState: buildFieldStateAccessor(state, getFormMetaBase) }
}

describe('buildFieldStateAccessor', () => {
  it('reports the current value, original, and pristine status', () => {
    const { getFieldState } = makeAccessor()
    const s = getFieldState(['email'])
    expect(s.value.value).toBe('initial@x')
    expect(s.value.original).toBe('initial@x')
    expect(s.value.pristine).toBe(true)
    expect(s.value.dirty).toBe(false)
  })

  it('flips dirty after a mutation', () => {
    const { state, getFieldState } = makeAccessor()
    const s = getFieldState(['email'])
    state.setValueAtPath(['email'], 'changed@x')
    expect(s.value.value).toBe('changed@x')
    expect(s.value.dirty).toBe(true)
    expect(s.value.pristine).toBe(false)
  })

  it('returns the canonical path (for dotted input)', () => {
    const { getFieldState } = makeAccessor()
    const s = getFieldState('profile.name')
    expect(s.value.path).toEqual(['profile', 'name'])
  })

  it('returns empty errors array for fields without errors', () => {
    const { getFieldState } = makeAccessor()
    expect(getFieldState(['email']).value.errors).toEqual([])
  })

  it('reflects errors set on the state', () => {
    const { state, getFieldState } = makeAccessor()
    state.setSchemaErrorsForPath(
      ['email'],
      [{ message: 'bad', path: ['email'], formKey: 'fs', code: 'atta:test-fixture' }]
    )
    expect(getFieldState(['email']).value.errors).toHaveLength(1)
  })

  it('focused/blurred/touched default to null until focus events fire', () => {
    const { getFieldState } = makeAccessor()
    const s = getFieldState(['email']).value
    expect(s.focused).toBe(null)
    expect(s.blurred).toBe(null)
    expect(s.touched).toBe(null)
  })

  it('connected flips to true when an element registers, back to false when all deregister', () => {
    // @vitest-environment jsdom is not active here; use a minimal element stub.
    // The state layer doesn't touch DOM, only stores HTMLElement references in a Set.
    const { state, getFieldState } = makeAccessor()
    // structuredClone approach would need HTMLElement — simplest: cast a plain object.
    // We accept the cast here at the boundary between DOM and state test.
    const pretend = { nodeType: 1, tagName: 'INPUT' } as unknown as HTMLElement
    state.registerElement(['email'], pretend, 'test:inst')
    expect(getFieldState(['email']).value.connected).toBe(true)
    state.deregisterElement(['email'], pretend)
    expect(getFieldState(['email']).value.connected).toBe(false)
  })

  // Per-field `validating` is driven by the FormStore's
  // `fieldValidationCounts` reactive Map. These tests poke the map
  // directly (the unit-of-work for the accessor) — see
  // `test/composables/async-validation.test.ts` for the integration
  // path through `scheduleFieldValidation`.
  describe('validating', () => {
    it('defaults to false when no validation is in flight', () => {
      const { getFieldState } = makeAccessor()
      expect(getFieldState(['email']).value.validating).toBe(false)
      expect(getFieldState('profile.name').value.validating).toBe(false)
    })

    it('flips true when the count for the path is positive, back to false when it returns to zero', () => {
      const { state, getFieldState } = makeAccessor()
      const s = getFieldState(['email'])
      const emailKey = canonicalizePath(['email']).key
      state.fieldValidationCounts.set(emailKey, 1)
      expect(s.value.validating).toBe(true)
      state.fieldValidationCounts.set(emailKey, 0)
      // 0 is treated as "not validating" — and the production helpers
      // delete the key at zero, but reading via `.get(key) ?? 0`
      // covers either shape.
      expect(s.value.validating).toBe(false)
      state.fieldValidationCounts.delete(emailKey)
      expect(s.value.validating).toBe(false)
    })

    it('per-key tracking — sibling paths flip independently', () => {
      const { state, getFieldState } = makeAccessor()
      const email = getFieldState(['email'])
      const name = getFieldState('profile.name')
      const emailKey = canonicalizePath(['email']).key
      const nameKey = canonicalizePath(['profile', 'name']).key
      state.fieldValidationCounts.set(emailKey, 1)
      expect(email.value.validating).toBe(true)
      expect(name.value.validating).toBe(false)
      state.fieldValidationCounts.set(nameKey, 1)
      expect(email.value.validating).toBe(true)
      expect(name.value.validating).toBe(true)
      state.fieldValidationCounts.delete(emailKey)
      expect(email.value.validating).toBe(false)
      expect(name.value.validating).toBe(true)
    })

    it('couples with field.valid — true when neither errors nor in-flight, false otherwise', () => {
      const { state, getFieldState } = makeAccessor()
      const s = getFieldState(['email'])
      const key = canonicalizePath(['email']).key

      // Mount-clean state: no errors, no in-flight.
      expect(s.value.validating).toBe(false)
      expect(s.value.errors).toEqual([])
      expect(s.value.valid).toBe(true)

      // In-flight flips valid to false.
      state.fieldValidationCounts.set(key, 1)
      expect(s.value.validating).toBe(true)
      expect(s.value.valid).toBe(false)

      // Settled but no errors → valid again.
      state.fieldValidationCounts.delete(key)
      expect(s.value.valid).toBe(true)

      // Errors present → valid false even when not in-flight.
      state.setSchemaErrorsForPath(
        ['email'],
        [{ message: 'bad', path: ['email'], formKey: 'fs', code: 'atta:test-fixture' }]
      )
      expect(s.value.errors).toHaveLength(1)
      expect(s.value.valid).toBe(false)
    })

    it('overlapping runs (count > 1) keep the field validating across the abort/restart boundary', () => {
      // This is the regression guard called out in the plan: a Set
      // would briefly clear membership between an aborted run's
      // delete and a fresh run's insert; a counter stays > 0
      // throughout. Drive the count directly to assert the accessor
      // honours the > 0 semantic.
      const { state, getFieldState } = makeAccessor()
      const s = getFieldState(['email'])
      const key = canonicalizePath(['email']).key
      state.fieldValidationCounts.set(key, 1) // run A starts
      state.fieldValidationCounts.set(key, 2) // run B starts before A's finally
      expect(s.value.validating).toBe(true)
      state.fieldValidationCounts.set(key, 1) // run A's finally fires
      expect(s.value.validating).toBe(true) // still validating because B is in flight
      state.fieldValidationCounts.delete(key) // run B's finally fires
      expect(s.value.validating).toBe(false)
    })
  })

  // `element` / `elements` expose the live registered DOM bindings so
  // consumers can call native methods (`focus()`, `scrollIntoView()`)
  // without the library having to verb every imperative. Reactivity
  // comes from the FormStore's reactive elements Map (per-key) and
  // its inner reactive Set (per-membership inside one path).
  describe('element / elements', () => {
    it('default to null and [] when nothing is registered', () => {
      const { getFieldState } = makeAccessor()
      const s = getFieldState(['email'])
      expect(s.value.element).toBe(null)
      expect(s.value.elements).toEqual([])
    })

    it('first registration populates both — element is the first by registration order', () => {
      const { state, getFieldState } = makeAccessor()
      const s = getFieldState(['email'])
      const a = { nodeType: 1, tagName: 'INPUT' } as unknown as HTMLElement
      state.registerElement(['email'], a, 'inst')
      expect(s.value.element).toBe(a)
      expect(s.value.elements).toEqual([a])
    })

    it('multiple registrations to the same path preserve insertion order; element stays first', () => {
      const { state, getFieldState } = makeAccessor()
      const s = getFieldState(['email'])
      const a = { nodeType: 1, tagName: 'INPUT' } as unknown as HTMLElement
      const b = { nodeType: 1, tagName: 'INPUT' } as unknown as HTMLElement
      state.registerElement(['email'], a, 'inst')
      state.registerElement(['email'], b, 'inst')
      expect(s.value.elements).toEqual([a, b])
      expect(s.value.element).toBe(a)
    })

    it('deregistering the first element promotes the second to element', () => {
      const { state, getFieldState } = makeAccessor()
      const s = getFieldState(['email'])
      const a = { nodeType: 1, tagName: 'INPUT' } as unknown as HTMLElement
      const b = { nodeType: 1, tagName: 'INPUT' } as unknown as HTMLElement
      state.registerElement(['email'], a, 'inst')
      state.registerElement(['email'], b, 'inst')
      state.deregisterElement(['email'], a)
      expect(s.value.elements).toEqual([b])
      expect(s.value.element).toBe(b)
    })

    it('deregistering all elements returns the accessors to null / []', () => {
      const { state, getFieldState } = makeAccessor()
      const s = getFieldState(['email'])
      const a = { nodeType: 1, tagName: 'INPUT' } as unknown as HTMLElement
      state.registerElement(['email'], a, 'inst')
      state.deregisterElement(['email'], a)
      expect(s.value.element).toBe(null)
      expect(s.value.elements).toEqual([])
    })

    it('per-path isolation — sibling registrations stay scoped', () => {
      const { state, getFieldState } = makeAccessor()
      const email = getFieldState(['email'])
      const name = getFieldState('profile.name')
      const a = { nodeType: 1, tagName: 'INPUT' } as unknown as HTMLElement
      state.registerElement(['email'], a, 'inst')
      expect(email.value.elements).toEqual([a])
      expect(name.value.elements).toEqual([])
    })
  })
})

// Per-path memoisation guarantees that consumers reading the same
// path multiple times share the same `ComputedRef` — Vue's
// dependency tracking then accumulates one subscription per path,
// not one per read.
describe('buildFieldStateAccessor — per-path memoisation', () => {
  it('returns the same ComputedRef on repeated calls with the same path', () => {
    const { getFieldState } = makeAccessor()
    const a = getFieldState(['email'])
    const b = getFieldState(['email'])
    expect(a).toBe(b)
  })

  it('treats dotted-string and array paths as the same canonical key', () => {
    const { getFieldState } = makeAccessor()
    const fromDotted = getFieldState('profile.name')
    const fromArray = getFieldState(['profile', 'name'])
    expect(fromDotted).toBe(fromArray)
  })

  it('hands different paths their own ComputedRefs', () => {
    const { getFieldState } = makeAccessor()
    const a = getFieldState(['email'])
    const b = getFieldState(['profile', 'name'])
    expect(a).not.toBe(b)
  })
})

// Container aggregation — `getFieldState(containerPath)` returns
// disjunction-aggregated event-presence (focused / dirty / touched
// / validating) and conjunction-aggregated absence/uniformity
// (pristine / valid / blank). Errors concat. updatedAt is the max
// ISO timestamp across descendants.
describe('buildFieldStateAccessor — container aggregation', () => {
  type C = {
    pickup: { city: string; zip: string }
    delivery: { city: string }
  }
  function makeContainerAccessor() {
    const state = createFormStore<C>({
      formKey: 'cont',
      schema: fakeSchema<C>({
        pickup: { city: '', zip: '' },
        delivery: { city: '' },
      }),
    })
    // Stub out `getFormMetaBase`; container-aggregation coverage
    // here doesn't run the `shouldShowErrors` predicate. Real-form
    // tests for the predicate live in
    // `test/composables/should-show-errors.test.ts`.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const getFormMetaBase = () => ({ submitCount: 0 }) as never
    return { state, getFieldState: buildFieldStateAccessor(state, getFormMetaBase) }
  }

  it('container.pristine is true while all descendants are pristine', () => {
    const { getFieldState } = makeContainerAccessor()
    const pickup = getFieldState(['pickup'])
    expect(pickup.value.pristine).toBe(true)
    expect(pickup.value.dirty).toBe(false)
  })

  it('container.dirty flips on the first descendant mutation', () => {
    const { state, getFieldState } = makeContainerAccessor()
    const pickup = getFieldState(['pickup'])
    state.setValueAtPath(['pickup', 'city'], 'NYC')
    expect(pickup.value.pristine).toBe(false)
    expect(pickup.value.dirty).toBe(true)
  })

  it('siblings are not affected by container.dirty under another path', () => {
    const { state, getFieldState } = makeContainerAccessor()
    const pickup = getFieldState(['pickup'])
    const delivery = getFieldState(['delivery'])
    state.setValueAtPath(['pickup', 'city'], 'NYC')
    expect(pickup.value.dirty).toBe(true)
    expect(delivery.value.dirty).toBe(false)
  })

  it('container.focused is true when any descendant is focused', () => {
    const { state, getFieldState } = makeContainerAccessor()
    const pickup = getFieldState(['pickup'])
    expect(pickup.value.focused).toBe(false)
    const cityKey = canonicalizePath(['pickup', 'city']).key
    state.fields.set(cityKey, {
      path: ['pickup', 'city'],
      updatedAt: null,
      connected: false,
      focused: true,
      blurred: false,
      touched: false,
    })
    expect(pickup.value.focused).toBe(true)
  })

  it('container.errors aggregates descendants in lex path order', () => {
    const { state, getFieldState } = makeContainerAccessor()
    const pickup = getFieldState(['pickup'])
    state.setSchemaErrorsForPath(
      ['pickup', 'city'],
      [{ message: 'missing city', path: ['pickup', 'city'], formKey: 'cont', code: 'atta:test' }]
    )
    state.setSchemaErrorsForPath(
      ['pickup', 'zip'],
      [{ message: 'missing zip', path: ['pickup', 'zip'], formKey: 'cont', code: 'atta:test' }]
    )
    expect(pickup.value.errors.map((e) => e.message)).toEqual(['missing city', 'missing zip'])
  })

  it('container.valid is true only when descendants have no errors and no async pending', () => {
    const { state, getFieldState } = makeContainerAccessor()
    const pickup = getFieldState(['pickup'])
    expect(pickup.value.valid).toBe(true)
    state.setSchemaErrorsForPath(
      ['pickup', 'city'],
      [{ message: 'bad', path: ['pickup', 'city'], formKey: 'cont', code: 'atta:test' }]
    )
    expect(pickup.value.valid).toBe(false)
  })

  it('root path (empty segments) aggregates over the whole form', () => {
    const { state, getFieldState } = makeContainerAccessor()
    const root = getFieldState([])
    expect(root.value.pristine).toBe(true)
    state.setValueAtPath(['delivery', 'city'], 'NYC')
    expect(root.value.pristine).toBe(false)
    expect(root.value.dirty).toBe(true)
  })

  it('container.element is null and elements is empty (containers do not bind to DOM)', () => {
    const { getFieldState } = makeContainerAccessor()
    const pickup = getFieldState(['pickup'])
    expect(pickup.value.element).toBe(null)
    expect(pickup.value.elements).toEqual([])
  })
})
