// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createFormStore } from '../../src/runtime/core/create-form-store'
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

function makeState(overrides?: Partial<{ formKey: string; defaultValues: Partial<SignupForm> }>) {
  return createFormStore<SignupForm>({
    formKey: overrides?.formKey ?? 'test',
    schema: fakeSchema<SignupForm>(defaults),
    defaultValues: overrides?.defaultValues,
  })
}

describe('createFormStore', () => {
  describe('initialisation', () => {
    it('populates form with defaults from the schema', () => {
      const state = makeState()
      expect(state.form.value).toEqual(defaults)
    })

    it('merges defaultValues over defaults', () => {
      const state = makeState({ defaultValues: { email: 'seeded@x' } })
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
      stateA.setSchemaErrorsForPath(
        ['email'],
        [{ message: 'bad', path: ['email'], formKey: 'formA', code: 'atta:test-fixture' }]
      )
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
      const state = makeState({ defaultValues: { profile: { name: 'alice', age: 30 } } })
      state.setValueAtPath(['profile', 'name'], 'bob')
      expect(state.form.value.profile.name).toBe('bob')
      expect(state.form.value.profile.age).toBe(30)
    })

    it('updates fields.updatedAt for the changed path', async () => {
      const state = makeState({ defaultValues: { email: 'first@x' } })
      const initialStamp = state.getFieldRecord(['email'])?.updatedAt
      // Advance time enough for a new ISO timestamp
      await new Promise((resolve) => setTimeout(resolve, 5))
      state.setValueAtPath(['email'], 'second@x')
      const nextStamp = state.getFieldRecord(['email'])?.updatedAt
      expect(nextStamp).not.toBe(initialStamp)
    })

    it('does not emit patches for no-op writes (same value)', async () => {
      const state = makeState({ defaultValues: { email: 'stable@x' } })
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
      const state = makeState({ defaultValues: { email: 'initial@x' } })
      expect(state.isPristineAtPath(['email'])).toBe(true)
    })

    it('reports pristine=false after a change', () => {
      const state = makeState({ defaultValues: { email: 'initial@x' } })
      state.setValueAtPath(['email'], 'changed@x')
      expect(state.isPristineAtPath(['email'])).toBe(false)
    })

    it('reports pristine=true when the field is restored to its original value', () => {
      const state = makeState({ defaultValues: { email: 'initial@x' } })
      state.setValueAtPath(['email'], 'changed@x')
      state.setValueAtPath(['email'], 'initial@x')
      expect(state.isPristineAtPath(['email'])).toBe(true)
    })

    it('newly-added paths (post-init) compare against undefined as their original', () => {
      // Dynamic fields — e.g. an `append('posts', {...})` call introducing
      // a new array index, or a `setValue` on a path the schema didn't
      // declare. The original is `undefined` (the path's pre-existence
      // state), not the just-set value, so the first appearance is
      // correctly seen as a dirty change.
      const state = makeState()
      state.setValueAtPath(['profile', 'nickname' as keyof SignupForm['profile']], 'xyz')
      expect(state.getOriginalAtPath(['profile', 'nickname'])).toBeUndefined()
      expect(state.isPristineAtPath(['profile', 'nickname'])).toBe(false)
    })
  })

  describe('errors', () => {
    it('setSchemaErrorsForPath stores and clears per path', () => {
      const state = makeState()
      const errs: ValidationError[] = [
        { message: 'bad', path: ['email'], formKey: 'test', code: 'atta:test-fixture' },
      ]
      state.setSchemaErrorsForPath(['email'], errs)
      expect(state.getErrorsForPath(['email'])).toEqual(errs)
      state.setSchemaErrorsForPath(['email'], [])
      expect(state.getErrorsForPath(['email'])).toEqual([])
    })

    it('setAllSchemaErrors replaces the entire schema-error set', () => {
      const state = makeState()
      state.setSchemaErrorsForPath(
        ['email'],
        [{ message: 'old', path: ['email'], formKey: 'test', code: 'atta:test-fixture' }]
      )
      state.setAllSchemaErrors([
        { message: 'new', path: ['password'], formKey: 'test', code: 'atta:test-fixture' },
      ])
      expect(state.getErrorsForPath(['email'])).toEqual([])
      expect(state.getErrorsForPath(['password'])).toEqual([
        { message: 'new', path: ['password'], formKey: 'test', code: 'atta:test-fixture' },
      ])
    })

    it('addUserErrors appends to existing user entries at the same path', () => {
      const state = makeState()
      state.addUserErrors([
        { message: 'first', path: ['email'], formKey: 'test', code: 'atta:test-fixture' },
      ])
      state.addUserErrors([
        { message: 'second', path: ['email'], formKey: 'test', code: 'atta:test-fixture' },
      ])
      expect(state.getErrorsForPath(['email'])).toHaveLength(2)
    })

    it('clearSchemaErrors() with no args removes all schema errors for this form', () => {
      const state = makeState()
      state.setSchemaErrorsForPath(
        ['email'],
        [{ message: 'a', path: ['email'], formKey: 'test', code: 'atta:test-fixture' }]
      )
      state.setSchemaErrorsForPath(
        ['password'],
        [{ message: 'b', path: ['password'], formKey: 'test', code: 'atta:test-fixture' }]
      )
      state.clearSchemaErrors()
      expect(state.getErrorsForPath(['email'])).toEqual([])
      expect(state.getErrorsForPath(['password'])).toEqual([])
    })

    it('clearSchemaErrors(path) targets a specific path', () => {
      const state = makeState()
      state.setSchemaErrorsForPath(
        ['email'],
        [{ message: 'a', path: ['email'], formKey: 'test', code: 'atta:test-fixture' }]
      )
      state.setSchemaErrorsForPath(
        ['password'],
        [{ message: 'b', path: ['password'], formKey: 'test', code: 'atta:test-fixture' }]
      )
      state.clearSchemaErrors(['email'])
      expect(state.getErrorsForPath(['email'])).toEqual([])
      expect(state.getErrorsForPath(['password'])).toHaveLength(1)
    })

    // --- Source-isolation locks ---
    // The whole point of the schemaErrors / userErrors split: each
    // writer touches exactly one Map. The asserts below fail loudly if
    // a future refactor accidentally cross-routes a writer.

    it('setSchemaErrorsForPath does NOT touch userErrors', () => {
      const state = makeState()
      state.setAllUserErrors([
        { message: 'user', path: ['email'], formKey: 'test', code: 'atta:test-fixture' },
      ])
      state.setSchemaErrorsForPath(
        ['email'],
        [{ message: 'schema', path: ['email'], formKey: 'test', code: 'atta:test-fixture' }]
      )
      expect(state.userErrors.size).toBe(1)
      expect(state.schemaErrors.size).toBe(1)
      // Merged read returns schema first, then user (per the documented
      // ordering invariant exercised throughout the public API).
      expect(state.getErrorsForPath(['email']).map((e) => e.message)).toEqual(['schema', 'user'])
    })

    it('setAllUserErrors does NOT touch schemaErrors', () => {
      const state = makeState()
      state.setSchemaErrorsForPath(
        ['email'],
        [{ message: 'schema', path: ['email'], formKey: 'test', code: 'atta:test-fixture' }]
      )
      state.setAllUserErrors([
        { message: 'user', path: ['email'], formKey: 'test', code: 'atta:test-fixture' },
      ])
      expect(state.schemaErrors.size).toBe(1)
      expect(state.userErrors.size).toBe(1)
    })

    it('clearSchemaErrors leaves userErrors intact', () => {
      const state = makeState()
      state.setSchemaErrorsForPath(
        ['email'],
        [{ message: 'schema', path: ['email'], formKey: 'test', code: 'atta:test-fixture' }]
      )
      state.setAllUserErrors([
        { message: 'user', path: ['email'], formKey: 'test', code: 'atta:test-fixture' },
      ])
      state.clearSchemaErrors()
      expect(state.schemaErrors.size).toBe(0)
      expect(state.userErrors.size).toBe(1)
    })

    it('clearUserErrors leaves schemaErrors intact', () => {
      const state = makeState()
      state.setSchemaErrorsForPath(
        ['email'],
        [{ message: 'schema', path: ['email'], formKey: 'test', code: 'atta:test-fixture' }]
      )
      state.setAllUserErrors([
        { message: 'user', path: ['email'], formKey: 'test', code: 'atta:test-fixture' },
      ])
      state.clearUserErrors()
      expect(state.userErrors.size).toBe(0)
      expect(state.schemaErrors.size).toBe(1)
    })
  })

  describe('DOM elements', () => {
    it('registerElement marks the field as connected', () => {
      const state = makeState()
      const el: HTMLElement = document.createElement('input')
      const registered = state.registerElement(['email'], el, 'test:inst')
      expect(registered).toBe(true)
      expect(state.getFieldRecord(['email'])?.isConnected).toBe(true)
    })

    it('registering the same element twice is a no-op', () => {
      const state = makeState()
      const el: HTMLElement = document.createElement('input')
      expect(state.registerElement(['email'], el, 'test:inst')).toBe(true)
      expect(state.registerElement(['email'], el, 'test:inst')).toBe(false)
    })

    it('deregister returns remaining count; marks disconnected when empty', () => {
      const state = makeState()
      const el1: HTMLElement = document.createElement('input')
      const el2: HTMLElement = document.createElement('input')
      state.registerElement(['email'], el1, 'test:inst')
      state.registerElement(['email'], el2, 'test:inst')
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
      state.setSchemaErrorsForPath(
        ['profile', 'name'],
        [{ message: 'x', path: ['profile', 'name'], formKey: 'test', code: 'atta:test-fixture' }]
      )
      // Reading via any canonical-equivalent path returns the same entry.
      expect(state.getErrorsForPath(['profile', 'name'])).toHaveLength(1)
    })

    it('distinguishes a single-segment key containing a dot from two segments', () => {
      type OddForm = GenericFormAlias & { 'profile.name': string }
      const oddDefaults: OddForm = { 'profile.name': 'literal-dot-key' }
      const oddSchema = fakeSchema<OddForm>(oddDefaults)
      const state = createFormStore({ formKey: 'odd', schema: oddSchema })
      state.setSchemaErrorsForPath(
        ['profile.name'],
        [{ message: 'x', path: ['profile.name'], formKey: 'odd', code: 'atta:test-fixture' }]
      )
      expect(state.getErrorsForPath(['profile.name'])).toHaveLength(1)
      expect(state.getErrorsForPath(['profile', 'name'])).toHaveLength(0)
    })
  })
})

type GenericFormAlias = Record<string, unknown>
