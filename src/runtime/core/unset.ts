/**
 * The `unset` sentinel — pass it as a primitive leaf's value to mark
 * the field displayed-empty while storage holds the schema's slim
 * default (`0` / `''` / `false` / `0n`).
 *
 * Accepted in `defaultValues`, `setValue(path, unset)`, and
 * `form.reset({ … })` for any `string` / `number` / `boolean` /
 * `bigint` leaf:
 *
 * ```ts
 * const form = useForm({
 *   schema: z.object({ income: z.number() }),
 *   defaultValues: { income: unset }, // UI starts blank, storage holds 0
 *   key: 'housing',
 * })
 * ```
 *
 * Required schemas (no `.optional()` / `.nullable()` / `.default(N)`)
 * raise `"No value supplied"` on submit while the path stays in the
 * form's `blankPaths` set; optional / nullable / has-default schemas
 * accept the empty case.
 *
 * Storage never holds the symbol — the runtime translates it at the
 * API boundary. Cross-bundle / SSR-safe: the runtime symbol uses
 * `Symbol.for(...)` so every realm gets the same sentinel.
 */
declare const _unsetBrand: unique symbol

/**
 * Brand-typed sentinel admitted at every primitive leaf of
 * `DefaultValuesShape<T>`, `setValue`, and `reset`. The runtime
 * symbol is exported alongside under the same name.
 */
export type Unset = typeof _unsetBrand

export const unset: Unset = Symbol.for('@chemical-x/forms/unset') as Unset

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
