/**
 * Generic classifier for the `T | (() => T) | (() => Promise<T>)`
 * trichotomy used by `useForm({ defaultValues })` and (in PR 3)
 * `useStepper({ defaultStatuses })`.
 *
 * Plain values (including `undefined` and `null`) resolve immediately
 * at construction — there's nothing to defer, the literal already
 * paid the cost. Function inputs (sync or async) resolve on a
 * microtask: the form starts with the schema's slim defaults, and the
 * factory's resolved payload applies once it settles. Inside the
 * `'async'` branch, consumers `await result.factory()` — a sync
 * function's return resolves on the next microtask, identical in
 * shape to an immediate `Promise.resolve`.
 *
 * The seam stays at the boundary so downstream wiring branches once
 * on `kind`, not on `typeof` everywhere.
 */
export type ResolvedTrichotomy<T> =
  | { readonly kind: 'sync'; readonly value: T }
  | { readonly kind: 'async'; readonly factory: () => T | Promise<T> }

export function resolveTrichotomy<T>(
  input: T | (() => T) | (() => Promise<T>)
): ResolvedTrichotomy<T> {
  if (typeof input === 'function') {
    return { kind: 'async', factory: input as () => T | Promise<T> }
  }
  return { kind: 'sync', value: input as T }
}
