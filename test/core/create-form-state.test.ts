// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createFormState } from '../../src/runtime/core/create-form-state'
import type { ValidationError } from '../../src/runtime/types/types-api'
import { fakeSchema } from '../utils/fake-schema'

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

function makeState(overrides?: Partial<{ formKey: string; initialState: Partial<SignupForm> }>) {
  return createFormState<SignupForm>({
    formKey: overrides?.formKey ?? 'test',
    schema: fakeSchema<SignupForm>(defaults),
    initialState: overrides?.initialState,
  })
}

describe('createFormState', () => {
  describe('initialisation', () => {
    it('populates form with defaults from the schema', () => {
      const state = makeState()
      expect(state.form.value).toEqual(defaults)
    })

    it('merges initialState over defaults', () => {
      const state = makeState({ initialState: { email: 'seeded@x' } })
      expect(state.form.value.email).toBe('seeded@x')
      expect(state.form.value.password).toBe('')
    })

    it('populates originals for every initial leaf path', () => {
      const state = makeState()
      expect(state.getOriginalAtPath(['email'])).toBe('')
      expect(state.getOriginalAtPath(['profile', 'name'])).toBe('')
      expect(state.getOriginalAtPath(['profile', 'age'])).toBe(0)
    })

    it('populates fields with updatedAt timestamps for every initial leaf', () => {
      const state = makeState()
      const emailField = state.getFieldRecord(['email'])
      expect(emailField).toBeDefined()
      expect(emailField?.updatedAt).toBeTypeOf('string')
      expect(emailField?.isConnected).toBe(false)
      expect(emailField?.focused).toBe(null)
      expect(emailField?.blurred).toBe(null)
      expect(emailField?.touched).toBe(null)
    })
  })

  describe('cross-form isolation (the core motivation)', () => {
    it('two forms with identical field names do not share state', () => {
      // This is the regression we're fixing. Pre-rewrite, the element store
      // and DOM field-state store were global useState maps keyed only by
      // path; both forms' `email` fields aliased onto the same records.
      const stateA = makeState({ formKey: 'formA' })
      const stateB = makeState({ formKey: 'formB' })
      stateA.setValueAtPath(['email'], 'a@a')
      stateB.setValueAtPath(['email'], 'b@b')
      expect(stateA.form.value.email).toBe('a@a')
      expect(stateB.form.value.email).toBe('b@b')
    })

    it('focus state in one form does not leak into another form with the same field name', () => {
      const stateA = makeState({ formKey: 'formA' })
      const stateB = makeState({ formKey: 'formB' })
      stateA.markFocused(['email'], true)
      expect(stateA.getFieldRecord(['email'])?.focused).toBe(true)
      expect(stateB.getFieldRecord(['email'])?.focused).toBe(null)
    })

    it('errors in one form do not leak into another form with the same field name', () => {
      const stateA = makeState({ formKey: 'formA' })
      const stateB = makeState({ formKey: 'formB' })
      stateA.setErrorsForPath(['email'], [{ message: 'bad', path: ['email'], formKey: 'formA' }])
      expect(stateA.getErrorsForPath(['email'])).toHaveLength(1)
      expect(stateB.getErrorsForPath(['email'])).toHaveLength(0)
    })
  })

  describe('setValueAtPath', () => {
    it('updates the form value at the given path', () => {
      const state = makeState()
      state.setValueAtPath(['email'], 'new@x')
      expect(state.form.value.email).toBe('new@x')
    })

    it('preserves sibling values when updating a nested path', () => {
      const state = makeState({ initialState: { profile: { name: 'alice', age: 30 } } })
      state.setValueAtPath(['profile', 'name'], 'bob')
      expect(state.form.value.profile.name).toBe('bob')
      expect(state.form.value.profile.age).toBe(30)
    })

    it('updates fields.updatedAt for the changed path', async () => {
      const state = makeState({ initialState: { email: 'first@x' } })
      const initialStamp = state.getFieldRecord(['email'])?.updatedAt
      // Advance time enough for a new ISO timestamp
      await new Promise((resolve) => setTimeout(resolve, 5))
      state.setValueAtPath(['email'], 'second@x')
      const nextStamp = state.getFieldRecord(['email'])?.updatedAt
      expect(nextStamp).not.toBe(initialStamp)
    })

    it('does not emit patches for no-op writes (same value)', async () => {
      const state = makeState({ initialState: { email: 'stable@x' } })
      const initialStamp = state.getFieldRecord(['email'])?.updatedAt
      await new Promise((resolve) => setTimeout(resolve, 5))
      // Applying the same form value: Object.is bails out; no per-field touching.
      state.applyFormReplacement(state.form.value)
      const nextStamp = state.getFieldRecord(['email'])?.updatedAt
      expect(nextStamp).toBe(initialStamp)
    })
  })

  describe('originals and pristine/dirty', () => {
    it('reports pristine=true when the field is untouched since init', () => {
      const state = makeState({ initialState: { email: 'initial@x' } })
      expect(state.isPristineAtPath(['email'])).toBe(true)
    })

    it('reports pristine=false after a change', () => {
      const state = makeState({ initialState: { email: 'initial@x' } })
      state.setValueAtPath(['email'], 'changed@x')
      expect(state.isPristineAtPath(['email'])).toBe(false)
    })

    it('reports pristine=true when the field is restored to its original value', () => {
      const state = makeState({ initialState: { email: 'initial@x' } })
      state.setValueAtPath(['email'], 'changed@x')
      state.setValueAtPath(['email'], 'initial@x')
      expect(state.isPristineAtPath(['email'])).toBe(true)
    })

    it('newly-added paths (post-init) get their first-seen value as their original', () => {
      // dynamic fields: assume the form grew a new key after init
      const state = makeState()
      state.setValueAtPath(['profile', 'nickname' as keyof SignupForm['profile']], 'xyz')
      expect(state.getOriginalAtPath(['profile', 'nickname'])).toBe('xyz')
    })
  })

  describe('errors', () => {
    it('setErrorsForPath stores and clears per path', () => {
      const state = makeState()
      const errs: ValidationError[] = [{ message: 'bad', path: ['email'], formKey: 'test' }]
      state.setErrorsForPath(['email'], errs)
      expect(state.getErrorsForPath(['email'])).toEqual(errs)
      state.setErrorsForPath(['email'], [])
      expect(state.getErrorsForPath(['email'])).toEqual([])
    })

    it('setAllErrors replaces the entire error set', () => {
      const state = makeState()
      state.setErrorsForPath(['email'], [{ message: 'old', path: ['email'], formKey: 'test' }])
      state.setAllErrors([{ message: 'new', path: ['password'], formKey: 'test' }])
      expect(state.getErrorsForPath(['email'])).toEqual([])
      expect(state.getErrorsForPath(['password'])).toEqual([
        { message: 'new', path: ['password'], formKey: 'test' },
      ])
    })

    it('addErrors appends to existing entries at the same path', () => {
      const state = makeState()
      state.addErrors([{ message: 'first', path: ['email'], formKey: 'test' }])
      state.addErrors([{ message: 'second', path: ['email'], formKey: 'test' }])
      expect(state.getErrorsForPath(['email'])).toHaveLength(2)
    })

    it('clearErrors() with no args removes all errors for this form', () => {
      const state = makeState()
      state.setErrorsForPath(['email'], [{ message: 'a', path: ['email'], formKey: 'test' }])
      state.setErrorsForPath(['password'], [{ message: 'b', path: ['password'], formKey: 'test' }])
      state.clearErrors()
      expect(state.getErrorsForPath(['email'])).toEqual([])
      expect(state.getErrorsForPath(['password'])).toEqual([])
    })

    it('clearErrors(path) targets a specific path', () => {
      const state = makeState()
      state.setErrorsForPath(['email'], [{ message: 'a', path: ['email'], formKey: 'test' }])
      state.setErrorsForPath(['password'], [{ message: 'b', path: ['password'], formKey: 'test' }])
      state.clearErrors(['email'])
      expect(state.getErrorsForPath(['email'])).toEqual([])
      expect(state.getErrorsForPath(['password'])).toHaveLength(1)
    })
  })

  describe('DOM elements', () => {
    it('registerElement marks the field as connected', () => {
      const state = makeState()
      const el: HTMLElement = document.createElement('input')
      const registered = state.registerElement(['email'], el)
      expect(registered).toBe(true)
      expect(state.getFieldRecord(['email'])?.isConnected).toBe(true)
    })

    it('registering the same element twice is a no-op', () => {
      const state = makeState()
      const el: HTMLElement = document.createElement('input')
      expect(state.registerElement(['email'], el)).toBe(true)
      expect(state.registerElement(['email'], el)).toBe(false)
    })

    it('deregister returns remaining count; marks disconnected when empty', () => {
      const state = makeState()
      const el1: HTMLElement = document.createElement('input')
      const el2: HTMLElement = document.createElement('input')
      state.registerElement(['email'], el1)
      state.registerElement(['email'], el2)
      expect(state.deregisterElement(['email'], el1)).toBe(1)
      expect(state.getFieldRecord(['email'])?.isConnected).toBe(true)
      expect(state.deregisterElement(['email'], el2)).toBe(0)
      expect(state.getFieldRecord(['email'])?.isConnected).toBe(false)
    })
  })

  describe('focus / touched state', () => {
    it('markFocused(true) sets focused=true, blurred=false', () => {
      const state = makeState()
      state.markFocused(['email'], true)
      const field = state.getFieldRecord(['email'])
      expect(field?.focused).toBe(true)
      expect(field?.blurred).toBe(false)
    })

    it('markFocused(false) sets focused=false, blurred=true, touched=true', () => {
      const state = makeState()
      state.markFocused(['email'], false)
      const field = state.getFieldRecord(['email'])
      expect(field?.focused).toBe(false)
      expect(field?.blurred).toBe(true)
      expect(field?.touched).toBe(true)
    })

    it('markFocused(true) on a never-touched field preserves touched=null', () => {
      const state = makeState()
      state.markFocused(['email'], true)
      expect(state.getFieldRecord(['email'])?.touched).toBe(null)
    })

    it('markFocused(true) after a blur keeps touched=true', () => {
      const state = makeState()
      state.markFocused(['email'], false)
      state.markFocused(['email'], true)
      expect(state.getFieldRecord(['email'])?.touched).toBe(true)
    })
  })

  describe('structured-path key collisions', () => {
    it("treats 'user.name' (dotted) and ['user', 'name'] (array) as the same path", () => {
      const state = makeState()
      state.setErrorsForPath(
        ['profile', 'name'],
        [{ message: 'x', path: ['profile', 'name'], formKey: 'test' }]
      )
      // Reading via any canonical-equivalent path returns the same entry.
      expect(state.getErrorsForPath(['profile', 'name'])).toHaveLength(1)
    })

    it('distinguishes a single-segment key containing a dot from two segments', () => {
      type OddForm = GenericFormAlias & { 'profile.name': string }
      const oddDefaults: OddForm = { 'profile.name': 'literal-dot-key' }
      const oddSchema = fakeSchema<OddForm>(oddDefaults)
      const state = createFormState({ formKey: 'odd', schema: oddSchema })
      state.setErrorsForPath(
        ['profile.name'],
        [{ message: 'x', path: ['profile.name'], formKey: 'odd' }]
      )
      expect(state.getErrorsForPath(['profile.name'])).toHaveLength(1)
      expect(state.getErrorsForPath(['profile', 'name'])).toHaveLength(0)
    })
  })
})

type GenericFormAlias = Record<string, unknown>
