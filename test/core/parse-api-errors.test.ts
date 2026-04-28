import { describe, expect, it } from 'vitest'
import { parseApiErrors } from '../../src/runtime/core/parse-api-errors'

const formKey = 'cx-test-form'

describe('parseApiErrors (structured result)', () => {
  describe('null / undefined input', () => {
    it('treats null as "no errors" (ok: true, empty)', () => {
      expect(parseApiErrors(null, { formKey })).toEqual({ ok: true, errors: [] })
    })

    it('treats undefined as "no errors"', () => {
      expect(parseApiErrors(undefined, { formKey })).toEqual({ ok: true, errors: [] })
    })

    it('treats empty object as "no errors"', () => {
      expect(parseApiErrors({}, { formKey })).toEqual({ ok: true, errors: [] })
    })
  })

  describe('envelope shapes', () => {
    it('unwraps the { error: { details } } envelope', () => {
      const result = parseApiErrors(
        {
          error: {
            code: 'VALIDATION_ERROR',
            details: {
              email: [{ message: 'Email already in use', code: 'api:duplicate-email' }],
            },
          },
        },
        { formKey }
      )
      expect(result).toEqual({
        ok: true,
        errors: [
          {
            message: 'Email already in use',
            path: ['email'],
            formKey,
            code: 'api:duplicate-email',
          },
        ],
      })
    })

    it('unwraps the bare { details } envelope', () => {
      const result = parseApiErrors(
        { details: { email: [{ message: 'Email already in use', code: 'api:duplicate-email' }] } },
        { formKey }
      )
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([
        { message: 'Email already in use', path: ['email'], formKey, code: 'api:duplicate-email' },
      ])
    })

    it('accepts a raw details record', () => {
      const result = parseApiErrors(
        { email: [{ message: 'Email already in use', code: 'api:duplicate-email' }] },
        { formKey }
      )
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([
        { message: 'Email already in use', path: ['email'], formKey, code: 'api:duplicate-email' },
      ])
    })

    it('treats a wrapped envelope without details as ok + empty', () => {
      expect(parseApiErrors({ error: { code: 'X', message: 'oops' } }, { formKey })).toEqual({
        ok: true,
        errors: [],
      })
    })
  })

  describe('value normalisation', () => {
    it('accepts a single { message, code } entry without an enclosing array', () => {
      const result = parseApiErrors(
        { details: { email: { message: 'taken', code: 'api:validation' } } },
        { formKey }
      )
      expect(result.errors).toEqual([
        { message: 'taken', path: ['email'], formKey, code: 'api:validation' },
      ])
    })

    it('expands an array into multiple ValidationError records (each with its own code)', () => {
      const result = parseApiErrors(
        {
          details: {
            password: [
              { message: 'too short', code: 'api:min-length' },
              { message: 'must include a number', code: 'api:digit-required' },
            ],
          },
        },
        { formKey }
      )
      expect(result.errors).toEqual([
        { message: 'too short', path: ['password'], formKey, code: 'api:min-length' },
        {
          message: 'must include a number',
          path: ['password'],
          formKey,
          code: 'api:digit-required',
        },
      ])
    })

    it('preserves distinct codes at the same path so they do not collapse', () => {
      const result = parseApiErrors(
        {
          details: {
            password: [
              { message: 'too short', code: 'api:min-length' },
              { message: 'no digit', code: 'api:digit-required' },
            ],
          },
        },
        { formKey }
      )
      expect(result.errors).toHaveLength(2)
      expect(result.errors[0]?.code).toBe('api:min-length')
      expect(result.errors[1]?.code).toBe('api:digit-required')
    })

    it('drops entries whose message is empty (silent recovery)', () => {
      const result = parseApiErrors(
        {
          details: {
            email: [
              { message: '', code: 'api:validation' },
              { message: 'taken', code: 'api:duplicate-email' },
            ],
          },
        },
        { formKey }
      )
      expect(result.errors).toEqual([
        { message: 'taken', path: ['email'], formKey, code: 'api:duplicate-email' },
      ])
    })

    it('splits dotted paths into structured segments', () => {
      const result = parseApiErrors(
        { details: { 'address.line1': { message: 'required', code: 'api:required' } } },
        { formKey }
      )
      expect(result.errors).toEqual([
        { message: 'required', path: ['address', 'line1'], formKey, code: 'api:required' },
      ])
    })

    it('normalises integer-like path segments to numbers', () => {
      const result = parseApiErrors(
        { details: { 'items.0.name': { message: 'required', code: 'api:required' } } },
        { formKey }
      )
      expect(result.errors).toEqual([
        { message: 'required', path: ['items', 0, 'name'], formKey, code: 'api:required' },
      ])
    })

    it('forwards the wire `code` verbatim (no library-side rewrite)', () => {
      const result = parseApiErrors(
        { details: { email: { message: 'banned', code: 'myapp:custom-rule-42' } } },
        { formKey }
      )
      expect(result.errors[0]?.code).toBe('myapp:custom-rule-42')
    })
  })

  describe('rejection of malformed payloads', () => {
    it('rejects legacy string entries (now require { message, code })', () => {
      const result = parseApiErrors({ details: { email: 'taken' } } as unknown, { formKey })
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual([])
      expect(result.rejected).toContain('{ message, code }')
    })

    it('rejects entries missing the code field', () => {
      const result = parseApiErrors({ details: { email: { message: 'taken' } } } as unknown, {
        formKey,
      })
      expect(result.ok).toBe(false)
      expect(result.rejected).toContain('{ message, code }')
    })

    it('rejects entries with a non-string code', () => {
      const result = parseApiErrors(
        { details: { email: { message: 'taken', code: 42 } } } as unknown,
        { formKey }
      )
      expect(result.ok).toBe(false)
      expect(result.rejected).toContain('{ message, code }')
    })

    it('returns ok:false with a reason when details is an object-of-objects-without-shape', () => {
      const result = parseApiErrors({ details: { email: { nested: 'bad' } } } as unknown, {
        formKey,
      })
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual([])
      expect(result.rejected).toContain('{ message, code }')
    })

    it('returns ok:false for primitive payloads', () => {
      const resultString = parseApiErrors('oops' as unknown, { formKey })
      expect(resultString.ok).toBe(false)
      expect(resultString.rejected).toContain('string')

      const resultNumber = parseApiErrors(42 as unknown, { formKey })
      expect(resultNumber.ok).toBe(false)
      expect(resultNumber.rejected).toContain('number')
    })

    it('rejects { error: "<string>" } envelopes (scalar error, not object)', () => {
      // Without the guard this payload would fall through to the raw-
      // details branch because `{ error: '...' }` satisfies
      // `isDetailsRecord` (key='error', value=string). We reject
      // explicitly so the consumer sees an integration bug instead of
      // a phantom ValidationError at path ['error'].
      const result = parseApiErrors({ error: 'Something went wrong' } as unknown, { formKey })
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual([])
      expect(result.rejected).toContain('payload.error was string')
    })

    it('rejects { error: <number> } envelopes similarly', () => {
      const result = parseApiErrors({ error: 42 } as unknown, { formKey })
      expect(result.ok).toBe(false)
      expect(result.rejected).toContain('payload.error was number')
    })

    it('returns ok:false when the payload has no recognised shape', () => {
      const result = parseApiErrors({ message: 'Something went wrong', code: 500 } as unknown, {
        formKey,
      })
      expect(result.ok).toBe(false)
      expect(result.rejected).toContain('unrecognised payload shape')
    })
  })

  describe('metadata', () => {
    it('stamps the provided formKey on every error', () => {
      const result = parseApiErrors(
        {
          details: {
            email: [{ message: 'taken', code: 'api:duplicate-email' }],
            password: { message: 'short', code: 'api:min-length' },
          },
        },
        { formKey: 'custom-key' }
      )
      expect(result.errors.every((e) => e.formKey === 'custom-key')).toBe(true)
    })
  })

  describe('DoS guardrails', () => {
    const entry = (message: string) => ({ message, code: 'api:validation' })

    it('rejects payloads whose entry count exceeds maxEntries', () => {
      const big: Record<string, ReturnType<typeof entry>> = {}
      for (let i = 0; i < 1200; i++) big[`field_${i}`] = entry('err')
      const result = parseApiErrors(big, { formKey: 'f', maxEntries: 1000 })
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual([])
      expect(result.rejected).toContain('exceeds maxEntries=1000')
    })

    it('defaults maxEntries to 1000 when not specified', () => {
      const big: Record<string, ReturnType<typeof entry>> = {}
      for (let i = 0; i < 1001; i++) big[`k${i}`] = entry('x')
      const result = parseApiErrors(big, { formKey: 'f' })
      expect(result.ok).toBe(false)
      expect(result.rejected).toContain('1001 entries')
    })

    it('accepts payloads up to maxEntries inclusive', () => {
      const payload: Record<string, ReturnType<typeof entry>> = {}
      for (let i = 0; i < 1000; i++) payload[`k${i}`] = entry('msg')
      const result = parseApiErrors(payload, { formKey: 'f', maxEntries: 1000 })
      expect(result.ok).toBe(true)
      expect(result.errors).toHaveLength(1000)
    })

    it('drops individual keys that exceed maxPathDepth; keeps the rest', () => {
      // Depth cap is per-key — a single deep path is dropped but other
      // well-formed entries still apply. Consumers who want stricter
      // rejection can compare `errors.length` to entry count.
      const payload = {
        'a.b.c.d.e': entry('shallow'),
        'x.x.x.x.x.x.x.x.x.x': entry('too deep'),
      }
      const result = parseApiErrors(payload, { formKey: 'f', maxPathDepth: 6 })
      expect(result.ok).toBe(true)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.message).toBe('shallow')
    })

    it('defaults maxPathDepth to 32 when not specified', () => {
      const segments = Array.from({ length: 40 }, (_, i) => `s${i}`).join('.')
      const payload = { [segments]: entry('deep') }
      const result = parseApiErrors(payload, { formKey: 'f' })
      expect(result.ok).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('counts numeric-like segments the same as string segments against the depth cap', () => {
      // `'a.0.b'` canonicalises to three segments, same as `'a.x.b'`. The
      // cap treats them uniformly — there is no separate "numeric-index"
      // budget.
      const payload = { 'a.0.1.2.3.4.5.6': entry('ok') }
      const result = parseApiErrors(payload, { formKey: 'f', maxPathDepth: 8 })
      expect(result.errors).toHaveLength(1)
      const dropResult = parseApiErrors(payload, { formKey: 'f', maxPathDepth: 7 })
      expect(dropResult.errors).toHaveLength(0)
    })

    it('rejects payloads whose total path-segment count exceeds maxTotalSegments', () => {
      // 100 keys, 6 segments each → 600 total. Cap at 500 → reject.
      const payload: Record<string, ReturnType<typeof entry>> = {}
      for (let i = 0; i < 100; i++) payload[`a.b.c.d.e.f${i}`] = entry('msg')
      const result = parseApiErrors(payload, { formKey: 'f', maxTotalSegments: 500 })
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual([])
      expect(result.rejected).toContain('maxTotalSegments=500')
    })

    it('defaults maxTotalSegments to 10000 when not specified', () => {
      // 999 keys × 11 segments = 10 989. Per-key cap (32) and
      // maxEntries cap (1000) both pass. Default total cap (10 000)
      // catches the pathological total.
      const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']
      const payload: Record<string, ReturnType<typeof entry>> = {}
      for (let i = 0; i < 999; i++) payload[`${segs.join('.')}.row${i}`] = entry('msg')
      const result = parseApiErrors(payload, { formKey: 'f' })
      expect(result.ok).toBe(false)
      expect(result.rejected).toContain('maxTotalSegments=10000')
    })

    it('accepts payloads up to maxTotalSegments inclusive', () => {
      // 50 keys × 4 segments = 200 total. Cap at 200 → accept.
      const payload: Record<string, ReturnType<typeof entry>> = {}
      for (let i = 0; i < 50; i++) payload[`a.b.c.k${i}`] = entry('msg')
      const result = parseApiErrors(payload, { formKey: 'f', maxTotalSegments: 200 })
      expect(result.ok).toBe(true)
      expect(result.errors).toHaveLength(50)
    })
  })
})
