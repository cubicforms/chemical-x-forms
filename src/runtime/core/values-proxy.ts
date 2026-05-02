import { computed, readonly, type Ref } from 'vue'
import { __DEV__ } from './dev'
import { canonicalizePath, type Path } from './paths'
import type { GenericForm } from '../types/types-core'

/**
 * Public shape of `form.values` — a callable proxy that drills via
 * dot/bracket OR call dynamically:
 *
 *   form.values.email                  // string (the value)
 *   form.values.address.city           // string (chained descent)
 *   form.values.address                // { city, … } — object, drillable further
 *   form.values('address.city')        // function-call (dynamic / programmatic)
 *   form.values(['address', 'city'])   // path-array form
 *   form.values()                      // the whole form value (root)
 *
 * Asymmetry against `form.errors` / `form.fields`: containers in
 * `values` ARE useful (they are the structural objects), so they
 * terminate as well as descend. Errors and fields containers are
 * descend-only because their content at a container level is a
 * derivation (e.g. "any descendant dirty") rather than a real datum.
 */
export type ValuesProxy<F> = ((path?: string | Path) => unknown) & Readonly<F>

/**
 * Build the callable readonly Proxy that powers `form.values`.
 *
 * Reactivity contract:
 *
 *   - **Reads track dependencies normally.** The inner
 *     `computed(() => readonly(form.value))` recomputes on every
 *     whole-form swap (Ref reassignment via `reset()` / whole-form
 *     `setValue`) and on every per-key write through Vue's reactive
 *     tracking. Each read on the callable proxy delegates to
 *     `inner.value.<key>`, which lands inside the consumer's active
 *     effect — Vue tracks the dependency at access time.
 *
 *   - **Writes are blocked.** Vue's `readonly()` traps `set` / `delete` /
 *     `defineProperty` on the inner proxy. The callable wrapper
 *     additionally rejects writes at its own boundary. The slim-
 *     primitive write gate stays the only path into storage.
 *
 *   - **Identity-stable on swap.** Vue's `readonly()` maps targets
 *     to proxies by identity. A whole-form swap produces a fresh
 *     readonly proxy; the wrapping computed invalidates and
 *     re-evaluates. Consumers reading `form.values.<x>` always see
 *     the current target's data.
 *
 *   - **JSON.stringify works.** The callable proxy is `typeof ===
 *     'function'`, which JSON.stringify normally omits — `toJSON`
 *     short-circuits that path and returns the inner readonly proxy
 *     so consumers serialise the actual form data, not `undefined`.
 *
 *   - **Symbol passthrough.** Vue's reactivity sigils
 *     (`Symbol(__v_isRef)`, `Symbol(__v_isReadonly)`, etc.) and
 *     iteration symbols resolve against the function target, not
 *     the schema-aware branch.
 */
export function buildValuesProxy<F extends GenericForm>(form: Ref<F>): ValuesProxy<F> {
  const inner = computed(() => readonly(form.value))

  // Arrow-function target: callable (typeof === 'function', `apply`
  // trap fires) but no non-configurable `prototype` to satisfy the
  // ownKeys Proxy invariant.
  const target = (() => {}) as unknown as ValuesProxy<F>

  return new Proxy(target, {
    apply(_, __, args: unknown[]): unknown {
      const arg = args[0] as string | Path | undefined
      // No-arg: return the whole form value (the readonly root proxy).
      if (arg === undefined) return inner.value
      // Dynamic path: walk segments through the readonly proxy. Each
      // step reads through the proxy's own get traps so dependency
      // tracking propagates at every level.
      const { segments } = canonicalizePath(arg)
      let cursor: unknown = inner.value
      for (const seg of segments) {
        if (cursor === null || cursor === undefined) return undefined
        cursor = (cursor as Record<string | number, unknown>)[seg]
      }
      return cursor
    },
    get(_, key: string | symbol): unknown {
      // Symbol passthrough — Vue's reactivity sigils resolve here.
      if (typeof key === 'symbol') return Reflect.get(target, key)
      // toJSON: serialise the inner readonly proxy. JSON.stringify
      // checks for toJSON before checking typeof, so the callable
      // proxy serialises to the actual form data.
      if (key === 'toJSON') return () => inner.value
      // Property access: delegate to the readonly proxy. Vue's
      // dependency tracking captures the read inside the consumer's
      // active effect.
      return (inner.value as Record<string, unknown>)[key]
    },
    has(_, key: string | symbol): boolean {
      if (typeof key === 'symbol') return Reflect.has(target, key)
      return Reflect.has(inner.value as object, key)
    },
    ownKeys(): ArrayLike<string | symbol> {
      return Reflect.ownKeys(inner.value as object)
    },
    getOwnPropertyDescriptor(_, key: string | symbol): PropertyDescriptor | undefined {
      const desc = Reflect.getOwnPropertyDescriptor(inner.value as object, key)
      if (desc !== undefined) desc.configurable = true
      return desc
    },
    // Match Vue's `readonly()` semantics: writes warn (in dev) and
    // silently noop (return true). Returning false would throw
    // TypeError in strict-mode consumers, surprising users who
    // assigned through the proxy and expected it to be ignored.
    set(_, key) {
      if (__DEV__) {
        console.warn(
          `[@chemical-x/forms] form.values is read-only — write to "${String(key)}" was ignored. Use form.setValue / the directive / field-array helpers instead.`
        )
      }
      return true
    },
    deleteProperty(_, key) {
      if (__DEV__) {
        console.warn(
          `[@chemical-x/forms] form.values is read-only — delete of "${String(key)}" was ignored.`
        )
      }
      return true
    },
    defineProperty: () => true,
  })
}
