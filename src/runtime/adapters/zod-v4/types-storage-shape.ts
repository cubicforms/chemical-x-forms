/**
 * The shape `form.values.<key>` returns at runtime.
 *
 * Per leaf:
 *
 * 1. `z.preprocess(fn, inner)` — compiles to `ZodPipe<ZodTransform, inner>`.
 *    The preprocess fn fires at the write boundary (synthesized into
 *    `setValue`), so storage holds whatever `inner` stores. Recurse
 *    `StorageShape` on `inner` so a defaulted leaf inside `inner` still
 *    reads `T` (not `T | undefined`).
 *
 * 2. `inner.transform(fn)` — compiles to `ZodPipe<inner, ZodTransform>`.
 *    Transforms fire at submit / validate, NOT at the write boundary,
 *    so storage holds whatever `inner` stores. Recurse `StorageShape`
 *    on `inner` for the same reason.
 *
 *    A bare top-level `ZodTransform` (no `in` schema) reads
 *    `_zod.input` directly — there's no inner to recurse into.
 *
 * 3. Codec / generic pipe — neither side is a transform. Read
 *    `_zod.output`. Codecs aren't write-boundary-synthesized, so the
 *    post-parse view is the only honest storage type.
 *
 * 4. Everything else (defaults, catch, readonly, optional, primitives,
 *    nested objects) — read `_zod.output`. Defaults and catches fire
 *    at parse time, so the post-init view is what storage holds.
 *    Nested objects delegate to Zod's own recursion on `_zod.output`,
 *    which peels nested defaults inside structural containers.
 *
 * Recursion: the alias calls itself on the non-transform side of a
 * pipe so the inner shape gets the same per-key storage treatment as
 * the top level. Without it, an inner `.default(...)` inside a
 * transformed object would peel back to `T | undefined` (the broad
 * input contract). Recursion only fires for pipe leaves — most leaves
 * skip it.
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
 */
export type StorageShape<S> = S extends {
  _zod: { def: { type: 'object'; shape: infer Shape } }
}
  ? { [K in keyof Shape]-?: StorageLeaf<Shape[K]> }
  : StorageLeaf<S>

type StorageLeaf<L> = L extends {
  _zod: { def: { type: 'pipe'; in: infer A; out: infer B } }
}
  ? A extends { _zod: { def: { type: 'transform' } } }
    ? StorageShape<B>
    : B extends { _zod: { def: { type: 'transform' } } }
      ? StorageShape<A>
      : L extends { _zod: { output: infer Out } }
        ? Out
        : never
  : L extends { _zod: { def: { type: 'transform' } } }
    ? L extends { _zod: { input: infer In } }
      ? In
      : never
    : L extends { _zod: { output: infer Out } }
      ? Out
      : never
