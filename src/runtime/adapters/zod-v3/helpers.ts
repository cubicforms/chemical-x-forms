import type { z } from 'zod-v3'

// Map each schema type name to its Zod class (using broad generics for generality)
type ZodTypeMap = {
  ZodObject: z.AnyZodObject
  ZodDiscriminatedUnion: z.ZodDiscriminatedUnion<
    string,
    [z.ZodDiscriminatedUnionOption<string>, ...z.ZodDiscriminatedUnionOption<string>[]]
  >
  ZodArray: z.ZodArray<z.ZodTypeAny>
  ZodRecord: z.ZodRecord<z.ZodTypeAny, z.ZodTypeAny>
  ZodDefault: z.ZodDefault<z.ZodTypeAny>
  ZodOptional: z.ZodOptional<z.ZodTypeAny>
  ZodNullable: z.ZodNullable<z.ZodTypeAny>
  ZodType: z.ZodTypeAny // any Zod schema
  ZodEffects: z.ZodEffects<z.ZodTypeAny>
  ZodBoolean: z.ZodBoolean
  ZodEnum: z.ZodEnum<[string, ...string[]]>
  ZodNull: z.ZodNull
  ZodUndefined: z.ZodUndefined
  ZodLiteral: z.ZodLiteral<unknown>
  ZodUnion: z.ZodUnion<[z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]>
  ZodTuple: z.ZodTuple<[z.ZodTypeAny, ...z.ZodTypeAny[]]>
  ZodString: z.ZodString
  ZodNumber: z.ZodNumber
  ZodBigInt: z.ZodBigInt
  ZodDate: z.ZodDate
  // Newer wrappers (v3.23+ for Pipeline/Readonly; Branded/Catch
  // pre-existed). Use proper class generics so the predicate's
  // narrowing target is structurally distinct from the existing
  // entries — falling back to `z.ZodTypeAny` collapses TS's flow
  // analysis through later branches into `never`.
  ZodPipeline: z.ZodPipeline<z.ZodTypeAny, z.ZodTypeAny>
  ZodReadonly: z.ZodReadonly<z.ZodTypeAny>
  ZodBranded: z.ZodBranded<z.ZodTypeAny, string | number | symbol>
  ZodCatch: z.ZodCatch<z.ZodTypeAny>
}

/**
 * Type guard for a Zod v3 schema kind. Returns `true` when `schema`
 * is a Zod v3 instance of the named kind (`ZodString`, `ZodObject`,
 * etc.) and narrows the type accordingly.
 *
 * ```ts
 * if (isZodSchemaType(schema, 'ZodObject')) {
 *   // schema is now typed as z.AnyZodObject
 * }
 * ```
 *
 * Useful when building adapters or introspection helpers that branch
 * on schema shape. Most consumers don't need this.
 */
export function isZodSchemaType<K extends keyof ZodTypeMap>(
  schema: unknown,
  expectedType: K
): schema is ZodTypeMap[K] {
  if (typeof schema !== 'object' || schema === null) return false
  const maybeDef = (schema as { _def?: { typeName?: string } })._def
  return maybeDef?.typeName === expectedType
}
