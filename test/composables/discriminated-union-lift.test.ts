import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type { IsUnion, KeyofUnion, ValueOfUnion } from '../../src/runtime/types/types-core'
import type {
  FieldStateLeaf,
  FieldStateMapEntry,
  ValidationError,
} from '../../src/runtime/types/types-api'
import type { useForm } from '../../src/zod'

/**
 * Type-level coverage for the discriminated-union "lift" applied to
 * `FieldStateMapEntry` (form.fields chained) and `ErrorsProxyShape`
 * (form.errors chained). The lift merges keys across object-union
 * members so per-variant leaves are addressable through one chained
 * shape, regardless of which discriminant is currently active —
 * matching the runtime's stable-stub semantics for inactive paths.
 *
 * Single-object types must NOT regress: the homomorphic branch is
 * preserved via `IsUnion<T>` gating, so literal keys stay literal
 * (no widening to a string index signature).
 *
 * Distribution-preserved regression on `form.values`: value shapes
 * are not lifted — `form.values.cargo` keeps its discriminated-union
 * structure so a downstream consumer can pattern-match on the
 * runtime variant. (Note: literal discriminators are widened by
 * `WriteShape`, so TS's discriminator narrowing on `cargo.type`
 * doesn't fire; the regression guard here checks that the union
 * structure is preserved, not that narrowing engages.)
 */

describe('IsUnion / KeyofUnion / ValueOfUnion — utility behavior', () => {
  it('IsUnion<T> distinguishes unions from single types', () => {
    expectTypeOf<IsUnion<{ a: 1 }>>().toEqualTypeOf<false>()
    expectTypeOf<IsUnion<{ a: 1 } | { b: 2 }>>().toEqualTypeOf<true>()
    expectTypeOf<IsUnion<string | number>>().toEqualTypeOf<true>()
    expectTypeOf<IsUnion<string>>().toEqualTypeOf<false>()
  })

  it('KeyofUnion<T> unions keys across object-union members', () => {
    expectTypeOf<KeyofUnion<{ a: 1; b: 2 }>>().toEqualTypeOf<'a' | 'b'>()
    expectTypeOf<KeyofUnion<{ a: 1 } | { b: 2 }>>().toEqualTypeOf<'a' | 'b'>()
    expectTypeOf<KeyofUnion<{ a: 1 } | { a: 2; b: 3 }>>().toEqualTypeOf<'a' | 'b'>()
  })

  it('ValueOfUnion<T, K> contributes undefined for missing-variant keys', () => {
    expectTypeOf<ValueOfUnion<{ a: string; b: number }, 'a'>>().toEqualTypeOf<string>()
    expectTypeOf<ValueOfUnion<{ a: string } | { b: number }, 'a'>>().toEqualTypeOf<
      string | undefined
    >()
    expectTypeOf<ValueOfUnion<{ a: string } | { a: number }, 'a'>>().toEqualTypeOf<
      string | number
    >()
    expectTypeOf<ValueOfUnion<{ a: 'x' } | { a: 'y' } | { a: 'z' }, 'a'>>().toEqualTypeOf<
      'x' | 'y' | 'z'
    >()
  })
})

describe('FieldStateMapEntry — discriminated-union lift (synthetic fixtures)', () => {
  type Cargo =
    | { type: 'dry'; items: ReadonlyArray<{ sku: string }>; fragile: boolean }
    | {
        type: 'refrigerated'
        items: ReadonlyArray<{ sku: string }>
        tempMinC: number
        tempMaxC: number
      }
    | {
        type: 'hazmat'
        items: ReadonlyArray<{ sku: string }>
        unNumber: string
        hazardClass: '1' | '2' | '3'
      }
    | {
        type: 'oversized'
        items: ReadonlyArray<{ sku: string }>
        lengthCm: number
        widthCm: number
        heightCm: number
      }

  it('discriminator key (present in every variant) types without `| undefined`', () => {
    type T = FieldStateMapEntry<Cargo>['type']
    expectTypeOf<T>().toEqualTypeOf<
      FieldStateLeaf<'dry' | 'refrigerated' | 'hazmat' | 'oversized'>
    >()
  })

  it('per-variant key (only on one variant) types as `T | undefined`', () => {
    type FragileLeaf = FieldStateMapEntry<Cargo>['fragile']
    expectTypeOf<FragileLeaf>().toEqualTypeOf<FieldStateLeaf<boolean | undefined>>()

    type TempMinLeaf = FieldStateMapEntry<Cargo>['tempMinC']
    expectTypeOf<TempMinLeaf>().toEqualTypeOf<FieldStateLeaf<number | undefined>>()

    type UnNumberLeaf = FieldStateMapEntry<Cargo>['unNumber']
    expectTypeOf<UnNumberLeaf>().toEqualTypeOf<FieldStateLeaf<string | undefined>>()

    type LengthLeaf = FieldStateMapEntry<Cargo>['lengthCm']
    expectTypeOf<LengthLeaf>().toEqualTypeOf<FieldStateLeaf<number | undefined>>()
  })

  it('single-object regression: literal keys stay literal, no extra `| undefined`', () => {
    type Single = { a: string; b: number }
    type ALeaf = FieldStateMapEntry<Single>['a']
    expectTypeOf<ALeaf>().toEqualTypeOf<FieldStateLeaf<string>>()

    type BLeaf = FieldStateMapEntry<Single>['b']
    expectTypeOf<BLeaf>().toEqualTypeOf<FieldStateLeaf<number>>()
  })
})

