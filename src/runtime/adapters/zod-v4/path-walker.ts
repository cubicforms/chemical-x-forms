import type { z } from 'zod'
import {
  getArrayElement,
  getDiscriminatedOptions,
  getIntersectionLeft,
  getIntersectionRight,
  getObjectShape,
  getRecordValueType,
  getSetValueType,
  getTupleItems,
  getUnionOptions,
  kindOf,
  unwrapInner,
  unwrapLazy,
  unwrapPipe,
} from './introspect'

const PATH_SEPARATOR = '.'

/**
 * Walk a dotted path through a Zod schema tree and return the subschema(s)
 * that live at that path.
 *
 * - Unions return multiple candidates (caller tries each).
 * - Discriminated unions filter options to those whose shape contains the
 *   next segment, so a path into `{ status: 'error', message: string }`
 *   resolves only to the 'error' branch.
 * - Wrappers (optional/nullable/default/readonly/pipe) are transparent —
 *   the walker descends into the inner schema without consuming a path
 *   segment.
 * - Leaf types (string/number/literal/...) return `[]` when there's still
 *   path left, so a caller that asked for `firstName.middle` against a
 *   string schema gets an empty resolution rather than a wrong schema.
 */
export function getNestedZodSchemasAtPath(
  schema: z.ZodType,
  path: string | readonly (string | number)[]
): z.ZodType[] {
  if (Array.isArray(path)) return walkSegments(schema, path.map(String))
  const pathString = path as string
  if (pathString.length === 0) return [schema]
  return walkSegments(schema, pathString.split(PATH_SEPARATOR))
}

function walkSegments(schema: z.ZodType, segments: readonly string[]): z.ZodType[] {
  if (segments.length === 0) return [schema]
  const [head, ...rest] = segments
  if (head === undefined) return [schema]
  const kind = kindOf(schema)
  switch (kind) {
    case 'object': {
      const shape = getObjectShape(schema as z.ZodObject)
      // Own-property check: `shape` is a plain object whose prototype
      // is `Object.prototype`, so a bare `shape[head]` for `head ===
      // 'toString'` / `'valueOf'` / `'hasOwnProperty'` etc. returns the
      // inherited Function and the walker treats it as a schema. Filter
      // to OWN keys so unknown segments resolve to "doesn't exist."
      if (!Object.hasOwn(shape, head)) return []
      const next = shape[head]
      return next === undefined ? [] : walkSegments(next, rest)
    }
    case 'array':
      return walkSegments(getArrayElement(schema as z.ZodArray), rest)
    case 'set':
      // Sets aren't position-indexed, so the `head` segment is just a
      // synthetic indexer (`[...path, 0]`) used to query the element
      // type. We descend into the value schema and consume the segment.
      return walkSegments(getSetValueType(schema), rest)
    case 'record':
      return walkSegments(getRecordValueType(schema), rest)
    case 'tuple': {
      const index = Number(head)
      if (!Number.isInteger(index)) return []
      const items = getTupleItems(schema)
      const item = items[index]
      return item === undefined ? [] : walkSegments(item, rest)
    }
    case 'union':
      return getUnionOptions(schema).flatMap((opt) => walkSegments(opt, segments))
    case 'discriminated-union': {
      // Filter options whose shape contains this segment. Fallback: if no
      // option matches (e.g. the discriminator key itself), try every option.
      // `Object.hasOwn` (not `in`) so `Object.prototype` keys don't leak.
      const options = getDiscriminatedOptions(schema)
      const matching = options.filter((opt) => {
        const shape = getObjectShape(opt)
        return Object.hasOwn(shape, head)
      })
      const candidates = matching.length > 0 ? matching : options
      return candidates.flatMap((opt) => walkSegments(opt, segments))
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
    case 'catch': {
      // `catch` peels like a wrapper — descend into the inner schema.
      // The catch fallback only matters at parse time, not path lookup.
      const inner = unwrapInner(schema)
      return inner === undefined ? [] : walkSegments(inner, segments)
    }
    case 'pipe': {
      const inner = unwrapPipe(schema)
      return inner === undefined ? [] : walkSegments(inner, segments)
    }
    case 'lazy': {
      // Lazy transparently descends — `assertSupportedKinds` guarantees
      // the tree is finite before we get here.
      const inner = unwrapLazy(schema)
      return inner === undefined ? [] : walkSegments(inner, segments)
    }
    case 'intersection': {
      // Union of both sides' resolutions — callers try each candidate,
      // matching parse-time semantics where a value must satisfy both.
      const left = getIntersectionLeft(schema)
      const right = getIntersectionRight(schema)
      const leftResults = left === undefined ? [] : walkSegments(left, segments)
      const rightResults = right === undefined ? [] : walkSegments(right, segments)
      return [...leftResults, ...rightResults]
    }
    // Leaf types — can't descend further.
    case 'string':
    case 'number':
    case 'bigint':
    case 'boolean':
    case 'undefined':
    case 'null':
    case 'void':
    case 'never':
    case 'any':
    case 'unknown':
    case 'date':
    case 'enum':
    case 'literal':
    case 'nan':
    case 'promise':
    case 'custom':
    case 'template-literal':
      return []
  }
}
