import { fc, test } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { z } from 'zod'
import { fingerprintZodSchema } from '../../../src/runtime/adapters/zod-v4/fingerprint'

/**
 * Statistical injectivity test for the zod-v4 schema fingerprint.
 *
 * We can't black-box test "no two schemas collide" directly — the
 * space of Zod schemas is unbounded and generating random zod objects
 * naturally produces genuine duplicates (random generation can happen
 * to pick identical shapes). So we work through an intermediate
 * representation — **schema recipes** — which we can:
 *
 *   1. Generate deterministically via fast-check arbitraries.
 *   2. Turn into Zod schemas via `buildZod(recipe)`.
 *   3. Canonicalise into a reference string via `canonicaliseRecipe`
 *      that mirrors the fingerprint's observable semantics
 *      (key-order-insensitive for object, membership-order-insensitive
 *      for union).
 *
 * Then we state two properties:
 *
 *   - **Idempotence:** two separately-built Zod schemas from the same
 *     recipe fingerprint identically.
 *   - **Injectivity modulo canonical form:** two recipes with
 *     distinct canonical strings must fingerprint differently. If
 *     they fingerprint the same, that's a real collision and
 *     fast-check will shrink to the minimal counter-example.
 *
 * The recipe generator excludes features known to collapse in the
 * fingerprint (refinements / transforms / lazy defaults returning
 * functions) — those are documented false-negatives and a statistical
 * test that included them would be asserting something we explicitly
 * gave up on.
 */

type Recipe =
  | { readonly kind: 'string'; readonly min: number | undefined; readonly max: number | undefined }
  | { readonly kind: 'number'; readonly min: number | undefined; readonly max: number | undefined }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'null' }
  | { readonly kind: 'undefined' }
  | { readonly kind: 'date' }
  | { readonly kind: 'bigint' }
  | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'optional'; readonly inner: Recipe }
  | { readonly kind: 'nullable'; readonly inner: Recipe }
  | { readonly kind: 'array'; readonly element: Recipe }
  | { readonly kind: 'tuple'; readonly items: readonly Recipe[] }
  | {
      readonly kind: 'object'
      readonly fields: ReadonlyArray<readonly [string, Recipe]>
    }
  | { readonly kind: 'union'; readonly options: readonly Recipe[] }
  | {
      readonly kind: 'dunion'
      readonly discriminator: string
      readonly options: ReadonlyArray<{
        readonly tag: string
        readonly extra: ReadonlyArray<readonly [string, Recipe]>
      }>
    }

function buildZod(recipe: Recipe): z.ZodType {
  switch (recipe.kind) {
    case 'string': {
      let s = z.string()
      if (recipe.min !== undefined) s = s.min(recipe.min)
      if (recipe.max !== undefined) s = s.max(recipe.max)
      return s
    }
    case 'number': {
      let n = z.number()
      if (recipe.min !== undefined) n = n.min(recipe.min)
      if (recipe.max !== undefined) n = n.max(recipe.max)
      return n
    }
    case 'boolean':
      return z.boolean()
    case 'null':
      return z.null()
    case 'undefined':
      return z.undefined()
    case 'date':
      return z.date()
    case 'bigint':
      return z.bigint()
    case 'literal':
      return z.literal(recipe.value as string | number | boolean)
    case 'enum': {
      // `z.enum` requires a non-empty tuple of string literals.
      const vs = recipe.values as [string, ...string[]]
      return z.enum(vs)
    }
    case 'optional':
      return buildZod(recipe.inner).optional()
    case 'nullable':
      return buildZod(recipe.inner).nullable()
    case 'array':
      return z.array(buildZod(recipe.element))
    case 'tuple': {
      const items = recipe.items.map(buildZod)
      // `z.tuple` signature requires [T, ...T[]]; at-least-one is
      // enforced by the arbitrary below.
      return z.tuple(items as unknown as [z.ZodType, ...z.ZodType[]]) as unknown as z.ZodType
    }
    case 'object': {
      const shape: Record<string, z.ZodType> = {}
      for (const [k, r] of recipe.fields) shape[k] = buildZod(r)
      return z.object(shape)
    }
    case 'union': {
      const opts = recipe.options.map(buildZod)
      return z.union(opts as unknown as readonly [z.ZodType, z.ZodType, ...z.ZodType[]])
    }
    case 'dunion': {
      const opts = recipe.options.map((opt) => {
        const shape: Record<string, z.ZodType> = {
          [recipe.discriminator]: z.literal(opt.tag),
        }
        for (const [k, r] of opt.extra) shape[k] = buildZod(r)
        return z.object(shape)
      })
      return z.discriminatedUnion(
        recipe.discriminator,
        opts as unknown as readonly [z.ZodObject, ...z.ZodObject[]]
      )
    }
  }
}

