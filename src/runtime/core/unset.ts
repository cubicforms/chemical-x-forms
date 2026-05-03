/** Internal brand for the `Unset` type. Never exposed at runtime. */
declare const _unsetBrand: unique symbol

/**
 * Brand-typed sentinel admitted at every primitive leaf of
 * `DefaultValuesShape<T>`, `setValue`, and `reset`. The runtime value
 * is exported as {@link unset} under the same name.
 */
export type Unset = typeof _unsetBrand

/**
 * The `unset` sentinel — pass it as a primitive leaf's value to mark
 * the field **displayed-empty** while storage holds the schema's slim
 * default (`0` / `''` / `false` / `0n`).
 *
 * Use it wherever a primitive leaf value is expected:
 *
 * ```ts
 * const form = useForm({
 *   schema: z.object({ income: z.number() }),
 *   defaultValues: { income: unset }, // UI starts blank, storage holds 0
 *   key: 'housing',
 * })
 *
 * form.setValue('income', unset)        // re-blank a field after a write
 * form.reset({ income: unset })         // reset to the blank state
 * ```
 *
 * Accepted at any `string` / `number` / `boolean` / `bigint` leaf in
 * `defaultValues`, `setValue(path, unset)`, and `form.reset({ … })`.
 *
 * The path joins the form's `blankPaths` set as long as it stays
 * unset. Required schemas (no `.optional()` / `.nullable()` /
 * `.default(N)`) raise `"No value supplied"` on submit while a leaf
 * is in `blankPaths`; optional / nullable / has-default schemas
 * accept the empty case as their wrapper allows.
 *
 * Storage never holds the symbol — the runtime translates it at the
 * API boundary, so reads through `form.values` always see the slim
 * default. Cross-bundle / SSR-safe: backed by `Symbol.for(...)` so
 * every realm gets the same sentinel.
 *
 * @see {@link isUnset} — type guard that narrows a value back to {@link Unset}.
 * @see `docs/blank.md` — the conceptual model behind blank-aware fields.
 */
export const unset: Unset = Symbol.for('decant/unset') as Unset

/**
 * Type guard — `true` when `value` is the `unset` sentinel.
 *
 * ```ts
 * if (isUnset(payload.income)) {
 *   // payload.income is the sentinel; the field will display empty
 * }
 * ```
 */
export function isUnset(value: unknown): value is Unset {
  return value === unset
}
