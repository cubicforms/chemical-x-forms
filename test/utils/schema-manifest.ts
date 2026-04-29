/**
 * Schema-with-manifest arbitrary for property-based tests of the
 * slim-primitive write gate.
 *
 * The "manifest" is a list of every leaf the generator emitted:
 * its canonical path AND the exact `Set<SlimPrimitiveKind>` we know
 * the schema accepts there. Tests assert against the manifest, NOT
 * against `adapter.getSlimPrimitiveTypesAtPath`, because the latter
 * is one of the things under test — using it as the oracle would
 * make the test pass even if both adapter and gate drifted in
 * lockstep.
 *
 * This module is loosely typed (`type ZNs = any`) so both v3 and v4
 * callers can pass their own `z` namespace, mirroring the pattern in
 * `./zod-arbitraries.ts`. The constructor surfaces we use
 * (`z.string`, `z.number`, `z.boolean`, `z.bigint`, `z.date`,
 * `z.literal`, `z.enum`, `.optional`, `.nullable`, `z.object`) match
 * across the major boundary.
 */
import { fc } from '@fast-check/vitest'
import type { Path } from '../../src/runtime/core/paths'
import type { SlimPrimitiveKind } from '../../src/runtime/types/types-api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZNs = any

export type LeafEntry = {
  /** Canonical path from the form root to the leaf. */
  path: Path
  /** Slim primitive kinds the schema accepts at this leaf, by construction. */
  acceptSet: Set<SlimPrimitiveKind>
}

export type SchemaWithManifest = {
  /** A `z.ZodObject` (root form schema). */
  schema: unknown
  /** Every primitive leaf the generator produced, with its accept set. */
  leaves: LeafEntry[]
}

/**
 * Object keys are restricted to alphanumeric + underscore so dotted
 * path strings round-trip through `setValue('a.b.c', value)` without
 * key-segment ambiguity. The slim-gate's downstream walker
 * (`canonicalizePath`) splits on `.`; keys containing `.` would split
 * into multiple segments and not match the manifest path.
 */
const objectKey = fc
  .string({ minLength: 1, maxLength: 4 })
  .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))

/**
 * One leaf shape: a `(z) => { schema, acceptSet }` factory paired
 * with the fast-check arbitrary that drives any random parameters
 * the leaf needs (literal value, enum members, default value).
 *
 * Each entry's `acceptSet` is the schema's slim-kind contract,
 * computed from the constructor we picked. They MUST match the
 * adapters' `getSlimPrimitiveTypesAtPath` output for the same
 * schema — the manifest sanity property catches drift.
 */
function leafBuilders(z: ZNs): fc.Arbitrary<{
  schema: unknown
  acceptSet: Set<SlimPrimitiveKind>
}>[] {
  return [
    fc.constant({ schema: z.string(), acceptSet: new Set<SlimPrimitiveKind>(['string']) }),
    fc.constant({ schema: z.number(), acceptSet: new Set<SlimPrimitiveKind>(['number']) }),
    fc.constant({ schema: z.boolean(), acceptSet: new Set<SlimPrimitiveKind>(['boolean']) }),
    fc.constant({ schema: z.bigint(), acceptSet: new Set<SlimPrimitiveKind>(['bigint']) }),
    fc.constant({ schema: z.date(), acceptSet: new Set<SlimPrimitiveKind>(['date']) }),
    // .optional() / .nullable() add 'undefined' / 'null' to the inner
    // accept set. Per the AbstractSchema contract docs at
    // src/runtime/types/types-api.ts:251-253.
    fc.constant({
      schema: z.string().optional(),
      acceptSet: new Set<SlimPrimitiveKind>(['string', 'undefined']),
    }),
    fc.constant({
      schema: z.number().optional(),
      acceptSet: new Set<SlimPrimitiveKind>(['number', 'undefined']),
    }),
    fc.constant({
      schema: z.string().nullable(),
      acceptSet: new Set<SlimPrimitiveKind>(['string', 'null']),
    }),
    fc.constant({
      schema: z.number().nullable(),
      acceptSet: new Set<SlimPrimitiveKind>(['number', 'null']),
    }),
    // Enums: string-only members, slim kind is 'string'. uniqueArray
    // because zod requires distinct enum members.
    fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 })
      .map((members) => ({
        schema: z.enum(members as [string, ...string[]]),
        acceptSet: new Set<SlimPrimitiveKind>(['string']),
      })),
    // Literals: per-kind. The slim-set is the literal's primitive kind.
    fc.string({ minLength: 0, maxLength: 5 }).map((s) => ({
      schema: z.literal(s),
      acceptSet: new Set<SlimPrimitiveKind>(['string']),
    })),
    fc.integer({ min: -1_000, max: 1_000 }).map((n) => ({
      schema: z.literal(n),
      acceptSet: new Set<SlimPrimitiveKind>(['number']),
    })),
    fc.boolean().map((b) => ({
      schema: z.literal(b),
      acceptSet: new Set<SlimPrimitiveKind>(['boolean']),
    })),
  ]
}

