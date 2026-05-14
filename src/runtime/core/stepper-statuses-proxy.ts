import { computed, type ComputedRef } from 'vue'
import { __DEV__ } from './dev'
import type { FormStatus, StepperStatusesProxy } from '../types/types-stepper'

/**
 * Build the callable readonly Proxy that powers `stepper.statuses`.
 *
 * Reactivity contract:
 *
 *   - **Reads track dependencies.** Each per-key entry is supplied
 *     as a `ComputedRef<FormStatus>` whose source-of-truth is the
 *     participating form's `meta`. Property access unwraps the
 *     computed (`.value`) so consumers don't deal with `.value` —
 *     Vue's tracking still fires through the unwrap.
 *
 *   - **Writes are blocked.** Status entries are derived; writing
 *     them would corrupt the model. The proxy warns in dev and
 *     silently no-ops, matching `form.values`' contract.
 *
 *   - **Callable single-key + no-arg.** `stepper.statuses('cargo')`
 *     returns the same `FormStatus` as `stepper.statuses.cargo`.
 *     `stepper.statuses()` returns the full record. Both call
 *     surfaces unwrap the computeds for a snapshot read.
 *
 *   - **JSON.stringify works.** `toJSON` returns the snapshot
 *     record so `JSON.stringify(stepper.statuses)` serializes the
 *     active status set.
 *
 * Topology note: one level deep (no nested chaining), so this is
 * roughly half the LOC of `form.values`' proxy — no path-walking,
 * no canonicalisation, no recursive descent.
 */
export function buildStepperStatusesProxy<S extends Record<string, FormStatus>>(
  statuses: Record<keyof S, ComputedRef<FormStatus>>
): StepperStatusesProxy<S> {
  const snapshot = computed(() => {
    const result: Record<string, FormStatus> = {}
    for (const key of Object.keys(statuses)) {
      result[key] = (statuses[key as keyof S] as ComputedRef<FormStatus>).value
    }
    return result as S
  })

  const target = (() => {}) as unknown as StepperStatusesProxy<S>

  const proxyToString = (): string => JSON.stringify(snapshot.value)
  const proxyToPrimitive = (hint: string): string | number =>
    hint === 'number' ? NaN : proxyToString()

  return new Proxy(target, {
    apply(_, __, args: unknown[]): unknown {
      const key = args[0] as string | undefined
      if (key === undefined) return snapshot.value
      const computedEntry = statuses[key as keyof S] as ComputedRef<FormStatus> | undefined
      if (computedEntry === undefined) return undefined
      return computedEntry.value
    },
    get(_, key: string | symbol): unknown {
      if (typeof key === 'symbol') {
        if (key === Symbol.toPrimitive) return proxyToPrimitive
        return Reflect.get(target, key)
      }
      if (key === 'toJSON') return () => snapshot.value
      if (key === 'toString') return proxyToString
      if (key === 'valueOf')
        return function (this: unknown): unknown {
          return this
        }
      const computedEntry = statuses[key as keyof S] as ComputedRef<FormStatus> | undefined
      if (computedEntry === undefined) return undefined
      return computedEntry.value
    },
    has(_, key: string | symbol): boolean {
      if (typeof key === 'symbol') return Reflect.has(target, key)
      return Object.hasOwn(statuses, key)
    },
    ownKeys(): ArrayLike<string | symbol> {
      return Object.keys(statuses)
    },
    getOwnPropertyDescriptor(_, key: string | symbol): PropertyDescriptor | undefined {
      if (typeof key === 'symbol') return undefined
      const computedEntry = statuses[key as keyof S] as ComputedRef<FormStatus> | undefined
      if (computedEntry === undefined) return undefined
      return {
        configurable: true,
        enumerable: true,
        writable: false,
        value: computedEntry.value,
      }
    },
    set(_, key) {
      if (__DEV__) {
        console.warn(
          `[attaform] stepper.statuses is read-only — write to "${String(key)}" was ignored. Statuses derive from each form's meta; mutate the underlying form instead.`
        )
      }
      return true
    },
    deleteProperty(_, key) {
      if (__DEV__) {
        console.warn(
          `[attaform] stepper.statuses is read-only — delete of "${String(key)}" was ignored.`
        )
      }
      return true
    },
    defineProperty: () => true,
  })
}
