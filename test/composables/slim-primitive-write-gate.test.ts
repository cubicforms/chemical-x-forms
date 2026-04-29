// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { flush, makeMounter as makeMounterShared } from '../utils/form-harness'

/**
 * The slim-primitive write contract.
 *
 * Writes — programmatic `form.setValue` and DOM-driven assigner
 * writes — must satisfy the *slim primitive type* at the path:
 *   - `z.string().email()` slim is `string`
 *   - `z.enum(['a','b'])` slim is `string`
 *   - `z.literal('on')` slim is `string`
 *   - `z.number().int()` slim is `number`
 *   - `z.boolean()` slim is `boolean`
 *   - etc.
 *
 * Refinement-level constraints (`.email()`, `.min(N)`, enum membership,
 * literal equality, regex) DO NOT gate writes — they surface via
 * field-level validation. The contract: writes are loose at the
 * primitive level, validation tightens at the refinement level.
 *
 * Wrong-primitive writes are rejected with a one-shot dev-warn naming
 * the path + the offending value's primitive kind. `setValue` returns
 * `false`; the form value at the path is unchanged.
 */

// Local typed wrapper around the shared harness — this file's tests
// access useForm<S>'s typed return (e.g. `api.setValue`'s typed
// `path` parameter) so we narrow back from the harness's `any` here.
function makeMounter<S extends z.ZodObject>(schema: S) {
  return makeMounterShared(useForm, schema) as () => {
    api: ReturnType<typeof useForm<S>>
    app: App
  }
}

