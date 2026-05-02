import type { z } from 'zod'
import { UnsupportedSchemaError } from './errors'
import {
  getArrayElement,
  getDiscriminatedOptions,
  getIntersectionLeft,
  getIntersectionRight,
  getLazyGetter,
  getObjectShape,
  getRecordValueType,
  getSetValueType,
  getTupleItems,
  getUnionOptions,
  kindOf,
  unwrapInner,
  unwrapLazy,
  unwrapPipe,
  type ZodKind,
} from './introspect'

/**
 * Kinds the adapter does not implement. `z.promise(...)`, `z.custom(...)`,
 * and `z.templateLiteral(...)` can't be represented as form values
 * (Promise-valued fields have no meaningful initial state; custom
 * predicates have no derivable default; template-literal schemas parse
 * strings against a pattern that has no obvious "empty" form). The
 * adapter rejects them at construction so the failure surfaces at
 * `useForm(...)` rather than as a mystery `undefined` at render time.
 */
const UNSUPPORTED: readonly ZodKind[] = ['promise', 'custom', 'template-literal']

function labelPath(path: readonly string[]): string {
  return path.length === 0 ? '<root>' : path.join('.')
}

/**
 * Walk the schema tree and fail fast on unsupported kinds. Detects
 * recursive `z.lazy(...)` by tracking the *getter function identity*
 * of each lazy on the descent stack — a repeated getter means the
 * factory resolves back into itself (directly or through a detour).
 *
 * This runs once, at adapter construction time, so the cost is paid
 * at app startup rather than per keystroke.
 */
export function assertSupportedKinds(
  schema: z.ZodType,
  path: readonly string[] = [],
  lazyGetters: readonly (() => unknown)[] = []
): void {
  const kind = kindOf(schema)

  if (UNSUPPORTED.includes(kind)) {
    throw new UnsupportedSchemaError(
      `[@chemical-x/forms/zod] unsupported kind '${kind}' at '${labelPath(path)}'`
    )
  }

  switch (kind) {
    case 'object': {
      const shape = getObjectShape(schema as z.ZodObject)
      for (const [key, sub] of Object.entries(shape)) {
        assertSupportedKinds(sub, [...path, key], lazyGetters)
      }
      return
    }
    case 'array':
      assertSupportedKinds(getArrayElement(schema as z.ZodArray), [...path, '*'], lazyGetters)
      return
    case 'set':
      assertSupportedKinds(getSetValueType(schema), [...path, '*'], lazyGetters)
      return
    case 'record':
      assertSupportedKinds(getRecordValueType(schema), [...path, '*'], lazyGetters)
      return
    case 'tuple': {
      const items = getTupleItems(schema)
      items.forEach((item, i) => assertSupportedKinds(item, [...path, String(i)], lazyGetters))
      return
    }
    case 'union': {
      const options = getUnionOptions(schema)
      options.forEach((opt, i) => assertSupportedKinds(opt, [...path, `|${i}`], lazyGetters))
      return
    }
    case 'discriminated-union': {
      const options = getDiscriminatedOptions(schema)
      options.forEach((opt, i) => assertSupportedKinds(opt, [...path, `|${i}`], lazyGetters))
      return
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
    case 'catch': {
      const inner = unwrapInner(schema)
      if (inner !== undefined) assertSupportedKinds(inner, path, lazyGetters)
      return
    }
    case 'pipe': {
      const inner = unwrapPipe(schema)
      if (inner !== undefined) assertSupportedKinds(inner, path, lazyGetters)
      return
    }
    case 'lazy': {
      const getter = getLazyGetter(schema)
      if (getter !== undefined && lazyGetters.includes(getter)) {
        throw new UnsupportedSchemaError(
          `[@chemical-x/forms/zod] Recursive z.lazy() at '${labelPath(path)}'`
        )
      }
      const inner = unwrapLazy(schema)
      if (inner !== undefined) {
        assertSupportedKinds(
          inner,
          path,
          getter === undefined ? lazyGetters : [...lazyGetters, getter]
        )
      }
      return
    }
    case 'intersection': {
      const left = getIntersectionLeft(schema)
      const right = getIntersectionRight(schema)
      if (left !== undefined) assertSupportedKinds(left, [...path, 'left'], lazyGetters)
      if (right !== undefined) assertSupportedKinds(right, [...path, 'right'], lazyGetters)
      return
    }
    // Leaves: nothing to descend into.
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'date':
    case 'enum':
    case 'literal':
    case 'null':
    case 'undefined':
    case 'nan':
    case 'any':
    case 'unknown':
    case 'void':
    case 'never':
    case 'promise':
    case 'custom':
    case 'template-literal':
      return
  }
}
