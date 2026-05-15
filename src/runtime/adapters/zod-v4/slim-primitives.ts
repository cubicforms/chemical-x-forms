/**
 * Slim-primitive walker for the zod-v4 adapter. Returns the set of
 * `SlimPrimitiveKind`s a schema accepts at write time — wrappers are
 * peeled, refinement-level constraints (`.email()`, `.min(N)`, enum
 * membership, literal equality, regex) are ignored.
 *
 * The runtime gate (`src/runtime/core/slim-primitive-gate.ts`) calls
 * the adapter method `getSlimPrimitiveTypesAtPath(path)`, which
 * resolves leaf candidates via `getNestedZodSchemasAtPath` and unions
 * `slimPrimitivesOf` across them.
 */
import type { z } from 'zod'
import type { SlimPrimitiveKind } from '../../types/types-api'
import {
  getEnumValues,
  getIntersectionLeft,
  getIntersectionRight,
  getLiteralValues,
  getUnionOptions,
  kindOf,
  unwrapInner,
  unwrapLazy,
  unwrapPipe,
} from './introspect'

export const PERMISSIVE: ReadonlySet<SlimPrimitiveKind> =
  /* @__PURE__ */ new Set<SlimPrimitiveKind>([
    'string',
    'number',
    'boolean',
    'bigint',
    'date',
    'null',
    'undefined',
    'object',
    'array',
    'symbol',
    'function',
    'map',
    'set',
    'file',
  ])

// Module-level frozen singletons for the leaf branches. Returning a
// shared instance instead of `new Set([…])` per call cuts a hot
// allocation when slim-primitives is reached through wrappers, and
// collapses the inline literal Set constructions into shared
// references for a small bundle-size win. `walk()` returns
// `ReadonlySet`; callers that need to mutate (optional/nullable/union
// branches, and the public `slimPrimitivesOf` boundary) clone first.
const KIND_STRING: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['string'])
const KIND_NUMBER: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['number'])
const KIND_BOOLEAN: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['boolean'])
const KIND_BIGINT: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['bigint'])
const KIND_DATE: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['date'])
const KIND_NULL: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['null'])
const KIND_UNDEFINED: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['undefined'])
const KIND_OBJECT: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['object'])
const KIND_ARRAY: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['array'])
const KIND_SET: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['set'])
const KIND_FILE: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set(['file', 'null'])
const EMPTY_KINDS: ReadonlySet<SlimPrimitiveKind> = /* @__PURE__ */ new Set()

/**
 * Walk a schema, emitting the union of slim primitive kinds it
 * accepts. Wrappers descend into their inner schema; unions union
 * their branches; intersections intersect; lazy resolves through;
 * pipe takes the input side.
 *
 * Returns an empty set ONLY for `z.never()` — every other kind we
 * understand emits at least one entry. Unknown kinds (lazy with a
 * recursive cycle, custom z-types we don't recognise) return the
 * permissive set so the runtime gate doesn't reject legitimate
 * writes against shapes we can't introspect.
 *
 * `maxRecursionDepth` caps descent through `z.lazy()`: the counter
 * bumps only when the walker crosses a lazy boundary, so wrapper
 * stacks (`.optional().nullable()`) and union branches don't burn
 * the budget. Past the cap, the walker returns the permissive set
 * so writes at recursive paths beyond the cap aren't false-rejected.
 */
export function slimPrimitivesOf(
  schema: z.ZodType,
  maxRecursionDepth: number
): Set<SlimPrimitiveKind> {
  // Clone once at the public boundary so callers get a fresh mutable
  // Set. The internal walk reuses frozen singletons for leaf kinds.
  return new Set(walk(schema, 0, maxRecursionDepth))
}

