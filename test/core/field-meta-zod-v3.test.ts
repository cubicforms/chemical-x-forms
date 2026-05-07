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

  it('returns the schema reference (chainable) from withMeta', () => {
    const inner = z.string()
    const after = withMeta(inner, { label: 'X' })
    expect(after).toBe(inner)
  })

  it('returns undefined for schemas with no registered payload', () => {
    expect(getFieldMeta(z.string())).toBeUndefined()
    expect(fieldMeta.has(z.string())).toBe(false)
  })

  it('overwrites a prior payload when registered twice on the same schema', () => {
    const schema = z.string()
    withMeta(schema, { label: 'First' })
    withMeta(schema, { label: 'Second' })
    expect(getFieldMeta(schema)).toEqual({ label: 'Second' })
  })

  it('does not leak between independently constructed schemas', () => {
    const a = z.string()
    const b = z.string()
    withMeta(a, { label: 'A' })
    expect(getFieldMeta(a)).toEqual({ label: 'A' })
    expect(getFieldMeta(b)).toBeUndefined()
  })
})

describe('Zod 3 — registry stores against schema reference identity', () => {
  // Mirrors the v4 suite — WeakMap-keyed-by-reference; the adapter's
  // two-stage lookup builds on this so both registration patterns
  // surface payloads through `getFieldMetaAtPath`. Adapter-integration
  // tests live in `test/composables/field-state-metadata.test.ts`.
  it('a registration on the inner is readable on the inner reference', () => {
    const inner = z.string()
    withMeta(inner, { label: 'Foo' })
    expect(getFieldMeta(inner)).toEqual({ label: 'Foo' })
  })

  it('a registration on the inner is NOT readable on a derived wrapper', () => {
    const inner = z.string()
    const outer = inner.optional()
    withMeta(inner, { label: 'Foo' })
    expect(getFieldMeta(inner)).toEqual({ label: 'Foo' })
    expect(getFieldMeta(outer)).toBeUndefined()
  })

  it('a registration on a wrapper is readable on the wrapper but not the inner', () => {
    const inner = z.string()
    const outer = inner.optional()
    withMeta(outer, { label: 'Foo' })
    expect(getFieldMeta(outer)).toEqual({ label: 'Foo' })
    expect(getFieldMeta(inner)).toBeUndefined()
  })

  it('a registration on .default(x) is readable on the wrapper', () => {
    const inner = z.string()
    const outer = inner.default('seed')
    withMeta(outer, { label: 'Foo' })
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
