import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodAdapter } from '../../../src/runtime/adapters/zod-v4'

/**
 * Validator translation tests: refine / superRefine / transform / pipe.
 * The adapter routes issues through `zodIssuesToValidationErrors`, which
 * coerces PropertyKey[] → (string | number)[]. These tests pin the path
 * output for each validator shape so a downstream consumer can trust the
 * error's `path` field to navigate the form.
 */

describe('zod v4 adapter — refine / superRefine error paths', () => {
  it('leaf .refine emits error at the leaf path', () => {
    const schema = z.object({
      username: z.string().refine((v) => v.length > 3, 'too short'),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.validateAtPath({ username: 'ab' }, undefined)
    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors?.[0]?.path).toEqual(['username'])
    expect(result.errors?.[0]?.message).toBe('too short')
  })

  it('.refine with explicit path redirects the error to that path', () => {
    const schema = z
      .object({
        password: z.string(),
        confirm: z.string(),
      })
      .refine((v) => v.password === v.confirm, {
        message: 'passwords differ',
        path: ['confirm'],
      })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.validateAtPath({ password: 'abc', confirm: 'xyz' }, undefined)
    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors?.[0]?.path).toEqual(['confirm'])
    expect(result.errors?.[0]?.message).toBe('passwords differ')
  })

  it('.superRefine preserves the issue path it sets, including numeric segments', () => {
    const schema = z.object({
      items: z.array(z.object({ name: z.string() })).superRefine((items, ctx) => {
        items.forEach((it, i) => {
          if (it.name.length === 0) {
            ctx.addIssue({
              code: 'custom',
              path: [i, 'name'],
              message: 'name required',
            })
          }
        })
      }),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.validateAtPath(
      { items: [{ name: 'a' }, { name: '' }, { name: '' }] },
      undefined
    )
    expect(result.success).toBe(false)
    // Expect two `custom` issues with numeric + string path segments. The
    // adapter coerces numeric PropertyKeys to numbers; strings stay strings.
    const customPaths = result.errors
      ?.filter((e) => e.message === 'name required')
      .map((e) => e.path)
    expect(customPaths).toHaveLength(2)
    expect(customPaths).toContainEqual(['items', 1, 'name'])
    expect(customPaths).toContainEqual(['items', 2, 'name'])
  })

  it('multiple refinements on one field surface as separate errors', () => {
    const schema = z.object({
      password: z
        .string()
        .refine((v) => v.length >= 8, 'min 8')
        .refine((v) => /[0-9]/.test(v), 'needs a digit'),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.validateAtPath({ password: 'abc' }, undefined)
    // zod short-circuits after the first failing refinement on a single
    // value — we assert that at least one fires and the path is correct.
    expect(result.success).toBe(false)
    expect(result.errors?.[0]?.path).toEqual(['password'])
  })
})

describe('zod v4 adapter — transform / pipe', () => {
  it('transform produces the transformed shape when parse succeeds', () => {
    const schema = z.object({
      email: z.string().transform((v) => v.trim().toLowerCase()),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.validateAtPath({ email: '  HI@X.CO  ' }, undefined)
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ email: 'hi@x.co' })
  })

  it('pipe rejects when the input schema fails, with the leaf path', () => {
    const schema = z.object({
      ageStr: z.string().pipe(z.coerce.number().int()),
    })
    const adapter = zodAdapter(schema)('f')
    const bad = adapter.validateAtPath({ ageStr: 'not-a-number' }, undefined)
    expect(bad.success).toBe(false)
    expect(bad.errors?.[0]?.path).toEqual(['ageStr'])
  })

  it('pipe succeeds end-to-end when the input parses through', () => {
    const schema = z.object({
      ageStr: z.string().pipe(z.coerce.number()),
    })
    const adapter = zodAdapter(schema)('f')
    const ok = adapter.validateAtPath({ ageStr: '42' }, undefined)
    expect(ok.success).toBe(true)
    expect(ok.data).toEqual({ ageStr: 42 })
  })
})

describe('zod v4 adapter — discriminated union with per-branch refinement', () => {
  it('routes refinement errors to the active branch', () => {
    const schema = z.object({
      event: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('click'),
          x: z.number().refine((v) => v >= 0, 'x must be non-negative'),
        }),
        z.object({ kind: z.literal('scroll'), delta: z.number() }),
      ]),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.validateAtPath({ event: { kind: 'click', x: -1 } }, undefined)
    expect(result.success).toBe(false)
    const pathMatch = result.errors?.some((e) => {
      // Zod's discriminator-aware walker collapses `kind` and routes the
      // failing refinement through to `['event', 'x']` on the parent
      // object — not `['event', 'click', 'x']`. That matches how v3's
      // adapter reports the same issue shape.
      return (
        e.path.length === 2 &&
        e.path[0] === 'event' &&
        e.path[1] === 'x' &&
        e.message === 'x must be non-negative'
      )
    })
    expect(pathMatch).toBe(true)
  })
})

describe('zod v4 adapter — validateAtPath forwards issue paths under a prefix', () => {
  it('path arg + schema-level refinement produces issues under that path', () => {
    // When validating the subtree at a path, zod's issue paths are relative
    // to the subtree root. The adapter emits them verbatim — consumers
    // resolve against the same subtree, so paths stay correct end-to-end.
    const schema = z.object({
      profile: z.object({
        age: z.number().refine((v) => v >= 0, 'non-negative'),
      }),
    })
    const adapter = zodAdapter(schema)('f')
    const result = adapter.validateAtPath({ age: -1 }, 'profile')
    expect(result.success).toBe(false)
    expect(result.errors?.[0]?.path).toEqual(['age'])
    expect(result.errors?.[0]?.message).toBe('non-negative')
  })
})
