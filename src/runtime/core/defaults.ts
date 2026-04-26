/**
 * Library-level default constants. All consumer-facing fallbacks for
 * the bundled options (`fieldValidation.debounceMs`, `persist.debounceMs`,
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
 * Field-validation debounce (`fieldValidation.debounceMs`). 125 ms is
 * below the perceptual threshold for most typists while still
 * coalescing rapid bursts so the schema doesn't re-run on every
 * keystroke.
 */
export const DEFAULT_FIELD_VALIDATION_DEBOUNCE_MS = 125

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
 * Synthetic-key prefix for `useForm()` calls without an explicit
 * `key`. Reserved namespace — collisions with consumer-supplied keys
 * are possible only if the consumer also uses `cx:anon:…`, which
 * isn't documented as a supported pattern.
 */
export const ANONYMOUS_FORM_KEY_PREFIX = 'cx:anon:'
