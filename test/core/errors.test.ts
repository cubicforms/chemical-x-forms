import { describe, expect, it } from 'vitest'
import {
  InvalidApiErrorPayloadError,
  InvalidPathError,
  RegistryNotInstalledError,
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

  describe('InvalidApiErrorPayloadError', () => {
    it('carries a structured `reason` in addition to a composed message', () => {
      const err = new InvalidApiErrorPayloadError('details must be a record')
      expect(err.reason).toBe('details must be a record')
      expect(err.message).toContain('details must be a record')
      expect(err.name).toBe('InvalidApiErrorPayloadError')
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
    it('has a helpful default message pointing at createChemicalXForms', () => {
      const err = new RegistryNotInstalledError()
      expect(err.message).toContain('createChemicalXForms')
      expect(err.name).toBe('RegistryNotInstalledError')
    })
  })
})
