import { describe, expect, it } from 'vitest'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import { buildFieldStateAccessor } from '../../src/runtime/core/field-state-api'
import { fakeSchema } from '../utils/fake-schema'

type F = { email: string; profile: { name: string } }

function makeAccessor() {
  const state = createFormStore<F>({
    formKey: 'fs',
    schema: fakeSchema<F>({ email: 'initial@x', profile: { name: '' } }),
  })
  return { state, getFieldState: buildFieldStateAccessor(state) }
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

  it('isConnected flips to true when an element registers, back to false when all deregister', () => {
    // @vitest-environment jsdom is not active here; use a minimal element stub.
    // The state layer doesn't touch DOM, only stores HTMLElement references in a Set.
    const { state, getFieldState } = makeAccessor()
    // structuredClone approach would need HTMLElement — simplest: cast a plain object.
    // We accept the cast here at the boundary between DOM and state test.
    const pretend = { nodeType: 1, tagName: 'INPUT' } as unknown as HTMLElement
    state.registerElement(['email'], pretend, 'test:inst')
    expect(getFieldState(['email']).value.isConnected).toBe(true)
    state.deregisterElement(['email'], pretend)
    expect(getFieldState(['email']).value.isConnected).toBe(false)
  })
})
