import { computed, readonly, type ComputedRef, type Ref } from 'vue'
import type { GenericForm } from '../types/types-core'

/**
 * Build a `ComputedRef<Readonly<F>>` whose `.value` is a deeply-readonly
 * Vue proxy over the form's storage value. Read identically in script
 * and template (no `.value` once the consumer accesses it through a
 * getter on the form return) — Pinia setup-store pattern.
 *
 * Reactivity contract:
 *
 *   - Writes are blocked. Vue's `readonly()` traps `set` / `delete` /
 *     `defineProperty` / etc. and emits a dev warn (silent in prod).
 *     The slim-primitive write gate stays the only path into storage.
 *
 *   - Reads track dependencies normally. The outer computed depends on
 *     `state.form.value` (the Ref); the inner readonly proxy traps each
 *     property read on the same effect graph as the underlying reactive
 *     target, so `form.values.email` inside a render effect re-runs on
 *     either the whole-form swap (`reset` / whole-form `setValue`) or a
 *     per-key write.
 *
 *   - Identity-stable on swap. `state.form.value = next` (the
 *     `applyFormReplacement` path used by `reset()` and whole-form
 *     `setValue`) reassigns the Ref's contained value. Vue's `readonly()`
 *     keys on TARGET identity, so a swap produces a fresh proxy. The
 *     wrapping `computed` invalidates on the swap and re-evaluates,
 *     handing out the new proxy. If a consumer caches `form.values`
 *     across the swap, the cached reference points at the OLD proxy —
 *     fine, since the old proxy still wraps the old (now-orphaned)
 *     target object. Re-reading `form.values` on the form return after
 *     the swap returns the fresh proxy.
 *
 *   - `readonly()` recurses. Nested object reads (`form.values.address.city`)
 *     return readonly proxies wrapping the inner reactive objects, so
 *     dependency tracking and write-blocking propagate to every depth.
 *     Arrays are wrapped too — mutating array methods (push, splice)
 *     throw the dev-mode `readonly` warn.
 *
 * Why a `computed` wrapper, not just `readonly(state.form.value)` cached
 * once: Vue's `readonlyMap` maps target → proxy by target identity. If
 * we cache `readonly(state.form.value)` at module init and `state.form`
 * is later swapped, the cache hands out a stale proxy over the
 * orphaned target. The `computed` re-evaluates on swap and produces a
 * fresh proxy keyed to the new target.
 */
export function buildValuesProxy<F extends GenericForm>(form: Ref<F>): ComputedRef<Readonly<F>> {
  return computed(() => readonly(form.value)) as ComputedRef<Readonly<F>>
}
