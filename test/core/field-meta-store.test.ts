import { describe, expect, it } from 'vitest'
import { z as z4 } from 'zod'
import { z as z3 } from 'zod-v3'
import { fieldMeta, withMeta } from '../../src/runtime/adapters/unified/field-meta'
import { getFieldMeta as getFieldMetaV4 } from '../../src/runtime/adapters/zod-v4/field-meta'
import { getFieldMeta as getFieldMetaV3 } from '../../src/runtime/adapters/zod-v3/field-meta'

describe('Unified fieldMeta store — cross-adapter storage', () => {
  it('round-trips a payload on a Zod 4 schema via withMeta', () => {
    const schema = withMeta(z4.string(), { label: 'Username', placeholder: 'your-handle' })
    expect(getFieldMetaV4(schema)).toEqual({ label: 'Username', placeholder: 'your-handle' })
  })

  it('round-trips a payload on a Zod 3 schema via withMeta', () => {
    const schema = withMeta(z3.string(), { label: 'Username', placeholder: 'your-handle' })
    expect(getFieldMetaV3(schema)).toEqual({ label: 'Username', placeholder: 'your-handle' })
  })

  it('clones the schema (fresh identity, payload on the clone only)', () => {
    const innerV4 = z4.string()
    const afterV4 = withMeta(innerV4, { label: 'A' })
    expect(afterV4).not.toBe(innerV4)
    expect(getFieldMetaV4(innerV4)).toBeUndefined()
    expect(getFieldMetaV4(afterV4)).toEqual({ label: 'A' })

    const innerV3 = z3.string()
    const afterV3 = withMeta(innerV3, { label: 'A' })
    expect(afterV3).not.toBe(innerV3)
    expect(getFieldMetaV3(innerV3)).toBeUndefined()
    expect(getFieldMetaV3(afterV3)).toEqual({ label: 'A' })
  })

  it('chained withMeta merges payloads through clones', () => {
    // Same accumulating-merge semantics on both majors.
    const v4 = withMeta(withMeta(z4.string(), { label: 'X' }), { description: 'Y' })
    expect(getFieldMetaV4(v4)).toEqual({ label: 'X', description: 'Y' })

    const v3 = withMeta(withMeta(z3.string(), { label: 'X' }), { description: 'Y' })
    expect(getFieldMetaV3(v3)).toEqual({ label: 'X', description: 'Y' })
  })

  it('fieldMeta.add writes that the per-major getters can read', () => {
    const v4Schema = z4.string()
    fieldMeta.add(v4Schema, { description: 'Free-form notes' })
    expect(getFieldMetaV4(v4Schema)).toEqual({ description: 'Free-form notes' })

    // The unified `fieldMeta` is typed as Zod 4's $ZodRegistry — the
    // structurally-loose runtime accepts a Zod 3 schema fine, but the
    // type system needs an `as never`-style cast at this call site.
    const v3Schema = z3.string()
    ;(fieldMeta.add as (s: object, p: { description: string }) => unknown)(v3Schema, {
      description: 'Free-form notes',
    })
    expect(getFieldMetaV3(v3Schema)).toEqual({ description: 'Free-form notes' })
  })

  it('Zod 4 native .register chain delegates to the shared store', () => {
    // Native .register() calls registry.add(this, payload); the shared
    // store's structural shape (.add) satisfies it at runtime, and the
    // payload surfaces through the v4 adapter's getter.
    const schema = z4
      .string()
      .register(fieldMeta, { label: 'Username', placeholder: 'your-handle' })
    expect(getFieldMetaV4(schema)).toEqual({ label: 'Username', placeholder: 'your-handle' })
  })

  it('does not leak between independently constructed schemas', () => {
    const a = withMeta(z4.string(), { label: 'A' })
    const b = z4.string()
    expect(getFieldMetaV4(a)).toEqual({ label: 'A' })
    expect(getFieldMetaV4(b)).toBeUndefined()

    const c = withMeta(z3.string(), { label: 'C' })
    const d = z3.string()
    expect(getFieldMetaV3(c)).toEqual({ label: 'C' })
    expect(getFieldMetaV3(d)).toBeUndefined()
  })
})
