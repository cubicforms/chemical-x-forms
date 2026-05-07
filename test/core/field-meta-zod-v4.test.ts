import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  fieldMeta,
  getFieldMeta,
  getFieldMetaList,
  withMeta,
} from '../../src/runtime/adapters/zod-v4/field-meta'

describe('Zod 4 — fieldMeta registry + withMeta helper', () => {
  it('round-trips a payload via the native schema.register chain', () => {
    const schema = z.string().register(fieldMeta, { label: 'Email', placeholder: 'you@…' })
    expect(getFieldMeta(schema)).toEqual({ label: 'Email', placeholder: 'you@…' })
  })

  it('round-trips a payload via the withMeta helper', () => {
    const schema = withMeta(z.string(), { label: 'Reference', description: 'PO number' })
    expect(getFieldMeta(schema)).toEqual({ label: 'Reference', description: 'PO number' })
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
    // The intermediate clone keeps just its own label.
    expect(getFieldMeta(labeled)).toEqual({ label: 'Email' })
  })

  it('does not leak between independently constructed schemas', () => {
    const a = withMeta(z.string(), { label: 'A' })
    const b = z.string()
    expect(getFieldMeta(a)).toEqual({ label: 'A' })
    expect(getFieldMeta(b)).toBeUndefined()
  })
})

describe('Zod 4 — fieldMeta tracks every registration on a shared schema', () => {
  // The native `.register()` chain returns the original schema (not a
  // clone), so two registrations on the same instance both end up
  // pointing at the same registry slot from the consumer's view.
  // fieldMeta keeps a list per schema reference (in registration
  // order) so the path-resolver can disambiguate by tree-walk
  // occurrence — see the adapter's resolveFieldMetaAtPath.
  it('exposes every registered payload via getFieldMetaList', () => {
    const shared = z.string()
    shared.register(fieldMeta, { label: 'First' })
    shared.register(fieldMeta, { label: 'Second' })
    expect(getFieldMetaList(shared)).toEqual([{ label: 'First' }, { label: 'Second' }])
  })

  it('still surfaces the most recent registration via getFieldMeta', () => {
    // The single-payload getter falls through to Zod's native registry,
    // which keeps last-write-wins. Adapter code that wants per-path
    // disambiguation calls into the resolver, not getFieldMeta.
    const shared = z.string()
    shared.register(fieldMeta, { label: 'First' })
    shared.register(fieldMeta, { label: 'Second' })
    expect(getFieldMeta(shared)).toEqual({ label: 'Second' })
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
