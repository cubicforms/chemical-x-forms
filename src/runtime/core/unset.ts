/**
 * The `unset` sentinel — a brand-typed symbol consumers pass to indicate
 * that a primitive leaf should be *displayed empty* even though storage
 * holds a real, schema-conformant value (the slim default).
 *
 * Use it in `defaultValues`, `setValue(path, unset)`, and
 * `form.reset({ ... })` for any string / number / boolean / bigint leaf
 * the user hasn't answered yet:
 *
 * ```ts
 * import { useForm } from '@chemical-x/forms/zod'
 * import { unset } from '@chemical-x/forms'
 * import { z } from 'zod'
 *
 * const form = useForm({
 *   schema: z.object({ income: z.number() }),
 *   defaultValues: { income: unset }, // UI starts blank, storage holds 0
 *   key: 'housing',
 * })
 *
 * // Submitting before the user types raises a "Required" error,
 * // because z.number() is strict (no .optional()/.nullable()/.default()).
 * ```
 *
 * Why `Symbol.for` and a phantom `unique symbol` brand: the runtime symbol
 * is registry-keyed so two bundles or two SSR realms produce the same
 * value (shared registry). The phantom unique-symbol brand gives
 * TypeScript a precise leaf type so `DefaultValuesShape<T>` can widen
 * primitive leaves to `T | Unset` while non-primitive leaves stay strict.
 *
 * Storage NEVER holds the symbol; the runtime translates it to the slim
 * default at `useAbstractForm` construction, `setValue`, and `reset`
 * boundaries.
 */
declare const _unsetBrand: unique symbol

export type Unset = typeof _unsetBrand

export const unset = Symbol.for('@chemical-x/forms/unset') as Unset

export function isUnset(value: unknown): value is Unset {
  return value === unset
}
