import type { z } from 'zod-v3'
import type {
  FormKey,
  HistoryConfig,
  OnInvalidSubmitPolicy,
  PersistConfig,
  ValidateOnConfig,
  ValidationMode,
} from '../../types/types-api'

/**
 * Configuration object for the Zod v3 `useForm` overload. Same
 * shape as the schema-agnostic `UseFormConfiguration`, but with
 * `schema` constrained to a `z.ZodObject` (or wrapped form).
 */
export type UseFormConfigurationWithZod<
  Schema extends z.ZodType<unknown>,
  DefaultValues,
> = ValidateOnConfig & {
  /** A Zod v3 `ZodObject` schema (or one wrapped in `.optional()` / `.nullable()` / `.default()` / `.refine()`). */
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
  persist?: PersistConfig
  history?: HistoryConfig
}

/**
 * Peel `.optional()` / `.nullable()` / `.default()` / `.refine()` /
 * `.transform()` wrappers off a Zod v3 schema to reach the inner
 * `ZodObject`. Returns `never` if no `ZodObject` is found.
 *
 * Used internally by the v3 `useForm` overload to verify the
 * supplied schema bottoms out at a `ZodObject`.
 */
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
