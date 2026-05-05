// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { computed, isRef } from 'vue'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import { AnonPersistError } from '../../src/runtime/core/errors'
import { buildRegister } from '../../src/runtime/core/register-api'
import { fakeSchema } from '../utils/fake-schema'

type F = { email: string; note: string }

function makeRegister(opts?: { isSSR?: boolean; formKey?: string; instanceId?: string }) {
  const state = createFormStore<F>({
    formKey: opts?.formKey ?? `r-${Math.random().toString(36).slice(2)}`,
    schema: fakeSchema<F>({ email: '', note: '' }),
    ...(opts?.isSSR === true ? { isSSR: true } : {}),
  })
  return { state, register: buildRegister(state, opts?.instanceId ?? 'test:inst') }
}

describe('buildRegister', () => {
  describe('RegisterValue shape', () => {
    it('returns innerRef, registerElement, deregisterElement, setValueWithInternalPath', () => {
      const { register } = makeRegister()
      const rv = register(['email'])
      expect(typeof rv.registerElement).toBe('function')
      expect(typeof rv.deregisterElement).toBe('function')
      expect(typeof rv.setValueWithInternalPath).toBe('function')
      // Tightened from `.toBeDefined()` — the contract is a Vue Ref,
      // not an arbitrary non-undefined value.
      expect(isRef(rv.innerRef)).toBe(true)
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

  describe('wrapper-component primitives (path, segments, formKey, formInstanceId)', () => {
    // These four fields are the wrapper-component story: a generic
    // child using `useRegister()` derives field state and form
    // identity from them without re-threading props from the parent.

    it('exposes the canonical PathKey string', () => {
      const { register } = makeRegister()
      const rv = register(['email'])
      // PathKey is the JSON-encoded segment array — opaque, stable for
      // Map/Set keys, equality, and log strings.
      expect(rv.path).toBe('["email"]')
      expect(typeof rv.path).toBe('string')
      expect(isRef(rv.path)).toBe(false)
    })

    it('canonicalises array and dotted paths to the same PathKey', () => {
      const { register } = makeRegister()
      expect(register(['email']).path).toBe(register('email').path)
    })

    it('exposes structured segments for form.fields(rv.segments) lookups', () => {
      const { register } = makeRegister()
      expect(register('email').segments).toEqual(['email'])
      expect(register(['items', 0, 'name']).segments).toEqual(['items', 0, 'name'])
    })

    it('freezes segments so wrapper components can pass them without copying', () => {
      const { register } = makeRegister()
      const rv = register(['email'])
      expect(Object.isFrozen(rv.segments)).toBe(true)
    })

    it('exposes the form key from the FormStore', () => {
      const { register } = makeRegister({ formKey: 'signup-form' })
      const rv = register(['email'])
      expect(rv.formKey).toBe('signup-form')
    })

    it('exposes the formInstanceId passed to buildRegister', () => {
      const { register } = makeRegister({ instanceId: 'inst-42' })
      const rv = register(['email'])
      expect(rv.formInstanceId).toBe('inst-42')
    })

    it('reads track via the shallowReadonly proxy in a computed scope', () => {
      // Vue's shallowReadonly proxy registers reads as dependencies.
      // The values themselves never mutate within an RV's lifetime
      // (path / formKey / formInstanceId are baked at construction),
      // but the tracking pass should still visit them — important
      // for wrapper-component patterns that read these inside a
      // `computed(() => form.fields(rv.value?.segments))` derivation.
      const { register } = makeRegister({ formKey: 'k', instanceId: 'i' })
      const rv = register(['email'])
      const derived = computed(() => `${rv.formKey}:${rv.formInstanceId}:${rv.segments.join('.')}`)
      expect(derived.value).toBe('k:i:email')
    })

    it('blocks direct field mutation under shallowReadonly', () => {
      const { register } = makeRegister()
      const rv = register(['email'])
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        // Vue's readonly proxies log a console.warn and silently drop
        // the write — the value is unchanged, no exception thrown.
        ;(rv as unknown as { path: string }).path = 'phone' as never
        expect(rv.path).toBe('["email"]')
        expect(warn).toHaveBeenCalled()
      } finally {
        warn.mockRestore()
      }
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
      const registerA = buildRegister(stateA, 'test:inst')
      const registerB = buildRegister(stateB, 'test:inst')

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
