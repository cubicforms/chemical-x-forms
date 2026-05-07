import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fieldMeta, getFieldMeta, withMeta } from '../../src/runtime/adapters/zod-v4/field-meta'

describe('Zod 4 — fieldMeta registry + withMeta helper', () => {
  it('round-trips a payload via the native schema.register chain', () => {
    const schema = z.string().register(fieldMeta, { label: 'Email', placeholder: 'you@…' })
    expect(getFieldMeta(schema)).toEqual({ label: 'Email', placeholder: 'you@…' })
  })

  it('round-trips a payload via the withMeta helper', () => {
    const schema = withMeta(z.string(), { label: 'Reference', description: 'PO number' })
    expect(getFieldMeta(schema)).toEqual({ label: 'Reference', description: 'PO number' })
  })

  it('returns the schema reference (chainable) from withMeta', () => {
    const inner = z.string()
    const after = withMeta(inner, { label: 'X' })
    expect(after).toBe(inner)
  })

  it('returns undefined for schemas with no registered payload', () => {
    expect(getFieldMeta(z.string())).toBeUndefined()
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

describe('Zod 4 — registry stores against schema reference identity', () => {
  // These tests lock the WeakMap-keyed-by-reference behavior — every
  // schema instance is a distinct registry slot. The adapter's
  // two-stage lookup (target then peeled inner) builds on top of
  // this so both registration patterns surface payloads through
  // `getFieldMetaAtPath`; the tests live in
  // `test/composables/field-state-metadata.test.ts`.
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

describe('Zod 4 — coexistence with .describe()', () => {
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