const _cargoSchema = z.object({
  reference: z.string(),
  cargo: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('dry'),
      items: z.array(z.object({ sku: z.string() })),
      fragile: z.boolean(),
    }),
    z.object({
      type: z.literal('refrigerated'),
      items: z.array(z.object({ sku: z.string() })),
      tempMinC: z.number(),
      tempMaxC: z.number(),
    }),
    z.object({
      type: z.literal('hazmat'),
      items: z.array(z.object({ sku: z.string() })),
      unNumber: z.string(),
      hazardClass: z.enum(['1', '2', '3']),
    }),
    z.object({
      type: z.literal('oversized'),
      items: z.array(z.object({ sku: z.string() })),
      lengthCm: z.number(),
      widthCm: z.number(),
      heightCm: z.number(),
    }),
  ]),
})

type CargoForm = ReturnType<typeof useForm<typeof _cargoSchema>>

// Recursive Proxy stand-in (same pattern as type-inference.test.ts):
// the file never invokes useForm because there's no Vue app context;
// only the static types the checker sees matter.
const form: CargoForm = (() => {
  const handler: ProxyHandler<() => unknown> = {
    get: () => proxy,
    apply: () => proxy,
  }
  const proxy: unknown = new Proxy(() => undefined, handler)
  return proxy as CargoForm
})()

describe('useForm — chained access on form.fields with cargo schema', () => {
  it('per-variant fields are reachable regardless of active variant', () => {
    expectTypeOf(form.fields.cargo.tempMinC.value).toEqualTypeOf<number | undefined>()
    expectTypeOf(form.fields.cargo.tempMaxC.value).toEqualTypeOf<number | undefined>()
    expectTypeOf(form.fields.cargo.fragile.value).toEqualTypeOf<boolean | undefined>()
    expectTypeOf(form.fields.cargo.unNumber.value).toEqualTypeOf<string | undefined>()
    expectTypeOf(form.fields.cargo.lengthCm.value).toEqualTypeOf<number | undefined>()
  })

  it('common keys typecheck; non-existent keys are rejected', () => {
    expectTypeOf(form.fields.reference.value).toEqualTypeOf<string>()
    // @ts-expect-error 'nonexistent' is not a key on any cargo variant
    void form.fields.cargo.nonexistent
  })
})

describe('useForm — chained access on form.errors with cargo schema', () => {
  it('per-variant errors are reachable; leaf is ValidationError[] | undefined', () => {
    expectTypeOf(form.errors.cargo.tempMinC).toEqualTypeOf<readonly ValidationError[] | undefined>()
    expectTypeOf(form.errors.cargo.fragile).toEqualTypeOf<readonly ValidationError[] | undefined>()
    expectTypeOf(form.errors.cargo.unNumber).toEqualTypeOf<readonly ValidationError[] | undefined>()
  })

  it('non-existent keys are rejected', () => {
    // @ts-expect-error 'nonexistent' is not a key on any cargo variant
    void form.errors.cargo.nonexistent
  })
})

describe('value-shape regression guard (WriteShape NOT lifted)', () => {
  // If `WriteShape` were accidentally lifted, `form.values.cargo`
  // would become a single merged object instead of a union of
  // variants. Pattern-matching on the runtime variant would lose
  // its structural distinction. These assertions guard against that.
  //
  // Note: `WriteShape` widens literal discriminators (`'dry'` →
  // `string`), so TS's literal-narrowing on `if (cargo.type === 'X')`
  // doesn't engage here — but the union STRUCTURE must still be
  // present (each variant's per-variant keys still tied to that
  // member only). We assert that by reading a per-variant key on
  // the union directly: it must be `T | undefined` if the lift
  // happened, but must STAY a type error if WriteShape stays
  // distributive.
  it('form.values.cargo retains its discriminated-union structure', () => {
    // @ts-expect-error tempMinC is variant-specific; reading it on the
    // un-lifted union (without narrowing) is still a type error.
    void form.values.cargo?.tempMinC
    // @ts-expect-error fragile is variant-specific; same as above.
    void form.values.cargo?.fragile
  })
})
