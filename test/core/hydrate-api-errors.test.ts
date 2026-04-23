import { describe, expect, it } from 'vitest'
import { hydrateApiErrors } from '../../src/runtime/core/hydrate-api-errors'

const formKey = 'cx-test-form'

describe('hydrateApiErrors (structured result)', () => {
  describe('null / undefined input', () => {
    it('treats null as "no errors" (ok: true, empty)', () => {
      expect(hydrateApiErrors(null, { formKey })).toEqual({ ok: true, errors: [] })
    })

    it('treats undefined as "no errors"', () => {
      expect(hydrateApiErrors(undefined, { formKey })).toEqual({ ok: true, errors: [] })
    })

    it('treats empty object as "no errors"', () => {
      expect(hydrateApiErrors({}, { formKey })).toEqual({ ok: true, errors: [] })
    })
  })

  describe('envelope shapes', () => {
    it('unwraps the { error: { details } } envelope', () => {
      const result = hydrateApiErrors(
        {
          error: {
            code: 'VALIDATION_ERROR',
            details: { email: ['Email already in use'] },
          },
        },
        { formKey }
      )
      expect(result).toEqual({
        ok: true,
        errors: [{ message: 'Email already in use', path: ['email'], formKey }],
      })
    })

    it('unwraps the bare { details } envelope', () => {
      const result = hydrateApiErrors({ details: { email: ['Email already in use'] } }, { formKey })
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([{ message: 'Email already in use', path: ['email'], formKey }])
    })

    it('accepts a raw details record', () => {
      const result = hydrateApiErrors({ email: ['Email already in use'] }, { formKey })
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([{ message: 'Email already in use', path: ['email'], formKey }])
    })

    it('treats a wrapped envelope without details as ok + empty', () => {
      expect(hydrateApiErrors({ error: { code: 'X', message: 'oops' } }, { formKey })).toEqual({
        ok: true,
        errors: [],
      })
    })
  })

  describe('value normalisation', () => {
    it('wraps a single-string message in a one-element array', () => {
      const result = hydrateApiErrors({ details: { email: 'taken' } }, { formKey })
      expect(result.errors).toEqual([{ message: 'taken', path: ['email'], formKey }])
    })

    it('expands an array into multiple ValidationError records', () => {
      const result = hydrateApiErrors(
        { details: { password: ['too short', 'must include a number'] } },
        { formKey }
      )
      expect(result.errors).toEqual([
        { message: 'too short', path: ['password'], formKey },
        { message: 'must include a number', path: ['password'], formKey },
      ])
    })

    it('drops empty-string messages', () => {
      const result = hydrateApiErrors({ details: { email: ['', 'taken'] } }, { formKey })
      expect(result.errors).toEqual([{ message: 'taken', path: ['email'], formKey }])
    })

    it('splits dotted paths into structured segments', () => {
      const result = hydrateApiErrors({ details: { 'address.line1': ['required'] } }, { formKey })
      expect(result.errors).toEqual([{ message: 'required', path: ['address', 'line1'], formKey }])
    })

    it('normalises integer-like path segments to numbers', () => {
      const result = hydrateApiErrors({ details: { 'items.0.name': ['required'] } }, { formKey })
      expect(result.errors).toEqual([{ message: 'required', path: ['items', 0, 'name'], formKey }])
    })
  })

  describe('rejection of malformed payloads (NEW behavior vs pre-rewrite)', () => {
    it('returns ok:false with a reason when details is an object-of-objects', () => {
      const result = hydrateApiErrors({ details: { email: { nested: 'bad' } } } as unknown, {
        formKey,
      })
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual([])
      expect(result.rejected).toContain('record of string')
    })

    it('returns ok:false for primitive payloads', () => {
      const resultString = hydrateApiErrors('oops' as unknown, { formKey })
      expect(resultString.ok).toBe(false)
      expect(resultString.rejected).toContain('string')

      const resultNumber = hydrateApiErrors(42 as unknown, { formKey })
      expect(resultNumber.ok).toBe(false)
      expect(resultNumber.rejected).toContain('number')
    })

    it('returns ok:false when the payload has no recognised shape', () => {
      const result = hydrateApiErrors({ message: 'Something went wrong', code: 500 } as unknown, {
        formKey,
      })
      expect(result.ok).toBe(false)
      expect(result.rejected).toContain('shape not recognised')
    })
  })

  describe('metadata', () => {
    it('stamps the provided formKey on every error', () => {
      const result = hydrateApiErrors(
        { details: { email: ['taken'], password: 'short' } },
        { formKey: 'custom-key' }
      )
      expect(result.errors.every((e) => e.formKey === 'custom-key')).toBe(true)
    })
  })
})