describe('slim-primitive write gate — accepted writes (slim type matches)', () => {
  const apps: App[] = []
  afterEach(async () => {
    while (apps.length > 0) apps.pop()?.unmount()
    await flush()
  })

  it('z.string().email() accepts any string (refinement-invalid passes through)', async () => {
    const { api, app } = makeMounter(z.object({ email: z.string().email() }))()
    apps.push(app)
    const ok = (api.setValue as (path: 'email', value: unknown) => boolean)('email', 'luigi')
    await flush()
    expect(ok).toBe(true)
    expect(api.getValue('email').value).toBe('luigi')
  })

  it('z.enum accepts any string (out-of-enum passes through)', async () => {
    const schema = z.object({ color: z.enum(['red', 'green', 'blue']) })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const ok = (api.setValue as (path: 'color', value: unknown) => boolean)('color', 'magenta')
    await flush()
    expect(ok).toBe(true)
    expect(api.getValue('color').value).toBe('magenta')
  })

  it('z.literal(string) accepts any string', async () => {
    const schema = z.object({ mode: z.literal('on') })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const ok = (api.setValue as (path: 'mode', value: unknown) => boolean)('mode', 'off')
    await flush()
    expect(ok).toBe(true)
    expect(api.getValue('mode').value).toBe('off')
  })

  it('z.union([string, number]) accepts strings AND numbers, rejects booleans', async () => {
    const schema = z.object({ field: z.union([z.string(), z.number()]) })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const setVal = api.setValue as (path: 'field', value: unknown) => boolean

    expect(setVal('field', 'x')).toBe(true)
    await flush()
    expect(api.getValue('field').value).toBe('x')

    expect(setVal('field', 42)).toBe(true)
    await flush()
    expect(api.getValue('field').value).toBe(42)

    expect(setVal('field', true)).toBe(false)
    await flush()
    // Still 42 — the boolean write was rejected.
    expect(api.getValue('field').value).toBe(42)
  })

  it('z.string().nullable() accepts null', async () => {
    const schema = z.object({ note: z.string().nullable() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const ok = (api.setValue as (path: 'note', value: unknown) => boolean)('note', null)
    await flush()
    expect(ok).toBe(true)
    expect(api.getValue('note').value).toBe(null)
  })

  it('z.string().optional() accepts undefined', async () => {
    const schema = z.object({ note: z.string().optional() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const ok = (api.setValue as (path: 'note', value: unknown) => boolean)('note', undefined)
    await flush()
    expect(ok).toBe(true)
    expect(api.getValue('note').value).toBe(undefined)
  })
})

describe('slim-primitive write gate — rejected writes (wrong primitive)', () => {
  const apps: App[] = []
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    while (apps.length > 0) apps.pop()?.unmount()
    warnSpy.mockRestore()
    await flush()
  })

  it('z.number(): rejects a string write', async () => {
    const schema = z.object({ age: z.number() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const before = api.getValue('age').value
    const ok = (api.setValue as (path: 'age', value: unknown) => boolean)('age', 'twenty')
    await flush()
    expect(ok).toBe(false)
    expect(api.getValue('age').value).toBe(before)
  })

  it('z.boolean(): rejects a string write', async () => {
    const schema = z.object({ flag: z.boolean() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const before = api.getValue('flag').value
    const ok = (api.setValue as (path: 'flag', value: unknown) => boolean)('flag', 'no')
    await flush()
    expect(ok).toBe(false)
    expect(api.getValue('flag').value).toBe(before)
  })

  it('z.enum([...strings]): rejects a number write', async () => {
    const schema = z.object({ color: z.enum(['red', 'green', 'blue']) })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const before = api.getValue('color').value
    const ok = (api.setValue as (path: 'color', value: unknown) => boolean)('color', 1)
    await flush()
    expect(ok).toBe(false)
    expect(api.getValue('color').value).toBe(before)
  })

  it('z.bigint(): rejects a string write', async () => {
    const schema = z.object({ count: z.bigint() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const before = api.getValue('count').value
    const ok = (api.setValue as (path: 'count', value: unknown) => boolean)('count', 'abc')
    await flush()
    expect(ok).toBe(false)
    expect(api.getValue('count').value).toBe(before)
  })

  it('z.string() (non-nullable): rejects null', async () => {
    const schema = z.object({ note: z.string() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const before = api.getValue('note').value
    const ok = (api.setValue as (path: 'note', value: unknown) => boolean)('note', null)
    await flush()
    expect(ok).toBe(false)
    expect(api.getValue('note').value).toBe(before)
  })

  it('rejection emits a dev-warn naming the path + offending kind', async () => {
    const schema = z.object({ age: z.number() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    ;(api.setValue as (path: 'age', value: unknown) => boolean)('age', 'twenty')
    await flush()
    expect(warnSpy).toHaveBeenCalled()
    const message = warnSpy.mock.calls.flat().join(' ')
    expect(message).toMatch(/age/)
    // Mention either the offending primitive kind or the schema's
    // expected kind so the dev knows what was wrong.
    expect(message).toMatch(/string|number/)
  })

  it('string-to-number rejection points at the v-register fix paths (type="number" or .number)', async () => {
    // KISS rule for warns: tell the dev what to do, not just what's
    // wrong. The string-to-number case is the most common slim-gate
    // rejection in real apps (a plain `<input v-register>` against a
    // `z.number()` field types as a string), so the warn must show
    // both fixes verbatim.
    const schema = z.object({ salary: z.number() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    ;(api.setValue as (path: 'salary', value: unknown) => boolean)('salary', '123')
    await flush()
    const message = warnSpy.mock.calls.flat().join(' ')
    expect(message).toContain('type="number"')
    expect(message).toContain('.number')
  })

  it('repeated rejection at the same path emits ONE warn (one-shot dedupe)', async () => {
    const schema = z.object({ age: z.number() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const setVal = api.setValue as (path: 'age', value: unknown) => boolean
    setVal('age', 'twenty')
    setVal('age', 'thirty')
    setVal('age', 'forty')
    await flush()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

describe('slim-primitive write gate — subtree writes', () => {
  const apps: App[] = []
  afterEach(async () => {
    while (apps.length > 0) apps.pop()?.unmount()
    await flush()
  })

  it('object-write with one wrong-primitive leaf rejects the whole write', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = z.object({
      user: z.object({ name: z.string(), age: z.number() }),
    })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const before = api.getValue('user').value
    const ok = (api.setValue as (path: 'user', value: unknown) => boolean)('user', {
      name: 'Bob',
      age: 'twenty', // wrong primitive at user.age
    })
    await flush()
    expect(ok).toBe(false)
    expect(api.getValue('user').value).toEqual(before)
    warnSpy.mockRestore()
  })

  it('object-write with all primitive-correct leaves succeeds', async () => {
    const schema = z.object({
      user: z.object({ name: z.string(), age: z.number() }),
    })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const ok = (api.setValue as (path: 'user', value: unknown) => boolean)('user', {
      name: 'Bob',
      age: 30,
    })
    await flush()
    expect(ok).toBe(true)
    expect(api.getValue('user').value).toEqual({ name: 'Bob', age: 30 })
  })

  it('writing a string at a path expecting an object rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = z.object({
      user: z.object({ name: z.string() }),
    })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const ok = (api.setValue as (path: 'user', value: unknown) => boolean)('user', 'oops')
    await flush()
    expect(ok).toBe(false)
    warnSpy.mockRestore()
  })

  it('array-write with one wrong-primitive element rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = z.object({ items: z.array(z.string()) })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const ok = (api.setValue as (path: 'items', value: unknown) => boolean)('items', [
      'a',
      'b',
      1, // wrong
    ])
    await flush()
    expect(ok).toBe(false)
    warnSpy.mockRestore()
  })
})

describe('slim-primitive write gate — non-form-key permissive shapes', () => {
  const apps: App[] = []
  afterEach(async () => {
    while (apps.length > 0) apps.pop()?.unmount()
    await flush()
  })

  it('z.any() leaf accepts any primitive', async () => {
    const schema = z.object({ payload: z.any() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const setVal = api.setValue as (path: 'payload', value: unknown) => boolean
    expect(setVal('payload', 1)).toBe(true)
    expect(setVal('payload', 'x')).toBe(true)
    expect(setVal('payload', true)).toBe(true)
    expect(setVal('payload', null)).toBe(true)
  })

  it('z.unknown() leaf accepts any primitive', async () => {
    const schema = z.object({ payload: z.unknown() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const setVal = api.setValue as (path: 'payload', value: unknown) => boolean
    expect(setVal('payload', 1)).toBe(true)
    expect(setVal('payload', 'x')).toBe(true)
  })
})

/**
 * Writes against paths the schema doesn't define MUST be rejected.
 * The slim-primitive gate's previous "empty accept set → permissive"
 * rule conflated three semantically distinct cases: `z.any()`,
 * `z.never()`, and unknown-path. Only `z.any()` should be permissive.
 *
 * Without this, registering an input at a typo path
 * (`register('address.salary')` against `address: { city }`) silently
 * creates a bogus `address.salary` slot in the form on first
 * keystroke, breaking the structural-completeness invariant.
 */
describe('slim-primitive write gate — unknown schema paths', () => {
  const apps: App[] = []
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    while (apps.length > 0) apps.pop()?.unmount()
    warnSpy.mockRestore()
    await flush()
  })

  it('rejects writes to a leaf path the schema does not define', async () => {
    const schema = z.object({
      address: z.object({ city: z.string() }),
    })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const before = JSON.parse(JSON.stringify(api.getValue().value))
    const ok = (api.setValue as (path: string, value: unknown) => boolean)('address.salary', 'abc')
    await flush()
    expect(ok).toBe(false)
    // Form value unchanged — no `address.salary` slot created.
    expect(api.getValue().value).toEqual(before)
  })

  it('rejects writes to an unknown root-level path', async () => {
    const schema = z.object({ name: z.string() })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const before = JSON.parse(JSON.stringify(api.getValue().value))
    const ok = (api.setValue as (path: string, value: unknown) => boolean)('phantom', 'x')
    await flush()
    expect(ok).toBe(false)
    expect(api.getValue().value).toEqual(before)
  })

  it('rejects writes that would create a deeply-nested unknown path', async () => {
    const schema = z.object({
      profile: z.object({
        details: z.object({ name: z.string() }),
      }),
    })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    const before = JSON.parse(JSON.stringify(api.getValue().value))
    const ok = (api.setValue as (path: string, value: unknown) => boolean)(
      'profile.details.unknown',
      'x'
    )
    await flush()
    expect(ok).toBe(false)
    expect(api.getValue().value).toEqual(before)
  })

  it('rejection emits a dev-warn naming the unknown path', async () => {
    const schema = z.object({
      address: z.object({ city: z.string() }),
    })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    ;(api.setValue as (path: string, value: unknown) => boolean)('address.salary', 'abc')
    await flush()
    expect(warnSpy).toHaveBeenCalled()
    const message = warnSpy.mock.calls.flat().join(' ')
    expect(message).toMatch(/address\.salary/)
  })

  it('unknown-path rejection tells the dev the path is not in the schema', async () => {
    // KISS rule: name the actual problem ("not in your schema") so the
    // dev can act on it without a domain lesson on slim primitives.
    const schema = z.object({
      address: z.object({ city: z.string() }),
    })
    const { api, app } = makeMounter(schema)()
    apps.push(app)
    ;(api.setValue as (path: string, value: unknown) => boolean)('address.salary', 'abc')
    await flush()
    const message = warnSpy.mock.calls.flat().join(' ')
    expect(message).toContain('not in your schema')
    expect(message).toContain('typo')
  })
})
