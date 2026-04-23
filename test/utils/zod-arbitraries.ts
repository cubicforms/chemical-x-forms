/**
 * Shared fast-check arbitraries for zod schemas. The zod v3 and v4 ZodType
 * trees have divergent internal types but parallel constructor APIs for the
 * supported kinds, so these factories are parameterised on the `z`
 * namespace — each adapter's fuzz file passes its own typed `z` in.
 *
 * Depth is capped explicitly via recursion parameter; we don't rely on
 * fc.letrec's probabilistic termination. At depth 0 only leaf schemas are
 * produced; each wrapper / container pass below that descends one level.
 *
 * Kinds covered:
 *   - Leaves: string, number, bigint, boolean, date, literal (string /
 *     number / boolean), enum, and primitive schemas wrapped in
 *     `.default()`.
 *   - Wrappers: `.optional()`, `.nullable()`.
 *   - Containers: array, tuple, record, union, object.
 *
 * Deliberately NOT generated (covered by targeted tests elsewhere):
 *   - Unsupported kinds (`z.promise` / `z.custom` / `z.templateLiteral`).
 *     These have dedicated throw-path tests in the adapter suites.
 *   - Discriminated unions. The cross-branch coordination required to
 *     produce a valid DU (unique discriminator literals on each branch)
 *     adds complexity without materially improving coverage — the DU
 *     path is exercised by `test/adapters/zod-v4/discriminator.test.ts`.
 *   - Refinements / effects. Generating a value that satisfies an
 *     arbitrary refinement is undecidable in general; lax-mode
 *     validation (which strips refinements) is what these arbitraries
 *     support.
 */

import { fc } from '@fast-check/vitest'

/**
 * Loosely typed to share a single factory between zod v3 (imported via the
 * `zod-v3` pnpm alias) and zod v4. The constructor method names match
 * between majors for the kinds we generate; the ZodType internal generics
 * are not compatible between majors, but we don't inspect those here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZNs = any

/** Arbitrary that produces a leaf zod schema (no containers, no wrappers). */
export function buildZodLeafArbitrary(z: ZNs): fc.Arbitrary<ZNs> {
  return fc.oneof(
    fc.constant(z.string()),
    fc.constant(z.number()),
    fc.constant(z.bigint()),
    fc.constant(z.boolean()),
    fc.constant(z.date()),
    // Literal primitives. The adapter's default-derivation returns the
    // literal value itself as the initial state, which must then
    // round-trip through validateAtPath — this kind stresses both paths
    // in lockstep.
    fc.oneof(
      fc.string({ minLength: 0, maxLength: 5 }).map((s) => z.literal(s)),
      fc.integer({ min: -1_000, max: 1_000 }).map((n) => z.literal(n)),
      fc.boolean().map((b) => z.literal(b))
    ),
    // Enum. uniqueArray guarantees distinct values, which zod requires.
    fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 })
      .map((arr) => z.enum(arr as [string, ...string[]])),
    // Primitive schemas with .default() — exercises the default-derivation
    // branch in initial-state.ts without requiring a container-shape
    // default (those would demand shape-matched arbitrary values, which
    // is overkill for this coverage).
    fc.string({ maxLength: 5 }).map((s) => z.string().default(s)),
    fc.integer({ min: -1_000, max: 1_000 }).map((n) => z.number().default(n)),
    fc.boolean().map((b) => z.boolean().default(b))
  )
}

/**
 * Arbitrary for any supported zod schema (leaf OR container) at bounded
 * depth. At depth 0 returns only leaves; each container/wrapper pass
 * consumes one unit of remaining depth budget.
 *
 * `makeRecord` is supplied by the caller because zod v3 and v4 diverge
 * on `z.record`'s signature: v4 requires both key and value types
 * (`z.record(z.string(), v)`), v3 accepts a single value type
 * (`z.record(v)`). The fuzz file passes the correct form.
 */
export function buildZodSchemaArbitrary(
  z: ZNs,
  depth: number,
  makeRecord: (inner: ZNs) => ZNs
): fc.Arbitrary<ZNs> {
  const leaves = buildZodLeafArbitrary(z)
  if (depth <= 0) return leaves

  const inner = buildZodSchemaArbitrary(z, depth - 1, makeRecord)

  return fc.oneof(
    leaves,
    inner.map((s) => s.optional()),
    inner.map((s) => s.nullable()),
    inner.map((s) => z.array(s)),
    fc.array(inner, { minLength: 1, maxLength: 3 }).map((items) => z.tuple(items)),
    inner.map(makeRecord),
    fc.array(inner, { minLength: 2, maxLength: 3 }).map((opts) => z.union(opts)),
    fc
      .dictionary(fc.string({ minLength: 1, maxLength: 6 }), inner, { minKeys: 1, maxKeys: 3 })
      .map((shape) => z.object(shape))
  )
}

/**
 * Root-level arbitrary: always a ZodObject (both adapters require a
 * ZodObject at the root, not a bare primitive or a union). `depth`
 * counts the maximum nesting below the root.
 */
export function buildZodRootObjectArbitrary(
  z: ZNs,
  depth: number,
  makeRecord: (inner: ZNs) => ZNs
): fc.Arbitrary<ZNs> {
  const inner = buildZodSchemaArbitrary(z, Math.max(0, depth - 1), makeRecord)
  return fc
    .dictionary(fc.string({ minLength: 1, maxLength: 6 }), inner, { minKeys: 1, maxKeys: 4 })
    .map((shape) => z.object(shape))
}
