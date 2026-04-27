// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createFormStore } from '../../src/runtime/core/create-form-store'
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

  describe('dev warnings', () => {
    it('does NOT warn during SSR even when persistence module is absent', () => {
      // SSR deliberately skips wirePersistence (persistence is a
      // client-only concern), so during the server pass `state.modules`
      // never carries a persistence entry — even when the consumer DID
      // configure `persist:` on useForm(). Without an SSR gate, the
      // "register({ persist: true }) without persist: configured"
      // warning would falsely fire on every server render.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const { register } = makeRegister({ isSSR: true })
        register('email', { persist: true })
        const matches = warnSpy.mock.calls
          .map((args) => args.join(' '))
          .filter((msg) => /no `persist:` option is configured/.test(msg))
        expect(matches).toEqual([])
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('DOES warn off-SSR when persistence module is absent and the binding opts in', () => {
      // The actual misuse case: client-side render, no persistence module
      // (because `useForm()` had no `persist:` option), but a binding asks
      // to opt in. This is the warning's intended trigger.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const { register } = makeRegister()
        register('note', { persist: true })
        const matches = warnSpy.mock.calls
          .map((args) => args.join(' '))
          .filter((msg) => /no `persist:` option is configured/.test(msg))
        expect(matches.length).toBe(1)
      } finally {
        warnSpy.mockRestore()
      }
    })
  })
})
