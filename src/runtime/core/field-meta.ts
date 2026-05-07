/**
 * Schema-attached field metadata — the shared types used by both Zod
 * adapters (`attaform/zod` for v4 and `attaform/zod-v3` for v3) so a
 * consumer's data flow reads the same shape regardless of adapter.
 *
 * The Zod 4 adapter creates a typed `z.registry<FieldMetaPayload>()`
 * and writes through `schema.register(fieldMeta, payload)` (native) or
 * the `withMeta(schema, payload)` helper. The Zod 3 adapter has no
 * native registry — it shims a `WeakMap<ZodTypeAny, FieldMetaPayload>`
 * with the same write API via `withMeta`.
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
