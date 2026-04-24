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

    it('rejects { error: "<string>" } envelopes (scalar error, not object)', () => {
      // Without the guard this payload would fall through to the raw-
      // details branch because `{ error: '...' }` satisfies
      // `isDetailsRecord` (key='error', value=string). We reject
      // explicitly so the consumer sees an integration bug instead of
      // a phantom ValidationError at path ['error'].
      const result = hydrateApiErrors({ error: 'Something went wrong' } as unknown, { formKey })
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual([])
      expect(result.rejected).toContain('payload.error was string')
    })

    it('rejects { error: <number> } envelopes similarly', () => {
      const result = hydrateApiErrors({ error: 42 } as unknown, { formKey })
      expect(result.ok).toBe(false)
      expect(result.rejected).toContain('payload.error was number')
    })

    it('returns ok:false when the payload has no recognised shape', () => {
      const result = hydrateApiErrors({ message: 'Something went wrong', code: 500 } as unknown, {
        formKey,
      })
      expect(result.ok).toBe(false)
      expect(result.rejected).toContain('unrecognised payload shape')
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

  describe('DoS guardrails', () => {
    it('rejects payloads whose entry count exceeds maxEntries', () => {
      const big: Record<string, string> = {}
      for (let i = 0; i < 1200; i++) big[`field_${i}`] = 'err'
      const result = hydrateApiErrors(big, { formKey: 'f', maxEntries: 1000 })
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual([])
      expect(result.rejected).toContain('exceeds maxEntries=1000')
    })

    it('defaults maxEntries to 1000 when not specified', () => {
      const big: Record<string, string> = {}
      for (let i = 0; i < 1001; i++) big[`k${i}`] = 'x'
      const result = hydrateApiErrors(big, { formKey: 'f' })
      expect(result.ok).toBe(false)
      expect(result.rejected).toContain('1001 entries')
    })

    it('accepts payloads up to maxEntries inclusive', () => {
      const payload: Record<string, string> = {}
      for (let i = 0; i < 1000; i++) payload[`k${i}`] = 'msg'
      const result = hydrateApiErrors(payload, { formKey: 'f', maxEntries: 1000 })
      expect(result.ok).toBe(true)
      expect(result.errors).toHaveLength(1000)
    })

    it('drops individual keys that exceed maxPathDepth; keeps the rest', () => {
      // Depth cap is per-key — a single deep path is dropped but other
      // well-formed entries still apply. Consumers who want stricter
      // rejection can compare `errors.length` to entry count.
      const payload = {
        'a.b.c.d.e': 'shallow',
        'x.x.x.x.x.x.x.x.x.x': 'too deep',
      }
      const result = hydrateApiErrors(payload, { formKey: 'f', maxPathDepth: 6 })
      expect(result.ok).toBe(true)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.message).toBe('shallow')
    })

    it('defaults maxPathDepth to 32 when not specified', () => {
      const segments = Array.from({ length: 40 }, (_, i) => `s${i}`).join('.')
      const payload = { [segments]: 'deep' }
      const result = hydrateApiErrors(payload, { formKey: 'f' })
      expect(result.ok).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('counts numeric-like segments the same as string segments against the depth cap', () => {
      // `'a.0.b'` canonicalises to three segments, same as `'a.x.b'`. The
      // cap treats them uniformly — there is no separate "numeric-index"
      // budget.
      const payload = { 'a.0.1.2.3.4.5.6': 'ok' }
      const result = hydrateApiErrors(payload, { formKey: 'f', maxPathDepth: 8 })
      expect(result.errors).toHaveLength(1)
      const dropResult = hydrateApiErrors(payload, { formKey: 'f', maxPathDepth: 7 })
      expect(dropResult.errors).toHaveLength(0)
    })
  })
})
