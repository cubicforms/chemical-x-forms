import { describe, expect, it } from 'vitest'
import {
  AnonPersistError,
  CxError,
  InvalidPathError,
  OutsideSetupError,
  RegistryNotInstalledError,
  ReservedFormKeyError,
  SensitivePersistFieldError,
  SubmitErrorHandlerError,
} from '../../src/runtime/core/errors'

describe('error classes', () => {
  describe('InvalidPathError', () => {
    it('extends Error and preserves the message', () => {
      const err = new InvalidPathError('bad path')
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(InvalidPathError)
      expect(err.message).toBe('bad path')
      expect(err.name).toBe('InvalidPathError')
    })

    it('preserves cause via ErrorOptions', () => {
      const inner = new TypeError('inner')
      const err = new InvalidPathError('outer', { cause: inner })
      expect(err.cause).toBe(inner)
    })

    it('throws with instanceof-checkable type across module boundaries', () => {
      const thrown = ((): unknown => {
        try {
          throw new InvalidPathError('x')
        } catch (e) {
          return e
        }
      })()
      expect(thrown).toBeInstanceOf(InvalidPathError)
    })
  })

  describe('SubmitErrorHandlerError', () => {
    it('extends Error with correct name', () => {
      const err = new SubmitErrorHandlerError('onError threw')
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(SubmitErrorHandlerError)
      expect(err.name).toBe('SubmitErrorHandlerError')
    })
  })

  describe('RegistryNotInstalledError', () => {
    it('has a helpful default message pointing at createDecant', () => {
      const err = new RegistryNotInstalledError()
      expect(err.message).toContain('createDecant')
      expect(err.name).toBe('RegistryNotInstalledError')
    })
  })

  describe('OutsideSetupError', () => {
    it('extends Error with correct name', () => {
      const err = new OutsideSetupError()
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(OutsideSetupError)
      expect(err.name).toBe('OutsideSetupError')
    })

    it('message names the lifecycle constraint and the recommended fix', () => {
      const err = new OutsideSetupError()
      // Surface the actual cause — not "install the plugin", which was
      // the misleading message before the disambiguation.
      expect(err.message).toContain('outside Vue setup')
      // Point at the recovery path users actually need.
      expect(err.message).toContain('child component')
    })
  })

  describe('AnonPersistError', () => {
    it('extends Error with correct name', () => {
      const err = new AnonPersistError({ cause: 'no-key' })
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(AnonPersistError)
      expect(err.name).toBe('AnonPersistError')
    })

    it('exposes schemaFields, callSite, and cause as readable properties', () => {
      const err = new AnonPersistError({
        cause: 'no-key',
        schemaFields: ['email', 'password'],
        callSite: 'spike-cx.vue:171:21',
      })
      expect(err.schemaFields).toEqual(['email', 'password'])
      expect(err.callSite).toBe('spike-cx.vue:171:21')
      expect(err.cause).toBe('no-key')
    })

    it('cause "no-key" message describes anonymous-key drift and points at key:', () => {
      const err = new AnonPersistError({ cause: 'no-key' })
      expect(err.message).toContain('useForm({ persist: ... })')
      expect(err.message).toContain('key:')
      expect(err.message).toContain('Fix:')
    })

    it('cause "register-without-config" message describes the dropped opt-in and offers two fixes', () => {
      const err = new AnonPersistError({ cause: 'register-without-config' })
      expect(err.message).toContain('register(')
      expect(err.message).toContain('persist:')
      // Both directions of the fix should be visible:
      expect(err.message).toMatch(/add `persist:|remove `\{ persist: true \}`/)
    })

    it('embeds schema fields when provided', () => {
      const err = new AnonPersistError({
        cause: 'no-key',
        schemaFields: ['email', 'password'],
      })
      expect(err.message).toContain('{ email, password }')
    })

    it('omits the fields clause gracefully when schemaFields is empty', () => {
      const err = new AnonPersistError({
        cause: 'no-key',
        schemaFields: [],
      })
      expect(err.message).not.toContain('Form fields:')
    })

    it('appends the callSite at the end of the message when provided', () => {
      const err = new AnonPersistError({
        cause: 'no-key',
        callSite: 'spike-cx.vue:171:21',
      })
      expect(err.message).toContain('spike-cx.vue:171:21')
    })

    it('throws with instanceof-checkable type across module boundaries', () => {
      const thrown = ((): unknown => {
        try {
          throw new AnonPersistError({ cause: 'no-key' })
        } catch (e) {
          return e
        }
      })()
      expect(thrown).toBeInstanceOf(AnonPersistError)
    })
  })

  // CxError is the shared parent of every library-emitted error class so
  // consumers can write a single polymorphic catch (`catch (e) { if (e
  // instanceof CxError) ... }`) instead of OR-chaining instanceof
  // checks for every subclass. The migration is a clean break — the
  // class shape is additive (Error stays in the prototype chain) but the
  // public surface gains a new symbol.
  describe('CxError base class', () => {
    it('all library error classes are instanceof CxError', () => {
      expect(new InvalidPathError('x')).toBeInstanceOf(CxError)
      expect(new SubmitErrorHandlerError('x')).toBeInstanceOf(CxError)
      expect(new RegistryNotInstalledError()).toBeInstanceOf(CxError)
      expect(new OutsideSetupError()).toBeInstanceOf(CxError)
      expect(new ReservedFormKeyError('__cx:foo')).toBeInstanceOf(CxError)
      expect(new SensitivePersistFieldError('password')).toBeInstanceOf(CxError)
      expect(new AnonPersistError({ cause: 'no-key' })).toBeInstanceOf(CxError)
    })

    it('still extends Error so consumers using catch (e: Error) keep working', () => {
      expect(new InvalidPathError('x')).toBeInstanceOf(Error)
      expect(new AnonPersistError({ cause: 'no-key' })).toBeInstanceOf(Error)
    })

    it('preserves message + cause + name on the subclass when caught as CxError', () => {
      const inner = new TypeError('inner')
      let captured: CxError | undefined
      try {
        throw new InvalidPathError('outer', { cause: inner })
      } catch (e) {
        if (e instanceof CxError) captured = e
      }
      expect(captured).toBeDefined()
      expect(captured?.message).toBe('outer')
      expect(captured?.cause).toBe(inner)
      expect(captured?.name).toBe('InvalidPathError')
    })
  })
})
