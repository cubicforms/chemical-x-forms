import type { z } from 'zod-v3'

/**
 * The "read shape" of a Zod v3 schema — the type
 * `form.values.<path>` resolves to at runtime once defaults have
 * fired and synthesis has filled blank fields. Mirror of the Zod v4
 * `ReadShape` (see `src/runtime/adapters/zod-v4/types-read-shape.ts`
 * for the full rationale).
 *
 *  | Wrapper             | Key | Value at the key            |
 *  | ------------------- | --- | --------------------------- |
 *  | `ZodDefault<T>`     | req | `z.input<T>` (no undefined) |
 *  | `ZodOptional<T>`    | opt | `z.input<T> \| undefined`   |
 *  | `ZodNullable<T>`    | req | `z.input<T> \| null`        |
 *  | `ZodEffects<T>`     | req | `z.input<T>`                |
 *  | `ZodReadonly<T>`    | req | `z.input<T>`                |
 *  | `ZodCatch<T>`       | req | `z.input<T>`                |
 *  | nested `ZodObject`  | req | recursed read shape         |
 *  | nested `ZodArray`   | req | `Array<inner read shape>`   |
 *  | plain / fallthrough | req | `z.input<T>`                |
 *
 * `ZodEffects<T>` covers both `.transform()` and
 * `z.preprocess(fn, T)` in Zod v3 — at the TS level they share one
 * class. Peeling to `Inner` is correct for both: for `.transform()`
 * the inner IS the source schema (input matches existing behaviour),
 * and for `preprocess(fn, T)` the inner is `T` (peels through the
 * `unknown` preprocess input to the inner-schema input).
 *
 * Wrapper peeling is intentionally NOT chained through nested
 * descent — each conditional branch costs TS instantiation depth, and
 * v3's full wrapper set (Default / Optional / Nullable / Effects /
 * Pipeline / Readonly / Catch / Branded) combined with Object /
 * Array recursion hits the TS2589 ceiling. The static type sees a
 * one-level peel (the outer wrapper) followed by `z.input<Inner>`
 * for deeper paths. The runtime synthesis still resolves nested
 * defaults to concrete values; the type just stays at the input
 * shape for fields nested inside an array element or another
 * defaulted leaf. Most defaulted fields are top-level — the deeper
 * case is a documented edge.
 */
export type ReadShape<S> =
  S extends z.ZodObject<infer Shape>
    ? { [K in keyof Shape]: ReadShapeField<Shape[K]> }
    : ReadShapeField<S>

export type ReadShapeField<T> =
  T extends z.ZodDefault<infer Inner>
    ? ReadShapeInnerNoPeel<Inner>
    : T extends z.ZodCatch<infer Inner>
      ? ReadShapeInnerNoPeel<Inner>
      : T extends z.ZodReadonly<infer Inner>
        ? ReadShapeInnerNoPeel<Inner>
        : T extends z.ZodOptional<infer Inner>
          ? ReadShapeInnerNoPeel<Inner> | undefined
          : T extends z.ZodNullable<infer Inner>
            ? ReadShapeInnerNoPeel<Inner> | null
            : T extends z.ZodEffects<infer Inner>
              ? ReadShapeInnerNoPeel<Inner>
              : ReadShapeInnerNoPeel<T>

/**
 * One-level deeper resolution that descends into nested
 * `ZodObject` / `ZodArray` but does NOT re-enter the wrapper-peeling
 * chain. Keeps TS's instantiation depth bounded.
 */
type ReadShapeInnerNoPeel<T> =
  T extends z.ZodObject<infer Shape>
    ? { [K in keyof Shape]: ReadShapeField<Shape[K]> }
    : T extends z.ZodArray<infer Item>
      ? Array<ReadShapeField<Item>>
      : T extends z.ZodTypeAny
        ? z.input<T>
        : T
