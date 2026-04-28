// import type { NestedType } from '@/utils/types'
import type { z } from 'zod-v3'
import type { NestedType } from '../../types/types-core'

// Given potentially wrapped schema type, get deeply wrapped schema matching Zod type
export type UnwrapZodSchemaToAccessTargetSchemaType<
  Subject extends z.ZodTypeAny,
  Target extends z.ZodTypeAny,
> = Subject extends Target
  ? Subject
  : Subject extends z.ZodNullable<infer Child>
    ? UnwrapZodSchemaToAccessTargetSchemaType<Child, Target>
    : Subject extends z.ZodOptional<infer Child>
      ? UnwrapZodSchemaToAccessTargetSchemaType<Child, Target>
      : Subject extends z.ZodDefault<infer Child>
        ? UnwrapZodSchemaToAccessTargetSchemaType<Child, Target>
        : Subject extends z.ZodEffects<infer Child>
          ? UnwrapZodSchemaToAccessTargetSchemaType<Child, Target>
          : never

// This explicitly defines the Zod classes that can wrap the subject schema
export type PossiblyWrappedZodSchema<
  Subject extends z.ZodTypeAny,
  Target extends z.ZodTypeAny,
> = Subject extends Target
  ? Subject
  : Subject extends z.ZodNullable<infer NextChild>
    ? z.ZodNullable<PossiblyWrappedZodSchema<NextChild, Target>>
    : Subject extends z.ZodOptional<infer NextChild>
      ? z.ZodOptional<PossiblyWrappedZodSchema<NextChild, Target>>
      : Subject extends z.ZodDefault<infer NextChild>
        ? z.ZodDefault<PossiblyWrappedZodSchema<NextChild, Target>>
        : Subject extends z.ZodEffects<infer NextChild>
          ? z.ZodEffects<PossiblyWrappedZodSchema<NextChild, Target>>
          : never

/**
 * Narrow accessor type for Zod v3's internal `_def`. Only useful
 * when writing a custom adapter that needs to read internals
 * directly. Most consumers should never reach for this.
 */
export interface ZodTypeWithInnerType extends z.ZodTypeAny {
  _def: {
    typeName: string
    innerType: z.ZodTypeAny
  }
}

/**
 * The "honest read shape" of a Zod v3 schema — fields under records,
 * arrays, and dynamic boundaries are tagged optional/undefined to
 * reflect the runtime reality that those slots may be missing.
 *
 * Used internally by the v3 adapter as the read-side type for
 * `getValue` / `getFieldState`. Not commonly needed in consumer code.
 */
export type TypeWithNullableDynamicKeys<
  Schema extends z.ZodSchema,
  CrossedBoundary extends boolean = false,
> =
  // Handle ZodRecord
  Schema extends z.ZodRecord<
    infer KeySchema extends z.ZodTypeAny,
    infer ValueSchema extends z.ZodTypeAny
  >
    ? {
        [Key in z.infer<KeySchema>]?: TypeWithNullableDynamicKeys<ValueSchema, true>
      }
    : // Handle ZodArray
      Schema extends z.ZodArray<infer ItemSchema extends z.ZodTypeAny>
      ? (TypeWithNullableDynamicKeys<ItemSchema, true> | undefined)[]
      : // Handle ZodObject
        Schema extends z.ZodObject<infer Shape>
        ? {
            [Key in keyof Shape]:
              | TypeWithNullableDynamicKeys<Shape[Key], CrossedBoundary>
              | (CrossedBoundary extends true ? undefined : never)
          }
        : // Handle ZodDiscriminatedUnion
          Schema extends z.ZodDiscriminatedUnion<string, infer Options>
          ? {
              [Key in keyof Options]: TypeWithNullableDynamicKeys<Options[Key], true>
            }[keyof Options & number]
          : // Fallback to z.infer for all other schemas
              z.infer<Schema> | (CrossedBoundary extends true ? undefined : never)

export type GetValueReturnTypeFromZodSchema<
  Schema extends z.ZodSchema,
  FlattenedPath extends string,
> = NestedType<TypeWithNullableDynamicKeys<Schema>, FlattenedPath>