/**
 * A "node" is either a leaf (`{ schema, acceptSet }`, contributes one
 * manifest entry at the current path) or a nested object (recursively
 * expanded, contributes multiple entries below the current path).
 */
type Node = {
  /** A zod schema (leaf or `z.ZodObject`). */
  schema: unknown
  /** Manifest entries this node contributes, with paths RELATIVE to itself. */
  entries: LeafEntry[]
}

function buildNode(z: ZNs, depth: number): fc.Arbitrary<Node> {
  // Leaves at any depth — and at depth 0 they're the only option.
  const leafNode = fc.oneof(...leafBuilders(z)).map<Node>((leaf) => ({
    schema: leaf.schema,
    entries: [{ path: [], acceptSet: leaf.acceptSet }],
  }))
  if (depth <= 0) return leafNode

  // Recursive object container: 1–3 child keys, each carrying a
  // recursively-generated node. Child paths get prefixed with the
  // child's key.
  const objectNode = fc
    .uniqueArray(
      fc.tuple(objectKey, buildNode(z, depth - 1)),
      // Keys must be unique within a single z.object shape; uniqueArray
      // over the (key, node) pairs uses the key as the dedupe selector.
      { minLength: 1, maxLength: 3, selector: ([k]) => k }
    )
    .map<Node>((children) => {
      const shape: Record<string, unknown> = {}
      const entries: LeafEntry[] = []
      for (const [key, child] of children) {
        shape[key] = child.schema
        for (const sub of child.entries) {
          entries.push({ path: [key, ...sub.path], acceptSet: sub.acceptSet })
        }
      }
      return { schema: z.object(shape), entries }
    })

  return fc.oneof(leafNode, objectNode)
}

/**
 * Root arbitrary: always a `z.ZodObject` (form schemas must be).
 * `depth` counts the maximum nesting below the root.
 */
export function buildSchemaWithManifest(z: ZNs, depth: number): fc.Arbitrary<SchemaWithManifest> {
  return fc
    .uniqueArray(fc.tuple(objectKey, buildNode(z, Math.max(0, depth - 1))), {
      minLength: 1,
      maxLength: 4,
      selector: ([k]) => k,
    })
    .map<SchemaWithManifest>((children) => {
      const shape: Record<string, unknown> = {}
      const leaves: LeafEntry[] = []
      for (const [key, child] of children) {
        shape[key] = child.schema
        for (const sub of child.entries) {
          leaves.push({ path: [key, ...sub.path], acceptSet: sub.acceptSet })
        }
      }
      return { schema: z.object(shape), leaves }
    })
}

/**
 * Comparable slim-primitive kinds — the ones whose values can be
 * deep-equal-compared via `expect(...).toEqual(...)`. Excludes
 * `'symbol'` / `'function'` (incomparable) and `'object'` /
 * `'array'` / `'map'` / `'set'` (compound — out of v1 scope, the
 * gate's leaf-write semantic is what we're testing).
 */
export const COMPARABLE_KINDS = [
  'string',
  'number',
  'boolean',
  'bigint',
  'date',
  'null',
  'undefined',
] as const satisfies readonly SlimPrimitiveKind[]

export type ComparableKind = (typeof COMPARABLE_KINDS)[number]

/**
 * Arbitrary value of a given slim-primitive kind. Restricted to
 * "comparable" kinds (see `COMPARABLE_KINDS`).
 *
 * NaN is filtered out of the number arbitrary because `NaN === NaN`
 * is `false`, which would false-fail the "form value matches written
 * value" assertion.
 */
export function arbitraryValueOfKind(kind: ComparableKind): fc.Arbitrary<unknown> {
  switch (kind) {
    case 'string':
      return fc.string({ maxLength: 16 })
    case 'number':
      return fc.float({ noNaN: true })
    case 'boolean':
      return fc.boolean()
    case 'bigint':
      return fc.bigInt({ min: -1_000n, max: 1_000n })
    case 'date':
      // Constrain to representable ms range; fc.date() can produce
      // Invalid Date which compares unequal to itself.
      return fc.date({ noInvalidDate: true })
    case 'null':
      return fc.constant(null)
    case 'undefined':
      return fc.constant(undefined)
  }
}
