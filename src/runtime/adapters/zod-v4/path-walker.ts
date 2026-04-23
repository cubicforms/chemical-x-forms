import type { z } from 'zod'
import {
  getArrayElement,
  getDiscriminatedOptions,
  getObjectShape,
  getRecordValueType,
  getTupleItems,
  getUnionOptions,
  kindOf,
  unwrapInner,
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
  path: string | readonly string[]
): z.ZodType[] {
  if (Array.isArray(path)) return walkSegments(schema, path)
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
      const next = shape[head]
      return next === undefined ? [] : walkSegments(next, rest)
    }
    case 'array':
      return walkSegments(getArrayElement(schema as z.ZodArray), rest)
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
      const options = getDiscriminatedOptions(schema)
      const matching = options.filter((opt) => {
        const shape = getObjectShape(opt)
        return head in shape
      })
      const candidates = matching.length > 0 ? matching : options
      return candidates.flatMap((opt) => walkSegments(opt, segments))
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly': {
      const inner = unwrapInner(schema)
      return inner === undefined ? [] : walkSegments(inner, segments)
    }
    case 'pipe': {
      const inner = unwrapPipe(schema)
      return inner === undefined ? [] : walkSegments(inner, segments)
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
      return []
  }
}
