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
 *  | `ZodDefault<T>`     | req | `z.input<T>` (no undefined) |
 *  | `ZodOptional<T>`    | opt | `z.input<T> \| undefined`   |
 *  | `ZodNullable<T>`    | req | `z.input<T> \| null`        |
 *  | `ZodPreprocess<T>`  | req | `z.input<T>` (peel cb→unknown)
 *  | plain wrapper / T   | req | `z.input<T>`                |
 *
 * Composes with `WriteShape<>` (primitive-literal widening) at the
 * `form.values` boundary: `ValuesSurface<WriteShape<ReadShape<S>>>`.
 *
 * Ingestion surfaces (`setValue`, `defaultValues`, `register` write
 * path) keep `z.input<S>` — those need to admit `undefined` for
 * defaulted fields and `unknown` for preprocess slots.
 */
export type ReadShape<S> =
  S extends z.ZodObject<infer Shape extends z.ZodRawShape>
    ? { [K in keyof Shape]: ReadShapeField<Shape[K]> }
    : ReadShapeField<S>

/**
 * Per-field resolution for {@link ReadShape}. Recurses into nested
 * `ZodObject` / `ZodArray`; peels wrappers per the policy table.
 */
export type ReadShapeField<T> =
  T extends z.ZodDefault<infer Inner>
    ? ReadShapeField<Inner>
    : T extends z.ZodPrefault<infer Inner>
      ? ReadShapeField<Inner>
      : T extends z.ZodCatch<infer Inner>
        ? ReadShapeField<Inner>
        : T extends z.ZodReadonly<infer Inner>
          ? ReadShapeField<Inner>
          : T extends z.ZodOptional<infer Inner>
            ? ReadShapeField<Inner> | undefined
            : T extends z.ZodNullable<infer Inner>
              ? ReadShapeField<Inner> | null
              : T extends z.ZodPreprocess<infer Inner>
                ? ReadShapeField<Inner>
                : T extends z.ZodObject<infer Shape extends z.ZodRawShape>
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
