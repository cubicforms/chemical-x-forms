// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import { AnonPersistError } from '../../src/runtime/core/errors'
import { buildRegister } from '../../src/runtime/core/register-api'
import { fakeSchema } from '../utils/fake-schema'

type F = { email: string; note: string }

function makeRegister(opts?: { isSSR?: boolean }) {
  const state = createFormStore<F>({
    formKey: `r-${Math.random().toString(36).slice(2)}`,
    schema: fakeSchema<F>({ email: '', note: '' }),
    ...(opts?.isSSR === true ? { isSSR: true } : {}),
  })
  return { state, register: buildRegister(state) }
}

describe('buildRegister', () => {
  describe('RegisterValue shape', () => {
    it('returns innerRef, registerElement, deregisterElement, setValueWithInternalPath', () => {
      const { register } = makeRegister()
      const rv = register(['email'])
      expect(typeof rv.registerElement).toBe('function')
      expect(typeof rv.deregisterElement).toBe('function')
      expect(typeof rv.setValueWithInternalPath).toBe('function')
      expect(rv.innerRef).toBeDefined()
    })

    it('innerRef reflects current form value', () => {
      const { state, register } = makeRegister()
      const rv = register(['email'])
      expect(rv.innerRef.value).toBe('')
      state.setValueAtPath(['email'], 'typed@x')
      expect(rv.innerRef.value).toBe('typed@x')
    })

    it('setValueWithInternalPath writes to the form', () => {
      const { state, register } = makeRegister()
      const rv = register(['email'])
      rv.setValueWithInternalPath('written@x')
      expect(state.form.value.email).toBe('written@x')
    })
  })

  describe('element registration', () => {
    it('registers interactive elements and tracks connection', () => {
      const { state, register } = makeRegister()
      const rv = register(['email'])
      const input = document.createElement('input')
      rv.registerElement(input)
      expect(state.getFieldRecord(['email'])?.isConnected).toBe(true)
    })

    it('skips non-interactive elements silently', () => {
      const { state, register } = makeRegister()
      const rv = register(['email'])
      const div = document.createElement('div')
      rv.registerElement(div)
      // The field record exists (from init) but was not connected via this call.
      expect(state.getFieldRecord(['email'])?.isConnected).toBe(false)
    })

    it('attaches focus/blur listeners that drive markFocused', () => {
      const { state, register } = makeRegister()
      const rv = register(['email'])
      const input = document.createElement('input')
      document.body.appendChild(input)
      rv.registerElement(input)

      input.dispatchEvent(new FocusEvent('focus'))
      expect(state.getFieldRecord(['email'])?.focused).toBe(true)

      input.dispatchEvent(new FocusEvent('blur'))
      expect(state.getFieldRecord(['email'])?.focused).toBe(false)
      expect(state.getFieldRecord(['email'])?.touched).toBe(true)

      document.body.removeChild(input)
    })

    it('removes focus/blur listeners on deregister', () => {
      const { state, register } = makeRegister()
      const rv = register(['email'])
      const input = document.createElement('input')
      document.body.appendChild(input)
      rv.registerElement(input)
      // Cause a change so we can tell if post-deregister events sneak through.
      input.dispatchEvent(new FocusEvent('focus'))
      expect(state.getFieldRecord(['email'])?.focused).toBe(true)

      rv.deregisterElement(input)
      // After deregister, re-dispatch: if a listener still fires, focused flips.
      input.dispatchEvent(new FocusEvent('blur'))
      // markFocused isn't called post-deregister — the record still reflects
      // the last value before deregister.
      expect(state.getFieldRecord(['email'])?.focused).toBe(true)
      expect(state.getFieldRecord(['email'])?.isConnected).toBe(false)
      document.body.removeChild(input)
    })
  })

  describe('cross-form isolation', () => {
    it('two registers for different forms do not share DOM state', () => {
      const stateA = createFormStore<F>({
        formKey: 'A',
        schema: fakeSchema<F>({ email: '', note: '' }),
      })
      const stateB = createFormStore<F>({
        formKey: 'B',
        schema: fakeSchema<F>({ email: '', note: '' }),
      })
      const registerA = buildRegister(stateA)
      const registerB = buildRegister(stateB)

      const rvA = registerA(['email'])
      const rvB = registerB(['email'])

      const input = document.createElement('input')
      document.body.appendChild(input)
      rvA.registerElement(input)

      expect(stateA.getFieldRecord(['email'])?.isConnected).toBe(true)
      expect(stateB.getFieldRecord(['email'])?.isConnected).toBe(false)

      // Writing to A's registerValue doesn't touch B.
      rvA.setValueWithInternalPath('only-in-A')
      expect(stateA.form.value.email).toBe('only-in-A')
      expect(stateB.form.value.email).toBe('')

      rvA.deregisterElement(input)
      document.body.removeChild(input)
      void rvB
    })
  })

  describe('persist contradiction throw', () => {
    it('does NOT throw during SSR even when persistence module is absent', () => {
      // SSR deliberately skips wirePersistence (persistence is a
      // client-only concern), so during the server pass `state.modules`
      // never carries a persistence entry — even when the consumer DID
      // configure `persist:` on useForm(). Without an SSR gate, every
      // server render of `register({ persist: true })` would falsely
      // throw. The client-side hydration pass re-checks against a
      // freshly-wired module and throws correctly if the misuse is real.
      const { register } = makeRegister({ isSSR: true })
      expect(() => register('email', { persist: true })).not.toThrow()
    })

    it('throws AnonPersistError(register-without-config) off-SSR when persistence module is absent and the binding opts in', () => {
      const { register } = makeRegister()
      let thrown: unknown
      try {
        register('note', { persist: true })
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(AnonPersistError)
      expect((thrown as AnonPersistError).cause).toBe('register-without-config')
    })
  })
})
