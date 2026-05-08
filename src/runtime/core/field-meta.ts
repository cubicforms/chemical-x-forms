/**
 * Schema-attached field metadata — the shared types used by both Zod
 * adapters and the unified `attaform/zod` entry so a consumer's data
 * flow reads the same shape regardless of which path runs at lookup.
 *
 * Storage lives in the cross-adapter `field-meta-store` core: a pair
 * of WeakMaps (single-payload for last-write-wins reads, list-of-
 * payloads for shared-schema disambiguation). Every entry's
 * `fieldMeta` re-exports the same registry-shaped object, so
 * `withMeta`/`fieldMeta.add` writes from one entry surface at lookup
 * through any other.
 *
 * `withMeta(schema, payload)` clones the schema before registering,
 * so each call gets fresh identity (the WeakMap keys on reference).
 * The cloning strategy depends on the major: Zod 4 schemas use the
 * native `.clone()`, Zod 3 schemas reconstruct via constructor +
 * `_def`. The unified entry's `withMeta` runtime-branches on which
 * one is in play.
 *
 * Reads are unified through `AbstractSchema.getFieldMetaAtPath(path)`,
 * which returns a fully-resolved `ResolvedFieldMeta` (label /
 * description / placeholder / meta) so the per-leaf and per-container
 * `FieldState` producers in core never see the version split.
 */

/**
 * The metadata a consumer attaches to a schema node — short label
 * (presentational), longer description (helper text), placeholder
 * (input affordance). Declared as `interface` (not `type`) so
 * downstream apps can extend the shape via TypeScript declaration
 * merging when they want to register richer payloads (tooltips,
 * icons, badge counts, etc.):
 *
 *     declare module 'attaform/zod' {
 *       interface FieldMetaPayload {
 *         tooltip?: string
 *       }
 *     }
 *
 * After augmentation, `withMeta(schema, { tooltip: '…' })` is typed
 * and `state.meta.tooltip` reads back as `string | undefined`.
 *
 * Every key is optional. Empty payloads (no keys registered) are
 * indistinguishable from "not registered at all" — both surface as
 * fallbacks (humanize for label, undefined for the rest).
 */
export interface FieldMetaPayload {
  label?: string
  description?: string
  placeholder?: string
}

/**
 * The fully-resolved metadata returned by
 * `AbstractSchema.getFieldMetaAtPath(path)`. Adapters apply the
 * precedence rules:
 *
 *   - `label`: registry payload → `humanize(lastSegment)`
 *   - `description`: registry payload → schema's `.describe()` value → `undefined`
 *   - `placeholder`: registry payload → `undefined`
 *   - `meta`: full registered payload, frozen — empty object if nothing registered
 *
 * `label` is always a non-empty string at leaves (humanize fallback
 * guarantees this for any non-numeric segment). For containers it
 * may collapse to the empty string when the path is empty (root) or
 * the segment is a numeric index — callers display "" or substitute
 * a context-appropriate fallback.
 */
export type ResolvedFieldMeta = {
  readonly label: string
  readonly description: string | undefined
  readonly placeholder: string | undefined
  readonly meta: Readonly<FieldMetaPayload>
}

/**
 * Empty resolved metadata for paths that don't exist in the schema
 * (or for adapters that don't yet implement `getFieldMetaAtPath`).
 * Callers can compare against this sentinel via referential equality
 * to detect "no metadata available."
 */
export const EMPTY_RESOLVED_FIELD_META: ResolvedFieldMeta = Object.freeze({
  label: '',
  description: undefined,
  placeholder: undefined,
  meta: Object.freeze({}),
})
