import { describe, expect, it } from 'vitest'
import { hydrateApiErrors } from '../src/runtime/lib/core/utils/hydrate-api-errors'

/*
  Test Suite: hydrateApiErrors
  Focus: Pure-function payload-shape coverage. The composable wiring around
  this helper is exercised end-to-end in ssr.test.ts.
*/

describe('hydrateApiErrors', () => {
  const formKey = 'cx-test-form'

  describe('input handling', () => {
    it('returns [] for null', () => {
      expect(hydrateApiErrors(null, { formKey })).toEqual([])
    })

    it('returns [] for undefined', () => {
      expect(hydrateApiErrors(undefined, { formKey })).toEqual([])
    })

    it('returns [] for empty details', () => {
      expect(hydrateApiErrors({}, { formKey })).toEqual([])
    })
  })

  describe('envelope shapes', () => {
    it('unwraps the cubic-forms-style { error: { details } } envelope', () => {
      const result = hydrateApiErrors(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: { email: ['Email already in use'] },
          },
        },
        { formKey }
      )
      expect(result).toEqual([{ message: 'Email already in use', path: ['email'], formKey }])
    })

    it('unwraps the bare { details } envelope', () => {
      const result = hydrateApiErrors({ details: { email: ['Email already in use'] } }, { formKey })
      expect(result).toEqual([{ message: 'Email already in use', path: ['email'], formKey }])
    })

    it('accepts a raw details record', () => {
      const result = hydrateApiErrors({ email: ['Email already in use'] }, { formKey })
      expect(result).toEqual([{ message: 'Email already in use', path: ['email'], formKey }])
    })
  })

  describe('value normalisation', () => {
    it('wraps a single-string message in a one-element array', () => {
      const result = hydrateApiErrors({ details: { email: 'taken' } }, { formKey })
      expect(result).toEqual([{ message: 'taken', path: ['email'], formKey }])
    })

    it('expands an array into multiple ValidationError records', () => {
      const result = hydrateApiErrors(
        { details: { password: ['too short', 'must include a number'] } },
        { formKey }
      )
      expect(result).toEqual([
        { message: 'too short', path: ['password'], formKey },
        { message: 'must include a number', path: ['password'], formKey },
      ])
    })

    it('drops empty-string messages', () => {
      const result = hydrateApiErrors({ details: { email: ['', 'taken'] } }, { formKey })
      expect(result).toEqual([{ message: 'taken', path: ['email'], formKey }])
    })

    it('splits dotted paths into segments', () => {
      const result = hydrateApiErrors({ details: { 'address.line1': ['required'] } }, { formKey })
      expect(result).toEqual([{ message: 'required', path: ['address', 'line1'], formKey }])
    })
  })

  describe('robustness', () => {
    it('returns [] when the wrapped envelope has no details', () => {
      expect(hydrateApiErrors({ error: { code: 'X', message: 'oops' } }, { formKey })).toEqual([])
    })

    it('returns [] when details is malformed (object-of-object)', () => {
      // Defensive guard: details values must be string | string[]
      expect(
        hydrateApiErrors(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { details: { email: { nested: 'bad' } } } as any,
          { formKey }
        )
      ).toEqual([])
    })

    it('returns [] for primitive payloads', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(hydrateApiErrors('oops' as any, { formKey })).toEqual([])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(hydrateApiErrors(42 as any, { formKey })).toEqual([])
    })
  })

  it('stamps the provided formKey on every error', () => {
    const result = hydrateApiErrors(
      { details: { email: ['taken'], password: 'short' } },
      { formKey: 'custom-key' }
    )
    expect(result.every((e) => e.formKey === 'custom-key')).toBe(true)
  })
})