function walk(
  schema: z.ZodType,
  lazyDepth: number,
  maxDepth: number
): ReadonlySet<SlimPrimitiveKind> {
  const kind = kindOf(schema)
  switch (kind) {
    case 'string':
      return KIND_STRING
    case 'number':
    case 'nan':
      return KIND_NUMBER
    case 'boolean':
      return KIND_BOOLEAN
    case 'bigint':
      return KIND_BIGINT
    case 'date':
      return KIND_DATE
    case 'file':
      // `z.file()` accepts `File` instances at write time. `null` is
      // also accepted at the slim-primitive level so the directive's
      // canonical blank value (the "no file selected" sentinel) lands
      // even on required-file schemas — the blank-path channel + the
      // derived "No value supplied" error already gates submission, so
      // permitting `null` storage here doesn't loosen schema enforcement.
      //
      // The set's lack of container kinds (`object` / `array` / `map`
      // / `set`) makes the path a leaf via `isLeafAtPath`, so
      // `form.fields.<file-path>` returns a FieldState rather than
      // descending into the File's own keys.
      return KIND_FILE
    case 'null':
      return KIND_NULL
    case 'undefined':
    case 'void':
      return KIND_UNDEFINED
    case 'enum': {
      // Enums in v4 may be string- or number-valued; walk entries.
      const values = getEnumValues(schema)
      const out = new Set<SlimPrimitiveKind>()
      for (const v of values) {
        if (typeof v === 'string') out.add('string')
        else if (typeof v === 'number') out.add('number')
      }
      return out.size === 0 ? KIND_STRING : out
    }
    case 'literal': {
      const values = getLiteralValues(schema)
      const out = new Set<SlimPrimitiveKind>()
      for (const v of values) out.add(slimKindOfRaw(v))
      return out.size === 0 ? PERMISSIVE : out
    }
    case 'object':
    case 'record':
      return KIND_OBJECT
    case 'array':
    case 'tuple':
      return KIND_ARRAY
    case 'set':
      return KIND_SET
    case 'optional': {
      const inner = unwrapInner(schema)
      const innerSet = inner === undefined ? EMPTY_KINDS : walk(inner, lazyDepth, maxDepth)
      const out = new Set<SlimPrimitiveKind>(innerSet)
      out.add('undefined')
      return out
    }
    case 'nullable': {
      const inner = unwrapInner(schema)
      const innerSet = inner === undefined ? EMPTY_KINDS : walk(inner, lazyDepth, maxDepth)
      const out = new Set<SlimPrimitiveKind>(innerSet)
      out.add('null')
      return out
    }
    case 'default':
    case 'readonly':
    case 'catch': {
      const inner = unwrapInner(schema)
      return inner === undefined ? PERMISSIVE : walk(inner, lazyDepth, maxDepth)
    }
    case 'pipe': {
      // Use the INPUT side: writes are pre-transform values.
      const inner = unwrapPipe(schema)
      return inner === undefined ? PERMISSIVE : walk(inner, lazyDepth, maxDepth)
    }
    case 'lazy': {
      // Bump on lazy crossing only; past the cap, fall back to
      // permissive so recursive paths beyond the cap aren't gated.
      if (lazyDepth >= maxDepth) return PERMISSIVE
      const inner = unwrapLazy(schema)
      return inner === undefined ? PERMISSIVE : walk(inner, lazyDepth + 1, maxDepth)
    }
    case 'union':
    case 'discriminated-union': {
      const options = getUnionOptions(schema)
      const out = new Set<SlimPrimitiveKind>()
      for (const opt of options) {
        for (const k of walk(opt as z.ZodType, lazyDepth, maxDepth)) out.add(k)
      }
      return out.size === 0 ? PERMISSIVE : out
    }
    case 'intersection': {
      const left = getIntersectionLeft(schema)
      const right = getIntersectionRight(schema)
      const leftSet = left === undefined ? PERMISSIVE : walk(left, lazyDepth, maxDepth)
      const rightSet = right === undefined ? PERMISSIVE : walk(right, lazyDepth, maxDepth)
      const out = new Set<SlimPrimitiveKind>()
      for (const k of leftSet) if (rightSet.has(k)) out.add(k)
      return out
    }
    case 'never':
      return EMPTY_KINDS
    case 'any':
    case 'unknown':
      return PERMISSIVE
    // Kinds we don't understand at the slim level: be permissive to
    // avoid false-rejecting legitimate writes against schema shapes
    // we haven't characterised.
    case 'promise':
    case 'custom':
    case 'template-literal':
    case 'transform':
      return PERMISSIVE
    default:
      return PERMISSIVE
  }
}

function slimKindOfRaw(value: unknown): SlimPrimitiveKind {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  const t = typeof value
  switch (t) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'bigint':
      return 'bigint'
    case 'symbol':
      return 'symbol'
    case 'undefined':
      return 'undefined'
    case 'object':
      return 'object'
    case 'function':
      return 'function'
    default:
      return 'object'
  }
}
