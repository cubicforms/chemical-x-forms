import type { z } from 'zod-v3'
import type {
  FieldValidationConfig,
  FormKey,
  HistoryConfig,
  OnInvalidSubmitPolicy,
  PersistConfig,
  ValidationMode,
} from '../../types/types-api'

export type UseFormConfigurationWithZod<Schema extends z.ZodType<unknown>, DefaultValues> = {
  schema: Schema extends z.ZodType<unknown>
    ? UnwrapZodObject<Schema> extends z.ZodObject<z.ZodRawShape>
      ? Schema
      : never
    : never
  // Optional — matches the core `UseFormConfiguration`. Omit for
  // one-off forms; pass a string when the form needs identity (shared
  // state, distant lookup, persistence default, DevTools label). See
  // types-api.ts for the full rationale.
  key?: FormKey
  defaultValues?: DefaultValues
  validationMode?: ValidationMode
  onInvalidSubmit?: OnInvalidSubmitPolicy
  fieldValidation?: FieldValidationConfig
  persist?: PersistConfig
  history?: HistoryConfig
}

// Recursively unwraps Zod types like ZodDefault, ZodOptional, ZodNullable, etc.
export type UnwrapZodObject<T> =
  T extends z.ZodEffects<infer Inner>
    ? UnwrapZodObject<Inner>
    : T extends z.ZodOptional<infer Inner>
      ? UnwrapZodObject<Inner>
      : T extends z.ZodNullable<infer Inner>
        ? UnwrapZodObject<Inner>
        : T extends z.ZodDefault<infer Inner>
          ? UnwrapZodObject<Inner>
          : T extends z.ZodObject<infer Shape>
            ? z.ZodObject<Shape>
            : never
