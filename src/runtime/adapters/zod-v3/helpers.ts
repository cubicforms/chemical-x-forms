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
}

/**
 * Checks if `schema` is a Zod schema of the given `expectedType`.
 * Returns true if it matches, with a type predicate to narrow the schema type.
 */
export function isZodSchemaType<K extends keyof ZodTypeMap>(
  schema: unknown,
  expectedType: K
): schema is ZodTypeMap[K] {
  if (typeof schema !== 'object' || schema === null) return false
  const maybeDef = (schema as { _def?: { typeName?: string } })._def
  return maybeDef?.typeName === expectedType
}
