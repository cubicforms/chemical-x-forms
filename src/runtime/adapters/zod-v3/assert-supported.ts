import type { z } from 'zod-v3'
import { UnsupportedSchemaError } from './errors'
import { isZodSchemaType } from './helpers'

/**
 * Kinds the v3 adapter does not implement. `z.promise(...)`,
 * `z.function(...)`, `z.map(...)`, and `z.symbol()` can't be
 * represented as form values (Promise/function-valued fields have no
 * meaningful initial state; Maps have no obvious form representation;
 * symbols aren't JSON-serialisable so persistence and SSR round-trip
 * would silently drop them). The adapter rejects them at construction
 * so the failure surfaces at `useForm(...)` rather than as a mystery
 * `null` at render time. Mirrors v4's `UNSUPPORTED` set with the
 * v3-only additions (`function` / `map` / `symbol`); v4's
 * `template-literal` / `custom` aren't kinds in zod-v3.
 */
const UNSUPPORTED_TYPE_NAMES = new Set(['ZodPromise', 'ZodFunction', 'ZodMap', 'ZodSymbol'])

function labelPath(path: readonly string[]): string {
  return path.length === 0 ? '<root>' : path.join('.')
}

function getTypeName(schema: z.ZodTypeAny): string | undefined {
  const def = (schema as { _def?: { typeName?: string } })._def
  return def?.typeName
}

/**
 * Walk the schema tree and fail fast on unsupported kinds. Detects
 * recursive `z.lazy(...)` by tracking the *getter function identity*
 * of each lazy on the descent stack — a repeated getter means the
 * factory resolves back into itself (directly or through a detour).
 *
 * This runs once, at adapter construction time, so the cost is paid
 * at app startup rather than per keystroke. Mirrors v4's
 * `assertSupportedKinds`; the dispatch goes through `isZodSchemaType`
 * (typeName comparison) instead of the v4 `kindOf` helper because v3
 * doesn't have an equivalent introspect layer.
 */
export function assertSupportedKinds(
  schema: z.ZodTypeAny,
  path: readonly string[] = [],
  lazyGetters: readonly (() => unknown)[] = []
): void {
  const typeName = getTypeName(schema)
  if (typeName !== undefined && UNSUPPORTED_TYPE_NAMES.has(typeName)) {
    throw new UnsupportedSchemaError(
      `[attaform/zod-v3] unsupported kind '${typeName}' at '${labelPath(path)}'`
    )
  }

  if (isZodSchemaType(schema, 'ZodObject')) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>
    for (const [key, sub] of Object.entries(shape)) {
      assertSupportedKinds(sub, [...path, key], lazyGetters)
    }
    return
  }

  if (isZodSchemaType(schema, 'ZodArray')) {
    const inner = (schema._def as { type?: z.ZodTypeAny }).type
    if (inner) assertSupportedKinds(inner, [...path, '*'], lazyGetters)
    return
  }

  if (isZodSchemaType(schema, 'ZodSet')) {
    const inner = (schema._def as { valueType?: z.ZodTypeAny }).valueType
    if (inner) assertSupportedKinds(inner, [...path, '*'], lazyGetters)
    return
  }

  if (isZodSchemaType(schema, 'ZodRecord')) {
    const inner = (schema._def as { valueType?: z.ZodTypeAny }).valueType
    if (inner) assertSupportedKinds(inner, [...path, '*'], lazyGetters)
    return
  }

  if (isZodSchemaType(schema, 'ZodTuple')) {
    const items = (schema._def as { items?: z.ZodTypeAny[] }).items ?? []
    items.forEach((item, i) => assertSupportedKinds(item, [...path, String(i)], lazyGetters))
    return
  }

  if (isZodSchemaType(schema, 'ZodUnion')) {
    const options = (schema._def as { options?: z.ZodTypeAny[] }).options ?? []
    options.forEach((opt, i) => assertSupportedKinds(opt, [...path, `|${i}`], lazyGetters))
    return
  }

  if (isZodSchemaType(schema, 'ZodDiscriminatedUnion')) {
    const options = (schema._def as { options?: z.ZodTypeAny[] }).options ?? []
    options.forEach((opt, i) => assertSupportedKinds(opt, [...path, `|${i}`], lazyGetters))
    return
  }

  if (isZodSchemaType(schema, 'ZodIntersection')) {
    const def = schema._def as { left?: z.ZodTypeAny; right?: z.ZodTypeAny }
    if (def.left) assertSupportedKinds(def.left, [...path, 'left'], lazyGetters)
    if (def.right) assertSupportedKinds(def.right, [...path, 'right'], lazyGetters)
    return
  }

  if (
    isZodSchemaType(schema, 'ZodOptional') ||
    isZodSchemaType(schema, 'ZodNullable') ||
    isZodSchemaType(schema, 'ZodDefault') ||
    isZodSchemaType(schema, 'ZodReadonly') ||
    isZodSchemaType(schema, 'ZodCatch') ||
    isZodSchemaType(schema, 'ZodBranded')
  ) {
    const inner =
      (schema._def as { innerType?: z.ZodTypeAny }).innerType ??
      (schema._def as { type?: z.ZodTypeAny }).type
    if (inner) assertSupportedKinds(inner, path, lazyGetters)
    return
  }

  if (isZodSchemaType(schema, 'ZodEffects')) {
    const inner = schema.innerType()
    assertSupportedKinds(inner, path, lazyGetters)
    return
  }

  if (isZodSchemaType(schema, 'ZodPipeline')) {
    const inner = (schema._def as { in?: z.ZodTypeAny }).in
    if (inner) assertSupportedKinds(inner, path, lazyGetters)
    return
  }

  if (isZodSchemaType(schema, 'ZodLazy')) {
    const getter = (schema._def as { getter?: () => z.ZodTypeAny }).getter
    if (getter !== undefined && lazyGetters.includes(getter)) {
      throw new UnsupportedSchemaError(
        `[attaform/zod-v3] Recursive z.lazy() at '${labelPath(path)}'`
      )
    }
    const inner = getter?.()
    if (inner !== undefined) {
      assertSupportedKinds(
        inner,
        path,
        getter === undefined ? lazyGetters : [...lazyGetters, getter]
      )
    }
    return
  }

  // Leaves: nothing to descend into. Includes ZodString, ZodNumber,
  // ZodBigInt, ZodBoolean, ZodDate, ZodNull, ZodUndefined, ZodAny,
  // ZodUnknown, ZodNever, ZodVoid, ZodLiteral, ZodEnum, ZodNativeEnum,
  // ZodNaN. Plus the unsupported leaves (already rejected above).
}
