import type { z } from "zod"
import type { FormKey, ValidationMode } from "./types-api"
import type { DeepPartial, GenericForm } from "./types-core"

export type UseFormConfigurationWithZod<
  Schema extends z.ZodType<unknown>,
  Form extends GenericForm,
  InitialState extends DeepPartial<Form>,
> = {
  schema: Schema extends z.ZodType<unknown>
    ? UnwrapZodObject<Schema> extends z.ZodObject<z.ZodRawShape>
      ? Schema
      : never
    : never
  key?: FormKey
  initialState?: InitialState
  validationMode?: ValidationMode
}

// Recursively unwraps Zod types like ZodDefault, ZodOptional, ZodNullable, etc.
export type UnwrapZodObject<T> =
  T extends z.ZodEffects<infer Inner> ? UnwrapZodObject<Inner> :
    T extends z.ZodOptional<infer Inner> ? UnwrapZodObject<Inner> :
      T extends z.ZodNullable<infer Inner> ? UnwrapZodObject<Inner> :
        T extends z.ZodDefault<infer Inner> ? UnwrapZodObject<Inner> :
          T extends z.ZodObject<infer Shape> ? z.ZodObject<Shape> :
            never
