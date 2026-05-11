/**
 * Library-level default constants. All consumer-facing fallbacks for
 * the bundled options (`debounceMs`, `persist.debounceMs`,
 * `history.max`, etc.) resolve to one of these — extracting them here
 * keeps the JSDoc on the public option type and the runtime fallback
 * in lockstep, and gives reviewers a single file to scan when tuning
 * timing/policy defaults.
 *
 * Per-form `useForm({ ... })` options always win over these. App-level
 * `createAttaform({ defaults: ... })` options sit between the
 * two: per-form > app-level > library default.
 */

import { __DEV__ } from './dev'

/**
 * Validation debounce (`useForm({ debounceMs })`) — ms to wait after
 * the LAST input event before running validation. Default `0`
 * (debounce disabled): every committed write fires a validation pass
 * synchronously, no `setTimeout`. Matches the obvious mental model
 * and avoids the "why is my error 125 ms behind my keystroke?"
 * footgun for new consumers.
 *
 * NOTE: this is purely the VALIDATION debounce. Form storage
 * (`form.values`) commits on every write the directive forwards;
 * `setValueWithInternalPath` writes immediately and triggers a
 * validation schedule. WHEN the directive actually forwards a write
 * is a separate concern controlled by input modifiers — `<input
 * v-register>` commits on every keystroke (`input` event), but
 * `<input v-register.lazy>` defers to the `change` event so storage
 * only commits on blur. The validation debounce is independent of
 * either path: it always counts ms since the last committed write.
 *
 * Devs who need validation coalescing — slow async adapters,
 * validation that runs heavy work — opt in with `debounceMs: 200`
 * (or any positive number). The off-by-default posture trades CPU
 * cycles for UX latency wins, and the cycles only matter for
 * adapters that are actually expensive.
 */
export const DEFAULT_FIELD_VALIDATION_DEBOUNCE_MS = 0

/**
 * Persistence write debounce (`persist.debounceMs`). 300 ms is
 * generous on purpose — the goal is "draft survives accidental
 * navigation," not "every keystroke hits storage." Lower if your
 * storage adapter is in-memory; raise for slow IndexedDB or remote
 * adapters.
 */
export const DEFAULT_PERSISTENCE_DEBOUNCE_MS = 300

/**
 * Undo/redo stack ceiling (`history.max`). 50 covers a generous
 * editing session without unbounded memory growth from long-lived
 * forms. Snapshots are shallow, so the per-snapshot cost is small;
 * the cap exists more for predictability than memory pressure.
 */
export const DEFAULT_HISTORY_MAX_SNAPSHOTS = 50

/**
 * Storage-key namespace for persistence. Resolved once at
 * `resolveStorageKey` to `${PERSISTENCE_KEY_PREFIX}${formKey}` unless
 * the consumer passes an explicit `persist.key`. Kept as a separate
 * constant so multi-tenant deployments can audit or reserve their
 * own prefix without grepping for the literal.
 */
export const PERSISTENCE_KEY_PREFIX = 'attaform:'

/**
 * Reserved namespace for the library's internal synthetic keys
 * (anonymous forms today, plus any future internal-key uses).
 * `useAbstractForm` rejects any consumer-supplied key starting with
 * this prefix at construction time, throwing `ReservedFormKeyError` —
 * so collisions with the synthetic-key namespace are impossible by
 * construction. The double-underscore convention reads as "internal"
 * universally, lowering the chance a consumer would naturally pick
 * a key from this space anyway.
 */
export const RESERVED_KEY_PREFIX = '__atta:'

/**
 * Synthetic-key prefix for `useForm()` calls without an explicit
 * `key`. Lives inside the reserved `__atta:` namespace so the entry-
 * level reject in `resolveFormKey` covers it automatically — see
 * `RESERVED_KEY_PREFIX` for the enforcement story.
 */
export const ANONYMOUS_FORM_KEY_PREFIX = `${RESERVED_KEY_PREFIX}anon:`

/**
 * Recursion ceiling for schema walks that descend through recursive
 * schemas (Zod's `z.lazy(...)` today, equivalent constructs in any
 * future adapter). Adapter walks that follow a recursive boundary —
 * default derivation, slim-primitive type gates, path resolution,
 * refinement stripping — track their descent depth and bail with a
 * permissive fallback once `depth > maxRecursionDepth`.
 *
 * Default `64`. Tunable per-form via `useForm({ maxRecursionDepth })`
 * and app-wide via `createAttaform({ defaults: { maxRecursionDepth } })`;
 * per-form > app-level > this library default. `Infinity` disables
 * the cap entirely — see `AttaformDefaults.maxRecursionDepth`.
 *
 * "Permissive fallback" means the gate stops type-checking past the
 * cap (storage accepts the consumer's value; runtime validation
 * still runs against the real schema). Practical effect: forms with
 * trees deeper than the cap still work, but writes at deeper nodes
 * skip the slim-primitive type-gate. Raise the cap if you regularly
 * edit beyond it.
 */
export const DEFAULT_MAX_RECURSION_DEPTH = 64

/**
 * Normalise a consumer-supplied `maxRecursionDepth` before threading
 * it into the adapter walks. The walks compare integer descent depths
 * via `>=`, which interacts poorly with three categories of input:
 *
 *   - `NaN` — every comparison yields `false`, so walks never bail and
 *     pathological self-referencing schemas exhaust the call stack.
 *   - Negative numbers — `0 >= -1` is `true`, so walks bail on the
 *     very first lazy crossing. The likely user intent (negative =
 *     unlimited) is the opposite of the runtime behaviour.
 *   - Non-integers — `5.7` effectively caps at 5 via floor-comparison.
 *     Works, but is imprecise; the visible value doesn't match the
 *     effective depth.
 *
 * Sanitisation rules:
 *
 *   - `Infinity` passes through (disables the cap by design).
 *   - Non-numbers, `NaN`, `-Infinity` → fall back to the library
 *     default and emit a dev-mode warning so the misuse is visible.
 *   - Negative finite numbers → `0` (closest valid intent).
 *   - Non-integer positives → floored to the next-lower integer.
 *
 * The fallback path doesn't throw — a bad option shouldn't be fatal
 * at construction. Dev-warn is enough; production simply degrades
 * to the library default.
 */
export function normalizeRecursionDepth(value: number, source: string): number {
  if (value === Infinity) return Infinity
  if (typeof value !== 'number' || Number.isNaN(value) || value === -Infinity) {
    if (__DEV__) {
      console.warn(
        `[attaform] ${source}.maxRecursionDepth must be a non-negative integer or Infinity; ` +
          `got ${String(value)}. Falling back to ${DEFAULT_MAX_RECURSION_DEPTH}.`
      )
    }
    return DEFAULT_MAX_RECURSION_DEPTH
  }
  return Math.max(0, Math.floor(value))
}
