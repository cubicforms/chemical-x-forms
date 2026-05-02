/**
 * Library-level default constants. All consumer-facing fallbacks for
 * the bundled options (`debounceMs`, `persist.debounceMs`,
 * `history.max`, etc.) resolve to one of these — extracting them here
 * keeps the JSDoc on the public option type and the runtime fallback
 * in lockstep, and gives reviewers a single file to scan when tuning
 * timing/policy defaults.
 *
 * Per-form `useForm({ ... })` options always win over these. App-level
 * `createChemicalXForms({ defaults: ... })` options sit between the
 * two: per-form > app-level > library default.
 */

/**
 * Validation debounce (`useForm({ debounceMs })`) — ms to wait after
 * the LAST input event before running validation. Default `0`
 * (debounce disabled): every keystroke fires a validation pass
 * synchronously, no `setTimeout`. Matches the obvious mental model
 * and avoids the "why is my error 125 ms behind my keystroke?"
 * footgun for new consumers.
 *
 * NOTE: this is purely the validation debounce. Form storage
 * (`form.values`) is always live — every keystroke commits
 * regardless of this value.
 *
 * Devs who need coalescing — slow async adapters, validation that
 * runs heavy work — opt in explicitly with `debounceMs: 200` (or any
 * positive number). The off-by-default posture trades CPU cycles for
 * UX latency wins, and the cycles only matter for adapters that are
 * actually expensive.
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
export const PERSISTENCE_KEY_PREFIX = 'chemical-x-forms:'

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
export const RESERVED_KEY_PREFIX = '__cx:'

/**
 * Synthetic-key prefix for `useForm()` calls without an explicit
 * `key`. Lives inside the reserved `__cx:` namespace so the entry-
 * level reject in `resolveFormKey` covers it automatically — see
 * `RESERVED_KEY_PREFIX` for the enforcement story.
 */
export const ANONYMOUS_FORM_KEY_PREFIX = `${RESERVED_KEY_PREFIX}anon:`
