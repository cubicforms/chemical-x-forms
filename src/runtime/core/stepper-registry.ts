import type { FormKey } from '../types/types-api'

/**
 * Per-stepper bookkeeping. A stepper claims each participating form's
 * key, marks one claim `current`, and signals "this form's factory
 * should defer until activated" via `shouldDefer`. `useAbstractForm`'s
 * settle path consults `shouldDefer` before firing a function-form
 * `defaultValues` factory.
 *
 * Decoupled from `AttaformRegistry` because a stepper's lifetime is
 * a setup-scope subset of the registry's app lifetime — we want
 * claims to clear on `onScopeDispose` without touching the form
 * registry's eviction logic.
 */

type ClaimRecord = {
  isCurrent: boolean
}

export type StepperRegistry = {
  /**
   * Record that this stepper owns `key`. Idempotent — repeat claims
   * of the same key reset the `isCurrent` bit to match the argument.
   */
  claim(key: FormKey, isCurrent: boolean): void
  /** Whether this stepper owns `key`. */
  isClaimed(key: FormKey): boolean
  /**
   * Whether a claimed, non-current form's `defaultValues` factory
   * should be deferred. Returns `false` for unclaimed or current
   * keys.
   */
  shouldDefer(key: FormKey): boolean
  /**
   * Update which claim is `current`. `priorKey === undefined` skips
   * the prior-clear step (initial mark).
   */
  markCurrent(nextKey: FormKey, priorKey: FormKey | undefined): void
  /**
   * Register a one-shot callback that fires the first time `key`
   * becomes current. Fires immediately if `key` is already current.
   * Used by `useAbstractForm` to lazily run a deferred factory.
   */
  registerActivation(key: FormKey, callback: () => void): void
  /** Clears all claims + pending activations. */
  dispose(): void
}

export function createStepperRegistry(): StepperRegistry {
  const claims = new Map<FormKey, ClaimRecord>()
  const pendingActivations = new Map<FormKey, () => void>()

  function claim(key: FormKey, isCurrent: boolean): void {
    const existing = claims.get(key)
    if (existing) {
      existing.isCurrent = isCurrent
      return
    }
    claims.set(key, { isCurrent })
  }

  function isClaimed(key: FormKey): boolean {
    return claims.has(key)
  }

  function shouldDefer(key: FormKey): boolean {
    const record = claims.get(key)
    if (record === undefined) return false
    return record.isCurrent === false
  }

  function markCurrent(nextKey: FormKey, priorKey: FormKey | undefined): void {
    if (priorKey !== undefined) {
      const prior = claims.get(priorKey)
      if (prior) prior.isCurrent = false
    }
    const next = claims.get(nextKey)
    if (next) next.isCurrent = true
    const pending = pendingActivations.get(nextKey)
    if (pending !== undefined) {
      pendingActivations.delete(nextKey)
      pending()
    }
  }

  function registerActivation(key: FormKey, callback: () => void): void {
    const record = claims.get(key)
    if (record?.isCurrent === true) {
      callback()
      return
    }
    pendingActivations.set(key, callback)
  }

  function dispose(): void {
    claims.clear()
    pendingActivations.clear()
  }

  return { claim, isClaimed, shouldDefer, markCurrent, registerActivation, dispose }
}
