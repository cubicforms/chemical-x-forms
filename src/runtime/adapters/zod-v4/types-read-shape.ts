import type { z } from 'zod'

/**
 * The "read shape" of a Zod v4 schema — the type `form.values.<path>`
 * resolves to at runtime once defaults have fired and synthesis has
 * filled blank fields.
 *
 * Why this exists: `z.input<Schema>` answers "what may be passed at
 * the ingestion boundary," which is fundamentally permissive — an
 * object field wrapped in `.default()` shows up as a KEY-OPTIONAL
 * property, so under `exactOptionalPropertyTypes: true` direct access
 * resolves to `T | undefined`. The runtime never holds that
 * `undefined`: storage init fires defaults, blank-path synthesis
 * fills required leaves with falsy concrete, and only genuinely
 * optional / nullable wrappers leave a slot empty.
 *
 * `ReadShape<S>` rebuilds the object type from the schema's `Shape`
 * (not from `z.input<S>`), so per-field key-presence becomes a
 * library decision driven by which wrapper class is in the field:
 *
 *  | Wrapper             | Key | Value at the key            |
 *  | ------------------- | --- | --------------------------- |
 *  | `ZodDefault<T>`     | req | inner read shape            |
 *  | `ZodPrefault<T>`    | req | inner read shape            |
 *  | `ZodCatch<T>`       | req | inner read shape            |
 *  | `ZodReadonly<T>`    | req | inner read shape            |
 *  | `ZodOptional<T>`    | opt | inner read shape \| undef   |
 *  | `ZodNullable<T>`    | req | inner read shape \| null    |
 *  | `ZodPreprocess<T>`  | req | inner read shape            |
 *  | nested `ZodObject`  | req | recursed read shape         |
 *  | nested `ZodArray`   | req | `Array<inner read shape>`   |
 *  | plain / fallthrough | req | `z.input<T>`                |
 *
 * Wrapper peeling is intentionally NOT chained through nested
 * descent — each conditional branch costs TS instantiation depth, and
 * v4's full wrapper set (Default / Prefault / Catch / Readonly /
 * Optional / Nullable / Preprocess) combined with Object / Array /
 * Tuple / Record / DiscriminatedUnion recursion hits the TS2589
 * ceiling for any non-trivial schema (two discriminated unions plus
 * a few nested objects is enough, e.g. a multi-step booking form).
 *
 * The two-pass split keeps the type bounded: the outer pass peels at
 * most one wrapper; the inner pass does structural descent (object /
 * array / tuple / record / discriminated-union) and restarts the peel
 * chain at the boundary so nested wrappers still work for the common
 * cases. Deeper wrapper chains nested INSIDE another wrapper (e.g.
 * `.optional().default(...)` whose inner is itself wrapped) fall
 * through to `z.input<Inner>` — the runtime still resolves nested
 * defaults to concrete values; the type just stays at the input
 * shape. Most defaulted fields are top-level inside an object; the
 * deeper case is a documented edge.
 *
 * Mirrors the v3 read-shape (see
 * `src/runtime/adapters/zod-v3/types-read-shape.ts`).
 */
export type ReadShape<S> =
  S extends z.ZodObject<infer Shape extends z.ZodRawShape>
    ? { [K in keyof Shape]: ReadShapeField<Shape[K]> }
    : ReadShapeField<S>

/**
 * Outer pass — peels at most one wrapper, then hands off to the
 * structural descent. Does NOT re-enter the wrapper-peel chain on
 * the inner schema; that's `ReadShapeInner`'s job.
 */
export type ReadShapeField<T> =
  T extends z.ZodDefault<infer Inner>
    ? ReadShapeInner<Inner>
    : T extends z.ZodPrefault<infer Inner>
      ? ReadShapeInner<Inner>
      : T extends z.ZodCatch<infer Inner>
        ? ReadShapeInner<Inner>
        : T extends z.ZodReadonly<infer Inner>
          ? ReadShapeInner<Inner>
          : T extends z.ZodOptional<infer Inner>
            ? ReadShapeInner<Inner> | undefined
            : T extends z.ZodNullable<infer Inner>
              ? ReadShapeInner<Inner> | null
              : T extends z.ZodPreprocess<infer Inner>
                ? ReadShapeInner<Inner>
                : ReadShapeInner<T>

/**
 * Inner pass — structural descent into containers without re-entering
 * the wrapper-peel chain. Object / array / tuple / record /
 * discriminated-union recurse by handing each child back to
 * {@link ReadShapeField}, so per-field wrappers still get one level
 * of peeling at the boundary. Plain schemas (and any wrapped schema
 * the inner pass doesn't recognise) fall through to `z.input<T>`.
 */
type ReadShapeInner<T> =
  T extends z.ZodObject<infer Shape extends z.ZodRawShape>
    ? { [K in keyof Shape]: ReadShapeField<Shape[K]> }
    : T extends z.ZodArray<infer Item>
      ? Array<ReadShapeField<Item>>
      : T extends z.ZodTuple<infer Items>
        ? { -readonly [K in keyof Items]: ReadShapeField<Items[K]> }
        : T extends z.ZodRecord<infer _Key, infer Value>
          ? Record<string, ReadShapeField<Value>>
          : T extends z.ZodDiscriminatedUnion<infer Options, string>
            ? Options extends ReadonlyArray<infer Opt>
              ? Opt extends z.ZodType
                ? ReadShapeField<Opt>
                : never
              : never
            : T extends z.ZodType
              ? z.input<T>
              : T
