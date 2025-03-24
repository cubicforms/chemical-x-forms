// import type { NestedType } from '@/utils/types'
import type { z } from 'zod'
import type { NestedType } from './types-core'

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

// typeName does in fact exist on ZodTypeAny
export interface ZodTypeWithInnerType extends z.ZodTypeAny {
  _def: {
    typeName: string
    innerType: z.ZodTypeAny
  }
}

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
