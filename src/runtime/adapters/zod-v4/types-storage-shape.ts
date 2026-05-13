/**
 * The shape `form.values.<key>` returns at runtime.
 *
 * Per top-level key:
 *
 * 1. `z.preprocess(fn, inner)` — compiles to `ZodPipe<ZodTransform, inner>`.
 *    The preprocess fn fires at the write boundary (synthesized into
 *    `setValue`), so storage holds the INNER schema's input — i.e. the
 *    pipe's output. Read `_zod.output`.
 *
 * 2. `inner.transform(fn)` — compiles to `ZodPipe<inner, ZodTransform>`.
 *    Transforms fire at submit / validate time, NOT at the write
 *    boundary, so storage holds the PRE-transform input — i.e. the
 *    pipe's input. Read `_zod.input`. A bare top-level `ZodTransform`
 *    (no `in` schema) gets the same treatment.
 *
 * 3. Everything else (defaults, catch, readonly, optional, plain
 *    primitives, nested objects) — read `_zod.output`. Defaults and
 *    catches fire at parse time, so the post-init view is what storage
 *    holds. For nested objects this delegates to Zod's recursion,
 *    which peels nested defaults inside structural containers.
 *
 * Implementation note: direct `_zod` property access mirrors Zod's
 * own `$InferObjectOutput` / `$InferObjectInput`, which read
 * `T[k]['_zod']['output']` / `T[k]['_zod']['input']` directly rather
 * than wrapping in the top-level `output<T>` / `input<T>` conditional.
 * Wrapping per key spawns a fresh conditional instantiation for every
 * key; Volar's web-worker checker collapses that per-key walk to
 * `any` once the schema is non-trivial. Property access has no
 * conditional and resolves cleanly under the same budget.
 *
 * Shape access also goes through `_zod.def.shape` rather than
 * `infer Shape from z.ZodObject<Shape>` — the latter collapses to the
 * `$ZodShape` upper bound in the same worker because of
 * `z.ZodObject`'s `out Shape` covariance markers.
 *
 * Trade: a transform nested INSIDE another container (e.g. a
 * `z.object({...}).default({...})` whose inner shape contains a
 * `.transform()`) resolves through the outer output access, which
 * cascades into the transform's output type. Most form schemas
 * don't nest transforms inside defaulted containers; document the
 * edge.
 */
export type StorageShape<S> = S extends {
  _zod: { def: { type: 'object'; shape: infer Shape } }
}
  ? {
      [K in keyof Shape]-?: Shape[K] extends {
        _zod: { def: { type: 'pipe'; in: { _zod: { def: { type: 'transform' } } } } }
      }
        ? Shape[K] extends { _zod: { output: infer Out } }
          ? Out
          : never
        : Shape[K] extends {
              _zod: { def: { type: 'pipe' | 'transform' } }
            }
          ? Shape[K] extends { _zod: { input: infer In } }
            ? In
            : never
          : Shape[K] extends { _zod: { output: infer Out } }
            ? Out
            : never
    }
  : S extends { _zod: { input: infer In } }
    ? In
    : never
