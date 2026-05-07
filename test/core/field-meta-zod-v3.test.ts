import { describe, expect, it } from 'vitest'
import { z } from 'zod-v3'
import { fieldMeta, getFieldMeta, withMeta } from '../../src/runtime/adapters/zod-v3/field-meta'

describe('Zod 3 — fieldMeta WeakMap shim + withMeta helper', () => {
  it('round-trips a payload via the withMeta helper', () => {
    const schema = withMeta(z.string(), { label: 'Reference', placeholder: 'PO-12345' })
    expect(getFieldMeta(schema)).toEqual({ label: 'Reference', placeholder: 'PO-12345' })
  })

  it('round-trips a payload via fieldMeta.add (registry-shaped surface)', () => {
    const schema = z.string()
    fieldMeta.add(schema, { description: 'Free-form notes' })
    expect(fieldMeta.get(schema)).toEqual({ description: 'Free-form notes' })
    expect(fieldMeta.has(schema)).toBe(true)
  })

  it('returns a fresh schema clone (not the original) from withMeta', () => {
    // withMeta clones first so each call gets distinct identity —
    // shields shared sub-schemas from the last-wins overwrite that
    // the schema-keyed registry would otherwise impose. The clone
    // round-trips its payload independently.
    const inner = z.string()
    const after = withMeta(inner, { label: 'X' })
    expect(after).not.toBe(inner)
    expect(getFieldMeta(after)).toEqual({ label: 'X' })
  })

  it('returns undefined for schemas with no registered payload', () => {
    expect(getFieldMeta(z.string())).toBeUndefined()
    expect(fieldMeta.has(z.string())).toBe(false)
  })

  it('chained withMeta merges payloads through clones', () => {
    // Each withMeta returns a clone with the previous clone's
    // payload merged in plus the new fields — chaining accumulates
    // rather than replacing.
    const labeled = withMeta(z.string(), { label: 'Email' })
    const labeledAndDescribed = withMeta(labeled, { description: 'For login' })
    expect(getFieldMeta(labeledAndDescribed)).toEqual({
      label: 'Email',
      description: 'For login',
    })
    expect(getFieldMeta(labeled)).toEqual({ label: 'Email' })
  })

  it('does not leak between independently constructed schemas', () => {
    const a = withMeta(z.string(), { label: 'A' })
    const b = z.string()
    expect(getFieldMeta(a)).toEqual({ label: 'A' })
    expect(getFieldMeta(b)).toBeUndefined()
  })
})

describe('Zod 3 — registry stores against schema reference identity', () => {
  // Direct fieldMeta.add (the .register-equivalent for v3) keys on
  // the schema reference. The path-resolver disambiguates per
  // tree-walk occurrence when the same schema instance is bound at
  // multiple paths; these tests just lock the per-reference write
  // semantics.
  it('a registration on the inner is readable on the inner reference', () => {
    const inner = z.string()
    fieldMeta.add(inner, { label: 'Foo' })
    expect(getFieldMeta(inner)).toEqual({ label: 'Foo' })
  })

  it('a registration on the inner is NOT readable on a derived wrapper', () => {
    const inner = z.string()
    const outer = inner.optional()
    fieldMeta.add(inner, { label: 'Foo' })
    expect(getFieldMeta(inner)).toEqual({ label: 'Foo' })
    expect(getFieldMeta(outer)).toBeUndefined()
  })

  it('a registration on a wrapper is readable on the wrapper but not the inner', () => {
    const inner = z.string()
    const outer = inner.optional()
    fieldMeta.add(outer, { label: 'Foo' })
    expect(getFieldMeta(outer)).toEqual({ label: 'Foo' })
    expect(getFieldMeta(inner)).toBeUndefined()
  })

  it('a registration on .default(x) is readable on the wrapper', () => {
    const inner = z.string()
    const outer = inner.default('seed')
    fieldMeta.add(outer, { label: 'Foo' })
    expect(getFieldMeta(outer)).toEqual({ label: 'Foo' })
    expect(getFieldMeta(inner)).toBeUndefined()
  })
})

describe('Zod 3 — coexistence with .describe()', () => {
  it('keeps schema.description independent of registry payload', () => {
    const schema = withMeta(z.string().describe('legacy desc'), { description: 'fresh' })
    expect(schema.description).toBe('legacy desc')
    expect(getFieldMeta(schema)).toEqual({ description: 'fresh' })
  })

  it('does not crash when only .describe() is set (no registry entry)', () => {
    const schema = z.string().describe('legacy desc')
    expect(schema.description).toBe('legacy desc')
    expect(getFieldMeta(schema)).toBeUndefined()
  })
})