/**
 * Canonical string representation of a recipe. Mirrors the
 * fingerprint's observable semantics: object field entries sorted by
 * key, union options sorted by their own canonical forms, checks
 * handled identically, structural kinds distinguished.
 *
 * If two recipes canonicalise to the same string, they should
 * fingerprint the same; if they canonicalise differently, they MUST
 * fingerprint differently.
 */
function canonicaliseRecipe(recipe: Recipe): string {
  switch (recipe.kind) {
    case 'string':
    case 'number': {
      const parts: string[] = []
      if (recipe.min !== undefined) parts.push(`min:${recipe.min}`)
      if (recipe.max !== undefined) parts.push(`max:${recipe.max}`)
      parts.sort()
      return parts.length === 0 ? recipe.kind : `${recipe.kind}[${parts.join(';')}]`
    }
    case 'boolean':
    case 'null':
    case 'undefined':
    case 'date':
    case 'bigint':
      return recipe.kind
    case 'literal':
      return `literal:${JSON.stringify(recipe.value)}`
    case 'enum':
      return `enum:[${[...recipe.values]
        .sort()
        .map((v) => JSON.stringify(v))
        .join(',')}]`
    case 'optional':
      return `optional(${canonicaliseRecipe(recipe.inner)})`
    case 'nullable':
      return `nullable(${canonicaliseRecipe(recipe.inner)})`
    case 'array':
      return `array[${canonicaliseRecipe(recipe.element)}]`
    case 'tuple':
      return `tuple[${recipe.items.map(canonicaliseRecipe).join(',')}]`
    case 'object': {
      const sorted = [...recipe.fields].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return `object{${sorted
        .map(([k, r]) => `${JSON.stringify(k)}:${canonicaliseRecipe(r)}`)
        .join(',')}}`
    }
    case 'union': {
      const opts = recipe.options.map(canonicaliseRecipe).sort()
      return `union(${opts.join('|')})`
    }
    case 'dunion': {
      const opts = recipe.options
        .map((opt) => {
          const sortedExtra = [...opt.extra].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          return `${JSON.stringify(opt.tag)}{${sortedExtra
            .map(([k, r]) => `${JSON.stringify(k)}:${canonicaliseRecipe(r)}`)
            .join(',')}}`
        })
        .sort()
      return `dunion[${JSON.stringify(recipe.discriminator)}](${opts.join('|')})`
    }
  }
}

/** Field names — small alphabet keeps collision likelihood high enough that shared-shape cases get exercised. */
const fieldName = fc.stringMatching(/^[a-e]{1,3}$/)

/** Values for literals — lift into the union we declared on the recipe. */
const literalValue: fc.Arbitrary<string | number | boolean | null> = fc.oneof(
  fc.constantFrom<string | number | boolean | null>(null, true, false),
  fc.string({ minLength: 1, maxLength: 3 }),
  fc.integer({ min: -5, max: 5 })
)

/**
 * Recursive recipe arbitrary with bounded depth. `fc.letrec` gives
 * us ref-cycles for the self-referential slots (optional/nullable/
 * array/tuple/object/union). Depth is capped implicitly by
 * fc.maxDepth on the default config — we set an explicit
 * `maxDepth: 3` below to keep generation tractable.
 */
