import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  getDiscriminatedUnionFirstOption,
  unwrapToDiscriminatedUnion,
} from '../../../src/runtime/adapters/zod-v4/discriminator'

const du = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ok'), value: z.string() }),
  z.object({ kind: z.literal('err'), message: z.string() }),
])

describe('unwrapToDiscriminatedUnion', () => {
  it('returns the DU when given one directly', () => {
    expect(unwrapToDiscriminatedUnion(du)).toBe(du)
  })

  it('unwraps optional → DU', () => {
    const wrapped = du.optional()
    const resolved = unwrapToDiscriminatedUnion(wrapped)
    expect(resolved).toBe(du)
  })

  it('unwraps nullable → DU', () => {
    const wrapped = du.nullable()
    const resolved = unwrapToDiscriminatedUnion(wrapped)
    expect(resolved).toBe(du)
  })

  it('unwraps default → DU', () => {
    const wrapped = du.default({ kind: 'ok', value: 'x' })
    const resolved = unwrapToDiscriminatedUnion(wrapped)
    expect(resolved).toBe(du)
  })

  it('unwraps through stacked layers', () => {
    const wrapped = du.optional().nullable()
    const resolved = unwrapToDiscriminatedUnion(wrapped)
    expect(resolved).toBe(du)
  })

  it('returns undefined for non-DU schemas', () => {
    expect(unwrapToDiscriminatedUnion(z.string())).toBeUndefined()
    expect(unwrapToDiscriminatedUnion(z.object({ x: z.string() }))).toBeUndefined()
    expect(unwrapToDiscriminatedUnion(z.array(z.string()))).toBeUndefined()
  })

  it('returns undefined for plain unions (non-discriminated)', () => {
    const plain = z.union([z.string(), z.number()])
    expect(unwrapToDiscriminatedUnion(plain)).toBeUndefined()
  })
})

describe('getDiscriminatedUnionFirstOption', () => {
  it('returns the first option', () => {
    const first = getDiscriminatedUnionFirstOption(du)
    // Non-null assertion in place of `.toBeDefined()` + `?.` chain — if
    // `first` is undefined the next line throws, surfacing the bug
    // directly instead of skipping the safeParse assertions silently.
    if (first === undefined) throw new Error('expected a first option')
    // First option is the 'ok' branch — parse with kind=ok should succeed.
    expect(first.safeParse({ kind: 'ok', value: 'x' }).success).toBe(true)
    expect(first.safeParse({ kind: 'err', message: 'x' }).success).toBe(false)
  })

  it('returns undefined for non-DU schemas', () => {
    expect(getDiscriminatedUnionFirstOption(z.string())).toBeUndefined()
  })
})
