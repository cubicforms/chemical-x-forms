import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodV4Adapter } from '../../../src/runtime/adapters/zod-v4/adapter'
import { UnsupportedSchemaError } from '../../../src/runtime/adapters/zod-v4/errors'
import { deriveDefault } from '../../../src/runtime/adapters/zod-v4/default-values'

/**
 * `assertSupportedKinds` runs at adapter construction. Every case below
 * asserts that the error fires with a readable dotted path to the
 * offending node, and that the error extends the typed class so callers
 * can `instanceof`-check it.
 */
describe('zod-v4 adapter — unsupported kinds rejected at construction', () => {
  it('z.promise throws UnsupportedSchemaError with a path', () => {
    const schema = z.object({ pending: z.promise(z.number()) })
    expect(() => zodV4Adapter(schema)).toThrow(UnsupportedSchemaError)
    try {
      zodV4Adapter(schema)
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedSchemaError)
      expect((err as Error).message).toContain("'promise'")
      expect((err as Error).message).toContain("'pending'")
    }
  })

  it('z.custom throws UnsupportedSchemaError', () => {
    const schema = z.object({ thing: z.custom<string>((v) => typeof v === 'string') })
    expect(() => zodV4Adapter(schema)).toThrow(UnsupportedSchemaError)
    try {
      zodV4Adapter(schema)
    } catch (err) {
      expect((err as Error).message).toContain("'custom'")
      expect((err as Error).message).toContain("'thing'")
    }
  })

  it('z.templateLiteral throws UnsupportedSchemaError', () => {
    const schema = z.object({ greeting: z.templateLiteral(['hello ', z.string()]) })
    expect(() => zodV4Adapter(schema)).toThrow(UnsupportedSchemaError)
    try {
      zodV4Adapter(schema)
    } catch (err) {
      expect((err as Error).message).toContain("'template-literal'")
      expect((err as Error).message).toContain("'greeting'")
    }
  })

  it('recursive z.lazy() throws UnsupportedSchemaError', () => {
    // Classic self-referential: getter resolves back to the same lazy.
    // Zod types this as `z.ZodLazy<z.ZodType>`; the factory's return
    // value is the same instance as the wrapper itself.
    const self: z.ZodType = z.lazy(() => self)
    const schema = z.object({ node: self })
    expect(() => zodV4Adapter(schema)).toThrow(UnsupportedSchemaError)
    try {
      zodV4Adapter(schema)
    } catch (err) {
      expect((err as Error).message).toContain('Recursive')
      expect((err as Error).message).toContain("'node'")
    }
  })

  it('recursive z.lazy() via nested structure throws', () => {
    type Node = { value: string; children: Node[] }
    const nodeSchema: z.ZodType<Node> = z.lazy(() =>
      z.object({ value: z.string(), children: z.array(nodeSchema) })
    )
    expect(() => zodV4Adapter(z.object({ root: nodeSchema }))).toThrow(UnsupportedSchemaError)
  })
})

describe('zod-v4 adapter — supported variants of lazy/intersection/catch', () => {
  it('non-recursive z.lazy(() => z.object(...)) works', () => {
    const inner = z.object({ x: z.number() })
    const schema = z.object({ wrap: z.lazy(() => inner) })
    expect(() => zodV4Adapter(schema)).not.toThrow()
    const adapter = zodV4Adapter(schema)('test')
    const result = adapter.getDefaultValues({
      useDefaultSchemaValues: false,
      validationMode: 'lax',
      constraints: undefined,
    })
    expect(result.data).toEqual({ wrap: { x: 0 } })
  })

  it('z.intersection of two object schemas merges defaults', () => {
    const schema = z.object({
      item: z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
    })
    expect(() => zodV4Adapter(schema)).not.toThrow()
    const adapter = zodV4Adapter(schema)('test')
    const result = adapter.getDefaultValues({
      useDefaultSchemaValues: false,
      validationMode: 'lax',
      constraints: undefined,
    })
    expect(result.data).toEqual({ item: { a: '', b: 0 } })
  })

  it('z.catch(schema, value) uses the catch value when useDefault=true', () => {
    const schema = z.object({ n: z.number().catch(42) })
    const adapter = zodV4Adapter(schema)('test')
    const result = adapter.getDefaultValues({
      useDefaultSchemaValues: true,
      validationMode: 'lax',
      constraints: undefined,
    })
    expect(result.data).toEqual({ n: 42 })
  })

  it('z.catch falls through to inner leaf default when useDefault=false', () => {
    const schema = z.object({ n: z.number().catch(42) })
    const adapter = zodV4Adapter(schema)('test')
    const result = adapter.getDefaultValues({
      useDefaultSchemaValues: false,
      validationMode: 'lax',
      constraints: undefined,
    })
    expect(result.data).toEqual({ n: 0 })
  })
})

describe('zod-v4 adapter — deep schemas surface the offending path', () => {
  it('nested array of unsupported kind carries wildcard in path label', () => {
    const schema = z.object({
      items: z.array(z.object({ p: z.promise(z.string()) })),
    })
    try {
      zodV4Adapter(schema)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedSchemaError)
      expect((err as Error).message).toContain("'items.*.p'")
    }
  })

  it('union branch with unsupported kind surfaces with a branch index', () => {
    const schema = z.object({
      mixed: z.union([z.string(), z.custom<number>((v) => typeof v === 'number')]),
    })
    try {
      zodV4Adapter(schema)
      throw new Error('expected to throw')
    } catch (err) {
      expect((err as Error).message).toMatch(/mixed\.\|[0-9]+/)
    }
  })
})

describe('zod-v4 adapter — deriveDefault fallback on unsupported leaves', () => {
  it('returns undefined rather than crashing on promise/custom/template-literal', () => {
    // `deriveDefault` is the internal walker; it's kept defensive so
    // downstream code paths that bypass the constructor guard don't
    // explode. Callers using the public adapter never hit this branch.
    expect(deriveDefault(z.promise(z.string()), false)).toBeUndefined()
    expect(
      deriveDefault(
        z.custom<string>(() => true),
        false
      )
    ).toBeUndefined()
    expect(deriveDefault(z.templateLiteral(['x ', z.string()]), false)).toBeUndefined()
  })
})