const recipeArb: fc.Arbitrary<Recipe> = fc.letrec<{ recipe: Recipe }>((tie) => ({
  recipe: fc.oneof(
    // `maxDepth: 5` lets the generator produce recipes that go a
    // handful of levels deep before bottoming out at a leaf. Deeper
    // than typical forms but within tractable runtime, and enough
    // to exercise the walker's descent at a depth where a
    // sort-stability or serialisation bug would likely surface.
    { maxDepth: 5 },
    // Leaves — weighted heavier than containers so trees shrink faster.
    fc.record({
      kind: fc.constant('string' as const),
      min: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
      max: fc.option(fc.integer({ min: 6, max: 20 }), { nil: undefined }),
    }),
    fc.record({
      kind: fc.constant('number' as const),
      min: fc.option(fc.integer({ min: -10, max: 0 }), { nil: undefined }),
      max: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
    }),
    fc.constant({ kind: 'boolean' as const }),
    fc.constant({ kind: 'null' as const }),
    fc.constant({ kind: 'undefined' as const }),
    fc.constant({ kind: 'date' as const }),
    fc.constant({ kind: 'bigint' as const }),
    literalValue.map((v) => ({ kind: 'literal' as const, value: v })),
    fc
      .array(fc.stringMatching(/^[a-c]{1,2}$/), { minLength: 1, maxLength: 4 })
      .map((values) => ({
        kind: 'enum' as const,
        // de-dup; z.enum rejects duplicates.
        values: Array.from(new Set(values)),
      }))
      .filter((r) => r.values.length > 0),
    // Containers — tied recursively for nesting.
    fc.record({
      kind: fc.constant('optional' as const),
      inner: tie('recipe') as fc.Arbitrary<Recipe>,
    }),
    fc.record({
      kind: fc.constant('nullable' as const),
      inner: tie('recipe') as fc.Arbitrary<Recipe>,
    }),
    fc.record({
      kind: fc.constant('array' as const),
      element: tie('recipe') as fc.Arbitrary<Recipe>,
    }),
    fc
      .array(tie('recipe') as fc.Arbitrary<Recipe>, { minLength: 1, maxLength: 3 })
      .map((items) => ({ kind: 'tuple' as const, items })),
    fc
      .array(fc.tuple(fieldName, tie('recipe') as fc.Arbitrary<Recipe>), {
        minLength: 1,
        maxLength: 4,
      })
      .map((entries) => {
        // Dedup duplicate keys (later wins) so the recipe reflects the
        // final object shape.
        const map = new Map<string, Recipe>()
        for (const [k, v] of entries) map.set(k, v)
        return { kind: 'object' as const, fields: [...map.entries()] }
      }),
    fc
      .array(tie('recipe') as fc.Arbitrary<Recipe>, { minLength: 2, maxLength: 3 })
      .map((options) => ({ kind: 'union' as const, options }))
  ),
})).recipe

describe('v4 fingerprint — statistical injectivity (property-based)', () => {
  test.prop([recipeArb], { numRuns: 400 })(
    'idempotence: same recipe → same fingerprint across independent builds',
    (recipe) => {
      const fpA = fingerprintZodSchema(buildZod(recipe))
      const fpB = fingerprintZodSchema(buildZod(recipe))
      expect(fpA).toBe(fpB)
    }
  )

  test.prop([recipeArb, recipeArb], { numRuns: 800 })(
    'injectivity: canonically-different recipes → different fingerprints',
    (r1, r2) => {
      // Skip pairs that canonicalise identically — they SHOULD match,
      // which isn't a collision. fast-check's `fc.pre` tells the
      // runner to pick a fresh pair.
      fc.pre(canonicaliseRecipe(r1) !== canonicaliseRecipe(r2))
      const fp1 = fingerprintZodSchema(buildZod(r1))
      const fp2 = fingerprintZodSchema(buildZod(r2))
      expect(fp1).not.toBe(fp2)
    }
  )
})
