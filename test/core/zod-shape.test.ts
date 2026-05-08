import { describe, expect, it } from 'vitest'
import { z as z4 } from 'zod'
import { z as z3 } from 'zod-v3'
import {
  isZodSchemaShape,
  isZodV3SchemaShape,
  isZodV4SchemaShape,
} from '../../src/runtime/core/zod-shape'

describe('isZodV4SchemaShape', () => {
  it('returns true for a Zod v4 schema (def.type is a string)', () => {
    expect(isZodV4SchemaShape(z4.object({ email: z4.string() }))).toBe(true)
    expect(isZodV4SchemaShape(z4.string())).toBe(true)
    expect(isZodV4SchemaShape(z4.number().min(1))).toBe(true)
  })

  it('returns false for plain objects, primitives, and Zod v3 schemas', () => {
    expect(isZodV4SchemaShape(undefined)).toBe(false)
    expect(isZodV4SchemaShape(null)).toBe(false)
    expect(isZodV4SchemaShape({})).toBe(false)
    expect(isZodV4SchemaShape({ schema: z4.object({}) })).toBe(false)
    expect(isZodV4SchemaShape('z.object({})')).toBe(false)
    expect(isZodV4SchemaShape(42)).toBe(false)
    expect(isZodV4SchemaShape(z3.object({ email: z3.string() }))).toBe(false)
  })
})

describe('isZodV3SchemaShape', () => {
  it('returns true for a Zod v3 schema (_def.typeName is a string)', () => {
    expect(isZodV3SchemaShape(z3.object({ email: z3.string() }))).toBe(true)
    expect(isZodV3SchemaShape(z3.string())).toBe(true)
    expect(isZodV3SchemaShape(z3.number().min(1))).toBe(true)
  })

  it('returns false for plain objects, primitives', () => {
    expect(isZodV3SchemaShape(undefined)).toBe(false)
    expect(isZodV3SchemaShape(null)).toBe(false)
    expect(isZodV3SchemaShape({})).toBe(false)
    expect(isZodV3SchemaShape({ schema: z3.object({}) })).toBe(false)
    expect(isZodV3SchemaShape(42)).toBe(false)
  })
})

describe('isZodSchemaShape (combined)', () => {
  it('returns true for both Zod v3 and Zod v4 schemas', () => {
    expect(isZodSchemaShape(z4.object({ email: z4.string() }))).toBe(true)
    expect(isZodSchemaShape(z3.object({ email: z3.string() }))).toBe(true)
  })

  it('returns false for everything else', () => {
    expect(isZodSchemaShape(undefined)).toBe(false)
    expect(isZodSchemaShape(null)).toBe(false)
    expect(isZodSchemaShape({})).toBe(false)
    expect(isZodSchemaShape({ schema: z4.object({}) })).toBe(false)
    expect(isZodSchemaShape({ parse: () => null, validate: () => null })).toBe(false)
    expect(isZodSchemaShape('not a schema')).toBe(false)
  })

  it('does not get confused by objects whose `def` field is not an object', () => {
    expect(isZodSchemaShape({ def: 'not an object' })).toBe(false)
    expect(isZodSchemaShape({ def: null })).toBe(false)
    expect(isZodSchemaShape({ _def: 'not an object' })).toBe(false)
    expect(isZodSchemaShape({ _def: null })).toBe(false)
  })

  it('requires the inner type/typeName property to be a string', () => {
    expect(isZodSchemaShape({ def: { type: 42 } })).toBe(false)
    expect(isZodSchemaShape({ _def: { typeName: 42 } })).toBe(false)
    expect(isZodSchemaShape({ def: {} })).toBe(false)
    expect(isZodSchemaShape({ _def: {} })).toBe(false)
  })
})
