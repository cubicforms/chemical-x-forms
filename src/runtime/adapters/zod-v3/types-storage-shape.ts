import type { z } from 'zod-v3'

/**
 * v3 mirror of the Zod v4 `StorageShape`. Per top-level key, default
 * to `z.output<Shape[K]>` (the post-init view — defaults have fired,
 * Zod's own recursion peels nested defaults inside structural
 * containers); fall back to `z.input<Shape[K]>` for transform / pipe
 * carriers (`ZodEffects`, `ZodPipeline`) where storage holds the
 * pre-transform input — transforms only run at submission /
 * validation, not at the write boundary.
 *
 * v3 quirk: `ZodEffects` covers BOTH `.transform()` and
 * `z.preprocess()` at the TS level — v3 doesn't carry a separate
 * preprocess class the way v4 does. Deferring to `z.input` for
 * `ZodEffects` means a top-level `z.preprocess(fn, T)` leaf reads as
 * the preprocess input (commonly `unknown`); reach for the
 * `AbstractSchema` escape hatch if a stronger type is needed.
 * Transforms preserve their pre-transform input shape, which matches
 * storage.
 */
export type StorageShape<S extends z.ZodTypeAny> =
  S extends z.ZodObject<infer Shape>
    ? {
        [K in keyof Shape]-?: Shape[K] extends
          | z.ZodEffects<z.ZodTypeAny>
          | z.ZodPipeline<z.ZodTypeAny, z.ZodTypeAny>
          ? z.input<Shape[K]>
          : z.output<Shape[K]>
      }
    : z.input<S>
