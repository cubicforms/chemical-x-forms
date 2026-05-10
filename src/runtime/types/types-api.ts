import type { ComputedRef, ObjectDirective, Ref } from 'vue'
import type { FieldMetaPayload, ResolvedFieldMeta } from '../core/field-meta'
import type { Path, PathKey } from '../core/paths'
import type { PersistOptInRegistry } from '../core/persistence/opt-in-registry'

export type { FieldMetaPayload, ResolvedFieldMeta }
import type {
  ArrayItem,
  ArrayPath,
  DeepPartial,
  DefaultValuesShape,
  FlatPath,
  GenericForm,
  IsObjectOrArray,
  IsUnion,
  JoinSegments,
  KeyofUnion,
  LiftedValueShape,
  NestedReadType,
  NestedType,
  ValueOfUnion,
  WriteShape,
} from './types-core'

/**
 * Identifier for a form. A `FormKey` is the string passed via
 * `useForm({ key })`, used to look up a form by name from a distant
 * component, namespace persisted drafts, and label errors and
 * DevTools entries. Anonymous `useForm` calls allocate one
 * automatically; you only need to pick one when the form needs
 * stable identity.
 */
export type FormKey = string

/**
 * One validation failure. `path` points at the offending field as a
 * structured array — `['user', 'address', 0, 'line1']` for a nested
 * field, `['']` (the empty-string path) for a form-level error
 * (root `.refine()` messages, `setFormErrors()` entries, server-
 * emitted form banners). `formKey` identifies which form produced
 * the error so a single error list can be routed to multiple forms.
 *
 * Returned by `validate()` / `validateAsync()` / `handleSubmit`'s
 * `onError` callback, and by `parseApiErrors` for server responses.
 */
export type ValidationError = {
  /** Human-readable message describing the failure. */
  message: string
  /**
   * Structured path of the offending field. The empty-string path
   * `['']` is the form-level bucket — the dedicated home for errors
   * that don't belong to any specific field, distinct from the
   * whole-form subtree address `[]`.
   */
  path: (string | number)[]
  /** Identifies which form produced this error. */
  formKey: FormKey
  /**
   * Stable machine identifier for the failure, scoped by prefix:
   *
   * - `atta:` — library-internal codes (see `AttaformErrorCode`).
   * - adapter prefix (e.g. `zod:`) — forwarded from the underlying
   *   schema library's own issue code, when one exists.
   * - consumer-defined — anything else (e.g. `api:duplicate-email`,
   *   `auth:expired-token`). Pick a prefix and stay consistent so
   *   error renderers and tests can branch on `code` instead of
   *   exact-message string matching.
   */
  code: string
}

/** Settled validation result when the form (or subtree) parsed successfully. */
export type ValidationResponseSuccess<TData> = {
  /** The parsed value at the validated subtree (whole form when `validate()` was called without a path). */
  data: TData
  errors: undefined
  success: true
  formKey: FormKey
}
/** Settled validation result when no data could be produced (e.g. a top-level type mismatch). */
export type ValidationResponseErrorWithoutData = {
  data: undefined
  /** Non-empty list of failures. */
  errors: ValidationError[]
  success: false
  formKey: FormKey
}
/** Settled validation result when the parser produced partial data alongside failures. */
export type ValidationResponseErrorWithData<TData> = {
  data: TData
  errors: ValidationError[]
  success: false
  formKey: FormKey
}

/**
 * Settled validation result. Discriminate on `success`:
 *
 * ```ts
 * if (result.success) {
 *   // result.data is the parsed value, errors is undefined
 * } else {
 *   // result.errors is non-empty, data may or may not be set
 * }
 * ```
 */
export type ValidationResponse<TData> =
  | ValidationResponseSuccess<TData>
  | ValidationResponseErrorWithData<TData>
  | ValidationResponseErrorWithoutData

/**
 * Result of resolving the form's default values. Always returns at
 * least the shape derived from the schema; `errors` carry any
 * failures from validating those defaults against the schema.
 */
export type DefaultValuesResponse<TData> =
  | ValidationResponseSuccess<TData>
  | ValidationResponseErrorWithData<TData>

/**
 * Trimmed `ValidationResponse` that omits the `data` payload. Used by
 * `validate()` / `validateAsync()` since consumers usually only need
 * the success flag and error list at those entry points.
 */
export type ValidationResponseWithoutValue<Form> = Omit<ValidationResponse<Form>, 'data'>

/**
 * Sync-or-async return shape for `AbstractSchema.validateAtPath`. The
 * adapter returns the response inline when the schema and the
 * caller's options permit synchronous validation; otherwise a
 * `Promise<T>`. Callers that don't care simply `await` (works for
 * both); callers that DO care (the reshape pre-pass — flicker
 * prevention) branch on `instanceof Promise`.
 */
export type MaybePromise<T> = T | Promise<T>

/**
 * Options accepted by `AbstractSchema.validateAtPath`. Currently a
 * single field; kept as an object for forward-compat with future
 * knobs (e.g. cancellation signals, abort tokens) without breaking
 * the call signature.
 *
 * - `sync`: when `true`, the adapter SHOULD return the response
 *   inline if the schema permits synchronous validation. When the
 *   schema is structurally async (any verdict that resolves only via
 *   a Promise — async refinements, async transforms / pipes — in
 *   whichever library the adapter wraps), the adapter falls back to
 *   a `Promise<T>` — the flag is a preference, not a guarantee.
 *
 *   When omitted or `false`, the adapter is free to use its async
 *   path (matches the historical Promise-returning contract; every
 *   non-reshape callsite uses this default).
 */
export type ValidateOptions = {
  sync?: boolean
}

type GetDefaultValuesConfig<Form> = {
  useDefaultSchemaValues: boolean
  /**
   * Whether to keep schema refinements when deriving slim defaults.
   * `true` (default) — preserve refinements; `false` — strip them so
   * placeholder data lands without immediate construction-time
   * errors. Mirrors `useForm({ strict })`.
   */
  strict?: boolean
  constraints?: DeepPartial<WriteShape<Form>> | undefined
}

/**
 * The contract a schema adapter implements so the form runtime can
 * read defaults, validate, and walk paths against any underlying
 * schema library.
 *
 * Most consumers never touch this type directly — the typed entry
 * points (e.g. `attaform/zod`, `attaform/zod-v3`)
 * wire an adapter automatically. Implement this interface only when
 * adding support for a new schema library (Valibot, ArkType, custom).
 */
export type AbstractSchema<Form, GetValueFormType> = {
  /**
   * Structural fingerprint of the schema. Same shape → same string;
   * different shape → (best-effort) different string.
   *
   * The library uses this to detect schema mismatches at a shared
   * form key: two `useForm({ key: 'x', schema })` calls are allowed
   * to land on the same `FormStore` (the "shared store" semantic),
   * but only when their schemas agree. If the second call's
   * fingerprint differs from the first's, the library emits a
   * dev-mode warning — the first call's schema stays canonical and
   * the second call's schema is silently ignored.
   *
   * Guarantees adapter authors should provide:
   * - **Determinism:** equal shapes at different memory addresses
   *   must produce the same fingerprint. Referential equality fails
   *   99% of the time across files, so reference-identity is not a
   *   substitute.
   * - **Key-order-insensitivity** for record-like shapes (object,
   *   struct) — two shapes with the same keys but different iteration
   *   order must match.
   * - **Order-insensitivity for unbounded unions** — `a | b` and
   *   `b | a` must match (the set of members is what matters, not
   *   their source order).
   *
   * Compromises adapter authors may accept:
   * - Function-valued metadata (refinements, transforms, lazy
   *   defaults) is not stably hashable. Represent it as an opaque
   *   sentinel; two schemas differing only in refinement logic will
   *   look identical. The warning is a footgun catcher, not a
   *   soundness guarantee.
   */
  fingerprint(): string

  getDefaultValues(config: GetDefaultValuesConfig<Form>): DefaultValuesResponse<Form>
  /**
   * Return the schema-prescribed default value at the given path. The
   * runtime uses this to fill structural gaps so every `setValue` write
   * leaves the form satisfying the slim schema (objects/arrays/primitives
   * without refinement-level constraints).
   *
   * Semantics:
   * - **Object property path:** the property's schema default.
   * - **Array element path:** the element default (paths past the
   *   array's current length still resolve — every position resolves
   *   to the same element type).
   * - **Tuple position path:** the position-specific default. Out-of-
   *   range positions return `undefined`.
   * - **Optional/Default/Nullable/Readonly/Catch/Pipe wrappers:** the
   *   inner default.
   * - **Discriminated union:** the first variant's default (matches
   *   `validateAtPath`'s first-success semantic).
   * - **Leaf:** the primitive default (`''`, `0`, `false`, etc., or the
   *   wrapper's `.default(x)` value when present).
   * - **Path doesn't exist in schema:** `undefined`.
   *
   * Adapters may return `undefined` when the path can't be resolved;
   * callers treat that as "don't fill" and fall back to existing data.
   */
  getDefaultAtPath(path: Path): unknown
  /**
   * Give the schema a chance to normalize the consumer's write value
   * before it lands in storage / hits the slim-primitive gate. Each
   * schema library exposes this concept differently — Zod calls it
   * `z.preprocess(fn, inner)`, Yup calls it `.transform()`, Valibot
   * spells it `pipe(transform(fn), inner)` — but the shape is the
   * same: "this input shape gets coerced into that storage shape at
   * the boundary."
   *
   * Runs SYNCHRONOUSLY at the write boundary so storage holds the
   * post-normalization shape. Without this, a schema like `notify:
   * z.preprocess(v => v == null ? defaultVar : v, innerDU)` would
   * let the consumer write `null` and lock storage into `null` —
   * because the gate sees the raw input (which the preprocess wrapper
   * accepts as `unknown`) and storage holds a shape no variant
   * matches.
   *
   * Adapters MUST:
   *   - Return `value` unchanged when no normalization is declared at
   *     the path.
   *   - Return `value` unchanged when the user's normalization fn
   *     returns a `Promise` (async coercion can't run at write time —
   *     validation handles it during parse).
   *   - Let user-thrown errors propagate (the user wrote the fn; we
   *     just tag the path in the wrapper error for diagnostics).
   *
   * Normalization runs when `path` equals the wrapper's exact
   * location. Writes deeper than the wrapper bypass it (a wrapper
   * over the whole subtree can't be invoked from a partial leaf
   * write).
   */
  normalizeWriteValueAtPath(value: unknown, path: Path): unknown
  /**
   * Distinguish a tuple (fixed-length, position-typed) from an
   * unbounded array at `path`. The runtime calls this on every
   * `mergeStructural` / `setAtPathWithSchemaFill` write that descends
   * into an array branch — caching the answer at the schema level
   * replaces the per-write 1M-index probe + sequential probe loop
   * (up to 1024 schema lookups) the runtime previously used.
   *
   * Return values:
   * - `number` → tuple of this structural length. The runtime pads
   *   the consumer to this length and recurses position-by-position.
   * - `null` → unbounded array. The runtime uses the consumer's
   *   length and reuses one element default for every position.
   * - `undefined` → the path doesn't resolve to an array OR the
   *   adapter can't determine the shape. The runtime falls back to
   *   a probe loop in this case (defensive — every built-in adapter
   *   returns `number` or `null`).
   *
   * Wrappers (optional / nullable / default / readonly / catch /
   * pipe / lazy) are peeled transparently before the type check, so
   * `optional(z.tuple([...]))` reports its tuple length.
   */
  arrayShapeAtPath(path: Path): number | null | undefined
  /**
   * Return every sub-schema that could resolve at the given structured
   * path. Multiple results are only expected for discriminated / union
   * branches where the adapter can't decide a single winner until the
   * data lands. `path` is the canonical `Segment[]` — adapters walk it
   * segment-by-segment so literal-dot keys (`['user.name']`) don't
   * collide with the sibling-pair form (`['user', 'name']`).
   */
  getSchemasAtPath(path: Path): AbstractSchema<unknown, GetValueFormType>[]
  /**
   * Validate a subtree (when `path` is provided) or the whole form (when
   * `path` is `undefined`). `path` is the canonical `Segment[]`, not a
   * dotted string — two schemas with otherwise-colliding dotted forms
   * (`['user.name']` vs `['user', 'name']`) stay distinct at the
   * adapter boundary.
   *
   * Return type is `MaybePromise<ValidationResponse>`:
   * - With `options.sync === true` AND a sync-capable schema, the
   *   adapter SHOULD return the response inline (`T`). This lets the
   *   runtime batch error writes with a coincident form-value
   *   mutation in a single Vue reactive flush — preventing the `{}`
   *   flicker observable during DU variant reshape.
   * - With `options.sync === true` AND an async-only schema (any
   *   verdict that resolves only via a Promise), the adapter MUST
   *   fall back to `Promise<T>`. The flag is a preference, not a
   *   guarantee; sync isn't always achievable.
   * - With `options.sync` omitted or `false`, the adapter SHOULD
   *   return `Promise<T>` (matches the historical contract — every
   *   non-reshape callsite uses this default and immediately
   *   `await`s the result).
   *
   * Callers that don't care simply `await` (works for both arms);
   * callers that need to detect sync-vs-async branch on
   * `instanceof Promise`. Adapters MUST NOT throw — errors are
   * returned as a `success: false` response with a populated
   * `errors` array.
   */
  validateAtPath(
    data: unknown,
    path: Path | undefined,
    options?: ValidateOptions
  ): MaybePromise<ValidationResponse<Form>>
  /**
   * Sync sister to `getSchemasAtPath` / `validateAtPath`. Returns the
   * set of primitive `typeof`-style kinds the path's leaf schema
   * accepts at write time. Wrappers (optional / nullable / default /
   * refinement / transform / pipe / readonly / catch / lazy) are
   * peeled; refinement-level constraints (format checks like email /
   * uuid, min/max length, enum membership, literal equality, regex)
   * are IGNORED — they're a validation-time concern.
   *
   * Used by `setValueAtPath` to gate writes synchronously without
   * round-tripping through async `validateAtPath`. The returned set
   * unions across union branches and intersects across intersection
   * sides.
   *
   * Conventions:
   * - Empty set → no kind admitted. The runtime gate rejects every
   *   write to the path. Surfaces for `never`-typed schemas AND for
   *   paths that don't resolve in the schema (typo / unknown leaf).
   * - Permissive set (every kind) → "unknown / unconstrained." The
   *   gate accepts any value. Surfaces for `any` / `unknown` / `void`
   *   and the lazy-peel-failure case where the adapter can't
   *   introspect the schema.
   * - For string-valued enums: returns `{'string'}`. For numeric
   *   enums: `{'number'}`.
   * - For literal types: returns `{primitiveKindOf(literalValue)}`.
   * - For object / array containers: `{'object'}` / `{'array'}`. The
   *   runtime walker recurses into entries / elements at write time.
   * - For nullable / optional wrappers: adds `'null'` / `'undefined'`
   *   to the inner's set.
   */
  getSlimPrimitiveTypesAtPath(path: Path): Set<SlimPrimitiveKind>
  /**
   * Return `true` iff `path` resolves to a **leaf** in the schema — a
   * path whose slim primitive set contains only primitive kinds (no
   * `object`, `array`, `map`, `set`). The runtime proxies (`form.values`,
   * `form.errors`, `form.fields`) query this at every step to decide
   * between **descend into a sub-proxy** (container) and **terminate
   * with a leaf value** (leaf).
   *
   * The leaf-aware branching is what kills the FIELD_STATE_KEYS
   * shadowing problem: reserved leaf-prop names (`dirty`, `errors`,
   * `valid`, …) inject only at the FieldState terminal, not at
   * every depth. A schema field literally named `dirty` at depth ≥ 2
   * stays reachable as a sub-proxy or leaf in its own right.
   *
   * Semantics:
   * - **Object / Array / Map / Set** at any wrapper layer → `false`
   *   (container; descend further).
   * - **Primitive** (string/number/boolean/bigint/symbol/null/undefined/
   *   date/function) → `true`. `'date'` counts as a leaf (don't drill
   *   into `Date`). `'function'` is a leaf for the same reason — opaque
   *   value.
   * - **Optional / Nullable / Default / Catch** wrappers transparent —
   *   adds `'null'` / `'undefined'` to the inner kind set without
   *   changing the leaf classification.
   * - **Discriminated union root** → `false` (variants are objects;
   *   the kind set contains `'object'`).
   * - **DU discriminator key** → `true` (the literal type resolves to
   *   `{'string'}` / `{'number'}`).
   * - **DU variant-only key** → `true` if it resolves to a primitive
   *   in any variant; schema-static (does NOT query live storage to
   *   decide which variant is active).
   * - **Empty path (root)** → `false` (root is the form-as-object).
   * - **Path doesn't exist in schema** → `false`. The proxy descends
   *   permissively; reads of leaf props at the unknown path return
   *   `undefined` from the underlying store. Treating unknown paths
   *   as containers preserves the schema's authority and avoids
   *   re-introducing shadowing on typos.
   *
   * Adapters MAY cache results per-path — `isLeafAtPath` will be
   * called on every proxy `get` trap hit. The reference implementation
   * memoises a `Map<PathKey, boolean>` keyed by `canonicalizePath(path).key`,
   * lifetime tied to the adapter (one per `useForm()` call).
   */
  isLeafAtPath(path: Path): boolean
  /**
   * Return `true` if the leaf at `path` is required — i.e. the schema
   * does NOT admit "empty" via `.optional()`, `.nullable()`,
   * `.default(N)`, or `.catch(N)` at the leaf or any wrapper.
   *
   * Used by the submit / validate path to surface a "No value supplied" error
   * when a field is in the form's `blankPaths` set (the user
   * cleared it or never answered) AND the schema treats the field as
   * required. Without this, a strict numeric leaf would silently
   * accept the slim default (`0`) for an unanswered field — the
   * "public-housing" footgun where `$0 income` passes validation.
   *
   * Semantics:
   * - **Optional / Nullable / Default / Catch** at any wrapper layer
   *   (root or nested) → `false`. The schema author opted into
   *   accepting empty.
   * - **Readonly / Pipe / Lazy** wrappers are transparent — peel and
   *   re-check the inner schema.
   * - **Union / Discriminated union** → `false` if ANY branch admits
   *   empty (the union accepts what the most permissive branch
   *   accepts). This matches the parse-time "first success wins"
   *   semantic of `validateAtPath`.
   * - **Intersection** → `true` if EITHER side requires the path
   *   (intersection requires both sides to accept; if one rejects
   *   empty, the intersection rejects empty).
   * - **Path doesn't exist in schema** → `false` (can't enforce
   *   what we don't know about).
   * - **Empty path (root)** → `true` (the root form is always
   *   required as an object).
   *
   * Refinement-level constraints (length / format / custom predicates)
   * are NOT consulted here — those run at parse time inside
   * `validateAtPath` and surface as schema errors regardless.
   * `isRequiredAtPath` only answers the "is this leaf at all
   * required?" question; the refinements layer on top.
   */
  isRequiredAtPath(path: Path): boolean
  /**
   * If the schema at `path` is (or wraps) a discriminated union,
   * return its discriminator key plus a `getVariantDefault(value)`
   * lookup — otherwise `undefined`. Wrappers (optional, default,
   * nullable, readonly, pipe, lazy, catch) are peeled transparently.
   *
   * The runtime uses this for two related reshapes that share the
   * same lookup:
   *
   *   1. **Discriminator-key write** — the runtime calls this with
   *      the parent path. If the returned `discriminatorKey` matches
   *      the path's last segment, the write changes which variant is
   *      active; the parent storage is replaced with the matching
   *      variant's slim default so the OLD variant's keys (e.g.
   *      `address` after switching to `sms`) don't leak.
   *
   *   2. **Whole-union write** — the runtime calls this with the
   *      path itself. If the returned info exists and the consumer's
   *      value carries the discriminator key, the merge uses the
   *      matching variant's default instead of the first-variant
   *      fallback that `getDefaultAtPath` returns for unions.
   *
   * Adapters that don't model discriminated unions can return
   * `undefined` unconditionally; the runtime reshape is a no-op
   * without this hook.
   */
  getUnionDiscriminatorAtPath(path: Path): UnionDiscriminatorContext | undefined

  /**
   * Return the resolved field metadata for the schema node at `path`
   * — label, description, placeholder, plus the full registered
   * payload as `meta` for consumer-augmented keys. Reads through the
   * shared cross-adapter field-meta store and applies these one-way
   * fallbacks:
   *
   *   - `label`:       registry payload → `humanize(lastSegment)`
   *   - `description`: registry payload → `schema.description`
   *                    (`.describe()` value) → `undefined`
   *   - `placeholder`: registry payload → `undefined`
   *   - `meta`:        registry payload (frozen) — empty object when
   *                    nothing was registered
   *
   * `path` is the canonical `Segment[]`. The empty path resolves to
   * the root schema's metadata. Multiple candidates (DU branches)
   * resolve against the first candidate to match the existing
   * first-success precedent in `getDefaultAtPath` /
   * `validateAtPath` — schema authors register on the union root
   * for shared metadata, on individual branches for variant-
   * specific metadata.
   *
   * Optional. The runtime treats a missing implementation as a
   * stub that returns `EMPTY_RESOLVED_FIELD_META` — so adapters
   * that don't model field metadata yet can omit it; consumers
   * see humanized fallbacks for `label`, undefined elsewhere.
   */
  getFieldMetaAtPath?(path: Path): ResolvedFieldMeta

  /**
   * Return `true` if `validateAtPath` MAY have to run asynchronously
   * to surface every error this schema can produce. The runtime uses
   * this at construction to decide whether to schedule a one-shot
   * full-form async validation: when `false` (or omitted), the
   * construction-time sync seed is the authoritative result and no
   * extra microtask is spent; when `true`, an async pass is queued
   * so any async-only verdicts (refinements / transforms / pipes
   * that resolve only via a Promise) surface without waiting for a
   * user mutation.
   *
   * Optional. The runtime treats a missing implementation as
   * `() => false`, so adapters that don't model async work — or
   * don't yet support detection — can omit it; async-only errors
   * then fall back to firing on first user mutation, matching the
   * pre-detection behavior. Detection is best-effort.
   *
   * For per-path queries, compose with `getSchemasAtPath(path)`:
   * each candidate sub-schema exposes its own
   * `needsAsyncValidation`, so a caller asking "does the cargo
   * subtree contain async work?" can union the per-candidate
   * answers without a separate top-level overload.
   */
  needsAsyncValidation?(): boolean
}

/**
 * Adapter-returned info for a discriminated union — its discriminator
 * key plus a function that maps a discriminator literal to the slim
 * default of the matching variant. Returned by
 * `AbstractSchema.getUnionDiscriminatorAtPath`.
 */
export type UnionDiscriminatorContext = {
  /**
   * The union's discriminator key — the property name whose literal
   * value selects the variant (e.g. `'channel'` for a union split on
   * `{ channel: 'sms' | 'email' }`).
   */
  readonly discriminatorKey: string
  /**
   * Slim default for the variant whose discriminator literal equals
   * `value`. Returns `undefined` if no variant matches — the runtime
   * skips the reshape and falls back to a plain write.
   */
  getVariantDefault(value: unknown): unknown
  /**
   * Returns `true` iff `value` is a literal recognised by one of the
   * discriminator's variants. Used by reshape to decide whether to
   * seek a variant default or emit a stub state. NOT used at the
   * runtime write gate — consumer-side value validity is a
   * validation-time concern.
   */
  isVariantSelected(value: unknown): boolean
}

/**
 * The set of primitive "kinds" the slim-primitive write contract
 * recognises. Drawn from `typeof` plus a few well-known reference
 * shapes (`Date`, `Array`, `Map`, `Set`, plain `object`, `null`).
 *
 * The runtime gate's `slimKindOf(value)` returns one of these for a
 * value; the adapter's `getSlimPrimitiveTypesAtPath(path)` returns
 * the set of kinds the path's leaf schema accepts. A write is gated
 * by `accepted.has(slimKindOf(value))`.
 */
export type SlimPrimitiveKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'bigint'
  | 'date'
  | 'null'
  | 'undefined'
  | 'object'
  | 'array'
  | 'symbol'
  | 'function'
  | 'map'
  | 'set'

/**
 * The "no result yet" status returned by the reactive `validate()` ref
 * while a validation run is in flight.
 *
 * Narrow against `pending` to access the settled fields:
 *
 * ```ts
 * const status = form.validate()
 * watchEffect(() => {
 *   if (status.value.pending) return
 *   // status.value.success / status.value.errors are now safe to read
 * })
 * ```
 */
export type PendingValidationStatus = {
  readonly pending: true
  readonly errors: undefined
  readonly success: false
  readonly formKey: FormKey
}

/** Settled status of a reactive `validate()` call. Mirrors the latest result. */
export type SettledValidationStatus<Form> = {
  readonly pending: false
} & ValidationResponseWithoutValue<Form>

/**
 * The value type of the ref returned by `validate()`. Discriminate on
 * `pending` to switch between in-flight and settled states.
 */
export type ReactiveValidationStatus<Form> = PendingValidationStatus | SettledValidationStatus<Form>

/**
 * What to do when a submit attempt fails validation. The library can
 * focus and/or scroll the first errored field into view without
 * wiring an `onError` callback yourself. Off by default.
 *
 * - `'none'` (default): no automatic UI nudge.
 * - `'focus-first-error'`: focus the first errored field's first
 *   visible element (with `preventScroll: true` so it doesn't fight
 *   any `'scroll-to-first-error'` choice you make).
 * - `'scroll-to-first-error'`: scroll that element into view.
 * - `'both'`: scroll first, then focus.
 *
 * If no errored field has a currently mounted, visible element, the
 * policy silently no-ops.
 */
export type OnInvalidSubmitPolicy = 'none' | 'focus-first-error' | 'scroll-to-first-error' | 'both'

/**
 * When per-field VALIDATION runs. Only validation timing varies per
 * mode; storage commit timing is the directive's concern (the
 * default `<input v-register>` commits per keystroke; `.lazy` defers
 * to blur).
 *
 * - `'change'` (default): every committed write schedules a
 *   validation for the affected path. With `debounceMs: 0` (also the
 *   default) the run is synchronous in the write handler;
 *   positive `debounceMs` coalesces rapid bursts.
 * - `'blur'`: validate immediately when the user tabs away from a
 *   registered field. No debounce — `debounceMs` is rejected by the
 *   type.
 * - `'submit'`: no live validation. `handleSubmit` and explicit
 *   `validate()` / `validateAsync()` calls are the only validation
 *   surfaces. `debounceMs` is rejected by the type.
 */
export type ValidateOn = 'change' | 'blur' | 'submit'

/**
 * Validation timing config — `validateOn` is the trigger, `debounceMs`
 * the wait (after the last committed write) before the next
 * validation run fires. `debounceMs` ONLY governs validation;
 * `setValueWithInternalPath` commits to `form.values` immediately
 * regardless of debounce. (How OFTEN the directive forwards writes
 * to storage is the directive's concern — default `<input
 * v-register>` commits per keystroke; `<input v-register.lazy>`
 * defers to the blur `change` event.)
 *
 * `debounceMs` is only meaningful with `validateOn: 'change'` (the
 * default); `'blur'` and `'submit'` ignore the wait entirely (blur
 * fires validation immediately on focus-out; submit is its own
 * trigger). The discriminated union below makes pairing `debounceMs`
 * with `'blur'` / `'submit'` a TS error instead of a silent runtime
 * drop.
 *
 * Pass `debounceMs: 0` (the default) to disable validation
 * debouncing — every committed write triggers a validation pass with
 * no `setTimeout` indirection. Schema work itself still rides
 * `Promise.resolve().then(validateAtPath)` — async but microtask, so
 * errors land on the next tick. Set `debounceMs` to a positive
 * number to coalesce rapid bursts (useful for slow async adapters or
 * for smoothing inline feedback under heavy typing).
 */
export type ValidateOnConfig =
  | {
      /** Validation trigger. Default `'change'`. */
      validateOn?: 'change'
      /**
       * Milliseconds to wait after the last committed write before
       * running validation. Default `0` (validation runs synchronously
       * after the write; no `setTimeout`). Set to a positive number
       * to coalesce rapid bursts into a single validation pass.
       *
       * Note: this is purely the validation debounce. Storage commits
       * happen at the directive's listener (per-keystroke for
       * `<input v-register>`, per-blur for `<input v-register.lazy>`)
       * — `debounceMs` doesn't change either.
       */
      debounceMs?: number
    }
  | {
      /** Validation trigger. */
      validateOn: 'blur' | 'submit'
      /** `debounceMs` is not allowed with `'blur'` or `'submit'`. */
      debounceMs?: never
    }

/**
 * Built-in storage backends:
 *
 * - `'local'` — browser `localStorage` (persists across tabs and reloads).
 * - `'session'` — browser `sessionStorage` (cleared when the tab closes).
 * - `'indexeddb'` — IndexedDB via a zero-dependency wrapper (handles
 *   structured-cloneable data; suitable for larger drafts).
 *
 * For anything else (encrypted storage, a native bridge, a cookie
 * store) pass a custom `FormStorage` object instead.
 */
export type FormStorageKind = 'local' | 'session' | 'indexeddb'

/**
 * Custom persistence backend. Implement this when none of the built-in
 * `'local'` / `'session'` / `'indexeddb'` backends fit (e.g. encrypted
 * storage, a cross-window broadcast layer, or a native mobile bridge).
 *
 * All methods are async. Pass values through unchanged — `getItem`
 * should return whatever `setItem` was given, including non-string
 * values. The library handles serialization for the built-in
 * `'local'` / `'session'` backends; custom adapters can store the
 * value directly if their backing store accepts structured data.
 *
 * `listKeys(prefix)` returns every key starting with `prefix`. The
 * library uses it on mount to clean up entries left over from older
 * schema versions (each persisted entry carries a schema fingerprint
 * suffix; mismatched entries are dropped automatically).
 */
export type FormStorage = {
  /** Fetch the value previously stored under `key`. Resolve to `null`/`undefined` for misses. */
  getItem(key: string): Promise<unknown>
  /** Persist `value` under `key`. */
  setItem(key: string, value: unknown): Promise<void>
  /** Remove the entry at `key`. No-op if not present. */
  removeItem(key: string): Promise<void>
  /** Return every key in this backend whose name starts with `prefix`. */
  listKeys(prefix: string): Promise<string[]>
}

/**
 * What to include when persisting:
 *
 * - `'form'` (default) — only the form value. Errors get repopulated
 *   by validation on reload anyway.
 * - `'form+errors'` — also persist the current error list. Useful when
 *   the error context is expensive to recompute (e.g. cross-field
 *   refinements that depend on server data).
 */
export type PersistIncludeMode = 'form' | 'form+errors'

/**
 * Per-write metadata. Used internally to flag which writes should
 * reach the persistence layer (e.g. only writes from elements opted
 * into persistence via `register(path, { persist: true })`).
 *
 * Custom directive integrations may set `persist: true` to forward
 * a write to the configured storage adapter; otherwise leave unset.
 */
export type WriteMeta = {
  /** When `true`, this write is forwarded to the configured persistence backend. */
  readonly persist?: boolean
  /**
   * When `true`, the path being written is added to the FormStore's
   * `blankPaths` set — meaning storage holds a real, schema-
   * conformant value (the slim default) but the UI should display the
   * field as empty. The next write to that path WITHOUT this flag
   * implicitly removes the path from the set (the user typed something
   * real). Internal — set by `markBlank()` on the register
   * binding and by the `unset` translation in `setValue` / `reset` /
   * `useAbstractForm` construction. Don't set from consumer code.
   */
  readonly blank?: boolean
  /**
   * When `true`, the discriminator-aware variant reshape inside
   * `setValueAtPath` is skipped for this write. Internal — set by
   * the reshape itself when re-entering with the new variant default
   * so the literal discriminator inside the default doesn't trigger
   * an infinite loop. Don't set from consumer code.
   */
  readonly skipDiscriminatorReshape?: boolean
  /**
   * Hint about an array structural mutation, set by `field-arrays.ts`
   * helpers so `setValueAtPath` can surgically clear variant memory
   * for indices the operation invalidated. Without this hint, a raw
   * whole-array `setValue(arrayPath, [...])` clears all memory under
   * the array (the runtime can't tell which indices stayed put).
   * Internal — don't set from consumer code.
   */
  readonly arrayOp?:
    | { readonly kind: 'shift-from'; readonly index: number }
    | { readonly kind: 'shift-range'; readonly fromIndex: number; readonly toIndex: number }
    | { readonly kind: 'swap'; readonly a: number; readonly b: number }
    | { readonly kind: 'replace-at'; readonly index: number }
  /**
   * Per-instance config overrides threaded through writes so each
   * `useForm({ key })` callsite honors its own `validateOn` /
   * `debounceMs` / `rememberVariants` even when sharing a FormStore
   * with sibling calls (e.g., a modal and main form rendering the
   * same logical form). Internal — set by `buildFormApi` from
   * the per-instance options bag; the store reads each field with
   * fallback to its construction-time defaults.
   */
  readonly instance?: {
    readonly validateOn?: ValidateOn
    readonly debounceMs?: number
    readonly rememberVariants?: boolean
  }
}

/**
 * Undo/redo configuration passed via `useForm({ history })`.
 *
 * - `true` — enable with the default snapshot cap (`max: 50`).
 * - `{ max }` — enable and tune the bounded snapshot stack size.
 *
 * When enabled, every mutation pushes a snapshot; `undo()` /
 * `redo()` walk the stacks. `reset()` clears history.
 */
export type HistoryConfig = true | { max?: number }

/**
 * Full options bag for `useForm({ persist })`. Use this when you need
 * to override defaults beyond picking the backend.
 *
 * For backend-only setup, the shorthand forms are equivalent:
 *
 * ```ts
 * useForm({ persist: 'local' })
 * // same as
 * useForm({ persist: { storage: 'local' } })
 * ```
 */
export type PersistConfigOptions = {
  /**
   * Where to persist. Pass `'local'` / `'session'` / `'indexeddb'` to
   * use a built-in backend, or a custom `FormStorage` object for
   * anything else. The built-in backends are loaded on demand, so
   * picking `'local'` doesn't pull in IndexedDB code.
   */
  storage: FormStorageKind | FormStorage

  /**
   * Storage key namespace. Defaults to `attaform:${formKey}`.
   * Override when you need a custom prefix (e.g. multi-tenant apps
   * where the same form key may exist per-tenant).
   */
  key?: string

  /**
   * How long to wait after the last mutation before writing. Default
   * `300` ms.
   *
   * Pass `0` to disable debouncing — every form change writes to the
   * storage adapter immediately, no `setTimeout` indirection. Almost
   * never the right choice for production (the storage adapter sees
   * every keystroke), but useful for tests or for diagnosing perceived
   * lag.
   */
  debounceMs?: number

  /**
   * What to persist. `'form'` (default) is sufficient for most cases —
   * fresh validation on reload repopulates errors. Pick `'form+errors'`
   * when the error state is expensive to recompute (e.g. server-side
   * cross-field validation).
   */
  include?: PersistIncludeMode

  /**
   * When `true` (default), the persisted entry is wiped after
   * `handleSubmit`'s submit callback resolves successfully. Set to
   * `false` if you need the draft to survive across submissions.
   */
  clearOnSubmitSuccess?: boolean
}

/**
 * Persistence configuration for `useForm({ persist })`. Off by default —
 * with no config, the form does no reads, no writes, and pulls in no
 * storage code.
 *
 * Three input forms; pick the one that reads best at the call site:
 *
 * ```ts
 * // shorthand: built-in backend
 * useForm({ persist: 'local' })
 *
 * // shorthand: custom adapter
 * useForm({ persist: encryptedStorage })
 *
 * // full options bag
 * useForm({ persist: { storage: 'local', debounceMs: 500 } })
 * ```
 *
 * Per-field opt-in: setting `persist` is necessary but not sufficient.
 * Each field that should actually persist also needs
 * `register('foo', { persist: true })` — sensitive fields must opt in
 * explicitly so they don't accidentally land in client-side storage.
 */
export type PersistConfig = FormStorageKind | FormStorage | PersistConfigOptions

/**
 * Configuration object passed to `useForm`. All fields except `schema`
 * are optional.
 *
 * ```ts
 * const form = useForm({
 *   schema: signupSchema,
 *   defaultValues: { email: '' },
 *   validateOn: 'change',
 *   debounceMs: 200,
 *   persist: 'local',
 * })
 * ```
 */
export type UseFormConfiguration<
  Form extends GenericForm,
  GetValueFormType,
  Schema extends AbstractSchema<Form, GetValueFormType>,
  DefaultValues extends DeepPartial<DefaultValuesShape<Form>>,
> = {
  /**
   * The schema describing the form's shape and validation rules.
   * Typed entry points like `attaform/zod` accept the
   * underlying library's schema directly and wrap an adapter; the
   * abstract entry point accepts any object implementing
   * `AbstractSchema`.
   *
   * For schemas that depend on the form's identity, pass a factory
   * `(key) => schema` instead — the library calls it once per form.
   */
  schema: Schema | ((key: FormKey) => Schema)
  /**
   * Optional identifier for this form. Omit for one-off forms; the
   * library allocates a unique key automatically (SSR-safe, stable
   * across server→client hydration).
   *
   * Pass a string key when the form needs identity:
   * - to look it up from a distant component via `injectForm(key)`;
   * - to share state across components (multiple `useForm({ key })`
   *   calls with the same key resolve to the same form);
   * - to give DevTools and validation errors a recognisable label;
   * - to namespace persisted drafts.
   *
   * Keys starting with `__atta:` are reserved for internal use and
   * throw `ReservedFormKeyError` if passed.
   */
  key?: FormKey
  /**
   * Initial values applied over the schema's defaults. Each field
   * falls back to the schema default (or the primitive default for
   * the slot's type) when not provided here.
   *
   * Values must satisfy the slim primitive type at each path
   * (string / number / boolean / Date / etc.) but do NOT have to
   * satisfy refinement-level constraints (format checks, enum
   * membership, length / range bounds). Refinement-invalid defaults
   * pass through and surface as field errors — this lets you
   * rehydrate stale saved data without losing the user's input.
   */
  defaultValues?: DefaultValues
  /**
   * Whether to validate default values at construction. Default
   * `true`.
   *
   * - `true` (default): the schema is run against the derived
   *   defaults immediately; any failures populate `form.errors` from
   *   the first frame. The UI decides when to *show* errors — gate
   *   on `form.fields.<path>.touched`, `form.meta.submitCount`, etc.
   * - `false`: refinements are stripped during defaults derivation
   *   and construction-time validation is skipped. Useful for
   *   multi-step wizards, field arrays seeded with placeholder
   *   rows, or any form intentionally mounting with incomplete data.
   *
   * Runtime validation (per-field on edit, full-form on submit) is
   * identical regardless of this flag.
   */
  strict?: boolean
  /**
   * Automatic UI nudge on submit-validation failure. Fires after
   * errors are populated and before your `onError` callback runs.
   * Default `'none'`.
   *
   * - `'focus-first-error'`: focus the first errored field's first
   *   visible element (without scrolling).
   * - `'scroll-to-first-error'`: scroll it into view.
   * - `'both'`: scroll, then focus.
   *
   * If no errored field has a currently-mounted, visible element,
   * the policy silently no-ops.
   */
  onInvalidSubmit?: OnInvalidSubmitPolicy

  /**
   * When per-field VALIDATION runs (the directive's listener controls
   * how often storage commits — per keystroke by default, per blur
   * with `.lazy`). Default `'change'`. See `ValidateOn` for mode
   * semantics.
   *
   * The strict public `useForm` signature wraps this type in an
   * intersection with `ValidateOnConfig`, which enforces that
   * `debounceMs` is only allowed under `'change'`. Internal callers
   * (adapters, hydration paths) work with the loose form below.
   */
  validateOn?: ValidateOn
  /**
   * Milliseconds to wait after the last committed write before
   * running validation. Default `0` (validation fires synchronously
   * after the write; no `setTimeout`). Set to a positive number to
   * coalesce rapid bursts. Ignored under `validateOn: 'blur'` and
   * `'submit'`.
   *
   * This is purely a VALIDATION debounce — storage commits are the
   * directive's concern (per keystroke for `<input v-register>`,
   * per blur for `<input v-register.lazy>`).
   */
  debounceMs?: number

  /**
   * Opt-in persistence of the form's draft state. Off by default —
   * with no config, no reads, no writes, no storage code is loaded.
   *
   * Three input forms; pick the one that reads best:
   *
   * ```ts
   * useForm({ persist: 'local' })            // built-in backend
   * useForm({ persist: encryptedStorage })   // custom backend
   * useForm({ persist: { storage: 'local', debounceMs: 500 } })
   * ```
   *
   * Per-field opt-in is required: every field that should actually
   * persist needs `register(path, { persist: true })`. Without any
   * opt-ins, the form mounts but never writes to storage — and a
   * dev-mode warning surfaces the misconfiguration. This guard
   * prevents sensitive fields from accidentally leaking to
   * client-side storage.
   *
   * Switching backends across reloads (e.g. `'local'` → `'session'`)
   * automatically clears the previous backend's entry so old drafts
   * don't orphan.
   */
  persist?: PersistConfig

  /**
   * Opt-in undo/redo. Off by default. `true` enables with a 50-snapshot
   * cap; `{ max: N }` tunes the cap.
   *
   * Every mutation pushes a snapshot. `undo()` pops one; `redo()`
   * replays it. `reset()` clears history. Reactive flags
   * `state.canUndo` / `state.canRedo` / `state.historySize` reflect
   * the current stack.
   */
  history?: HistoryConfig

  /**
   * Whether to remember the typed state of each discriminated-union
   * variant across switches. Default `true`.
   *
   * When `true`, switching `notify.channel` from `email` (with
   * `address: 'foo@bar.com'`) to `sms` and back lands on
   * `address: 'foo@bar.com'` again — the runtime snapshots the
   * outgoing variant's subtree on switch-out and restores the
   * incoming variant's prior subtree on switch-in. Each
   * discriminated union at every nesting depth is independently
   * memorized.
   *
   * Set to `false` to drop the outgoing variant's typed state on
   * every switch (the data is gone). The new variant initializes
   * from its slim default.
   *
   * Memory is in-memory only and does not survive reload. Persisted
   * state restores values into form storage on hydration, but
   * variant memory starts empty — the first discriminator switch
   * after reload loses any persisted typing in the outgoing variant.
   * Consumers needing cross-session continuity must persist beyond
   * the variant boundary themselves.
   *
   * `reset()` clears variant memory. `resetField(path)` clears any
   * memory entry whose union path equals or sits under `path`.
   */
  rememberVariants?: boolean
  /**
   * Schema-driven coercion of user-typed DOM values at the v-register
   * directive layer. Per-form override of the plugin-level
   * `AttaformDefaults.coerce`.
   *
   * - `true` / `undefined` — runs the built-in `defaultCoercionRules`.
   * - `false` — disables coercion; the slim gate rejects mismatches.
   * - `CoercionRegistry` — a custom array of entries (REPLACES, not
   *   merges, the plugin defaults). Spread `defaultCoercionRules` to
   *   extend.
   *
   * Coercion applies ONLY to user-typed DOM values. Programmatic
   * writes (`form.setValue`, `setValueWithInternalPath`) are NEVER
   * coerced.
   */
  coerce?: boolean | CoercionRegistry
  /**
   * Per-form override of the `shouldShowErrors` heuristic that drives
   * `field.showErrors` and `form.meta.showErrors`. Falls back to
   * `AttaformDefaults.shouldShowErrors`, then to the library default
   * (`defaultShouldShowErrors`). See `AttaformDefaults.shouldShowErrors`
   * for the resolution rules and predicate signature.
   *
   * Boolean shorthand: `true` → always show *when errors exist*;
   * `false` → never show.
   */
  shouldShowErrors?: ShouldShowErrorsConfig
}

/**
 * App-level defaults applied to every `useForm` call. Set these once
 * per app via `createAttaform({ defaults })` (bare Vue) or
 * `attaform.defaults` (Nuxt module).
 *
 * Resolution order (per-form wins):
 *
 *   useForm({ ... })  >  createAttaform({ defaults })  >  library default
 *
 * `validateOn` and `debounceMs` resolve per-field — set the debounce
 * globally while still overriding the trigger per form:
 *
 * ```ts
 * createAttaform({
 *   defaults: { debounceMs: 100 },
 * })
 * // later
 * useForm({ schema, validateOn: 'blur' })
 * // → { validateOn: 'blur', debounceMs: <ignored under blur> }
 * ```
 *
 * Note: per the discriminated union, `debounceMs` only takes effect
 * when `validateOn` is `'change'` (or omitted). Setting it as an
 * app-level default is fine — forms that switch to `'blur'` /
 * `'submit'` simply ignore the inherited `debounceMs`.
 *
 * `schema`, `key`, `defaultValues`, and `persist` are not configurable
 * here — they belong on the per-form call.
 */
export type AttaformDefaults = {
  /** Default for `useForm({ strict })`. Default `true`. */
  strict?: boolean
  /** Default for `useForm({ onInvalidSubmit })`. */
  onInvalidSubmit?: OnInvalidSubmitPolicy
  /** Default for `useForm({ validateOn })` — when validation runs. */
  validateOn?: ValidateOn
  /**
   * Default for `useForm({ debounceMs })` — ms to wait after the last
   * input event before re-running validation. Only meaningful when
   * `validateOn` resolves to `'change'`. Default `0` (synchronous).
   */
  debounceMs?: number
  /** Default for `useForm({ history })`. */
  history?: HistoryConfig
  /** Default for `useForm({ rememberVariants })`. */
  rememberVariants?: boolean
  /**
   * Default for `useForm({ coerce })`. Schema-driven coercion of
   * user-typed DOM values at the v-register directive layer.
   *
   * - `true` (default) — runs the built-in `defaultCoercionRules`
   *   (`string→number`, `string→boolean`).
   * - `false` — disables coercion globally; the slim-primitive gate
   *   rejects type mismatches with its existing dev-warn instead.
   * - `CoercionRegistry` — a custom array of `CoercionEntry` records.
   *   Spread `defaultCoercionRules` to extend rather than replace:
   *   `[...defaultCoercionRules, defineCoercion({ ... })]`.
   *
   * Coercion applies ONLY to user-typed DOM values flowing through
   * the directive's assigner. Programmatic writes (`form.setValue`,
   * `setValueWithInternalPath`) are NEVER coerced — they're
   * authoritative writes whose strict typing is on the caller.
   */
  coerce?: boolean | CoercionRegistry
  /**
   * Default for `useForm({ shouldShowErrors })`. Centralised heuristic
   * that drives `field.showErrors` (and `form.meta.showErrors`) — a
   * boolean that gates whether a path's errors are *ready* to render.
   *
   * Resolution order (per-form wins):
   *
   *   useForm({ shouldShowErrors })  >  AttaformDefaults  >  library default
   *
   * The library default reads "show after the first submit attempt OR
   * after the field has been interacted with AND changed":
   *
   * ```ts
   * (field, formMeta) =>
   *   formMeta.submitCount > 0 || (field.touched === true && field.dirty)
   * ```
   *
   * Compose with the library default via the public
   * `defaultShouldShowErrors` export. Boolean shorthand is supported:
   * `true` → always show *when errors exist*; `false` → never show. The
   * predicate is invoked only when `errors.length > 0`, so authors
   * don't re-check inside.
   *
   * The predicate's args are `Omit`'d of `showErrors` / `firstError`
   * to prevent recursive predicates — those are derived FROM this
   * predicate, so reading them inside would be a self-reference.
   */
  shouldShowErrors?: ShouldShowErrorsConfig
}

export type FormStore<TData extends GenericForm> = Map<FormKey, TData>

export type FormSummaryValue = {
  originalValue: unknown
  previousValue: unknown
  currentValue: unknown
  pristine: boolean
  dirty: boolean
}
export type FormSummaryValueRecord = Record<string, FormSummaryValue>
export type FormSummaryStore = Map<FormKey, FormSummaryValueRecord>

/**
 * Callback invoked by `handleSubmit` after the form parses successfully.
 * Receives the strictly-typed parsed value — refinements have run, so
 * enum / literal / format constraints are honoured.
 */
export type OnSubmit<Form extends GenericForm> = (form: Form) => void | Promise<void>

/**
 * Callback invoked by `handleSubmit` when validation fails. Receives
 * the full list of errors. Bind this when you want to react to
 * submit failures explicitly (alongside or instead of the
 * automatic `onInvalidSubmit` UI nudge).
 */
export type OnError = (error: ValidationError[]) => void | Promise<void>

/**
 * Predicate that drives `field.showErrors` (and `form.meta.showErrors`).
 * Receives the field's reactive state plus the form's reactive meta;
 * returns `true` to render the field's errors, `false` to keep them
 * hidden. The framework gates the call on `errors.length > 0`, so
 * authors don't re-check error presence inside.
 *
 * Both arguments are `Omit`'d of `showErrors` / `firstError` — those
 * are derived FROM this predicate, so reading them inside would be a
 * self-reference. The omit is enforced at the type level AND at
 * runtime: the keys literally are not present on the objects passed
 * in, so `as` casting in TS or vanilla-JS bypass cannot create a
 * cycle.
 *
 * The library default — `defaultShouldShowErrors` — is publicly
 * exported so a layered predicate can compose with it:
 *
 * ```ts
 * import { defaultShouldShowErrors } from 'attaform'
 *
 * useForm({
 *   schema,
 *   shouldShowErrors: (field, formMeta) =>
 *     field.path[0] === 'urgent' || defaultShouldShowErrors(field, formMeta),
 * })
 * ```
 */
export type ShouldShowErrors = (
  field: Omit<FieldState, 'showErrors' | 'firstError'>,
  formMeta: Omit<FormMeta, 'showErrors' | 'firstError'>
) => boolean

/**
 * Configuration shape for `shouldShowErrors`. A predicate function or
 * a boolean shorthand:
 *
 * - `true` — always show errors (when any exist).
 * - `false` — never show errors.
 * - function — custom predicate, see `ShouldShowErrors`.
 *
 * Resolved through three tiers (per-form > plugin defaults > library
 * default).
 */
export type ShouldShowErrorsConfig = ShouldShowErrors | boolean

/**
 * Submit handler returned by `handleSubmit(onSubmit, onError)`. Bind
 * it to a `<form>`:
 *
 * ```vue
 * <form @submit.prevent="onSubmit">…</form>
 * ```
 *
 * It optionally accepts the originating `Event` so it can sit on
 * `@submit` directly (without `.prevent` if you want to call
 * `event.preventDefault()` yourself).
 */
export type SubmitHandler = (event?: Event) => Promise<void>

/**
 * Type of `form.handleSubmit`. Pass an `onSubmit` callback for the
 * happy path and (optionally) an `onError` callback that receives
 * the validation errors when parsing fails.
 *
 * ```ts
 * const onSubmit = form.handleSubmit(
 *   (data) => api.signup(data),
 *   (errors) => console.log(errors),
 * )
 * ```
 */
export type HandleSubmit<Form extends GenericForm> = (
  onSubmit: OnSubmit<Form>,
  onError?: OnError
) => SubmitHandler

/**
 * Per-leaf internal tracker record. Distinct from `FieldState.meta`
 * (which surfaces as `Readonly<FieldMetaPayload>` — the registry-
 * attached label / description / placeholder payload). Surfaced for
 * custom-adapter authors threading metadata through their own
 * pipelines; most consumers don't reach for it directly — the
 * matching fields appear with friendlier shape on `FieldState`.
 *
 * - `updatedAt` — ISO timestamp of the most recent write at this path,
 *   or `null` if the field has never been written.
 * - `rawValue` — the value as it arrived (before any transform);
 *   useful for distinguishing parse-coerced reads from raw user input.
 * - `connected` — whether at least one DOM element bound to this
 *   path is currently mounted. Flips to `false` when every binding
 *   unmounts.
 * - `formKey` — identifier of the form this metadata belongs to.
 * - `path` — dotted-string path to this leaf, or `null` when not applicable.
 */
export type MetaTrackerValue = {
  /** ISO timestamp of the most recent write at this path. `null` if never written. */
  updatedAt: string | null
  /** Value as it arrived, before any transforms. */
  rawValue: unknown
  /** `true` while at least one binding to this path is currently mounted. */
  connected: boolean
  /** Form this metadata belongs to. */
  formKey: FormKey
  /** Dotted-string path to this leaf. */
  path: string | null
  /**
   * `true` when this field is **blank** — the runtime has recorded
   * that storage and the visible display diverge here. Reserved for
   * the case the schema can't see on its own: storage forces a
   * value (e.g. `0` for a numeric leaf, `0n` for a bigint leaf)
   * while the DOM input shows `''`, and the runtime needs a side-
   * channel to tell "user typed 0" from "user supplied nothing."
   *
   * Set automatically for numeric leaves (the directive's input
   * listener on clear; the construction-time pass when the consumer
   * didn't supply a value). Set explicitly for any primitive leaf
   * via `setValue(path, unset)` / `defaultValues: { x: unset }` /
   * `reset({ x: unset })` — that's the documented opt-in signal for
   * strings, booleans, and other types that don't otherwise diverge.
   * Cleared on the first non-`unset` write.
   *
   * `errors = f(schema, state)` is reactive end-to-end: any required
   * path with `blank: true` produces a "No value supplied" entry in
   * `form.errors` immediately, no `validate()` / `handleSubmit` call
   * required. Most consumers don't need this flag directly — gate UI
   * on `errors[path]` and `touched`. Read `blank` itself when you
   * want pre-error introspection ("the user hasn't decided yet"
   * indicator, "review unanswered fields" hint).
   *
   * See `docs/recipes/blank-inputs.md` for the full conceptual model.
   */
  blank: boolean
}
export type MetaTracker = Record<string, MetaTrackerValue>
export type MetaTrackerStore = Map<FormKey, MetaTracker>

// Generates every registrable path inside `Form`. Arrays of primitive
// items (string / number / boolean / bigint) expose BOTH the array root
// AND `${Key}.${number}` so multi-select and multi-checkbox bindings
// can register at the array root; arrays of objects expose only the
// indexed-and-deeper paths.
export type RegisterFlatPath<Form, Key extends keyof Form = keyof Form> =
  IsObjectOrArray<Form> extends true
    ? Key extends string
      ? Form[Key] extends infer Value
        ? Value extends Array<infer ArrayItem>
          ? IsObjectOrArray<ArrayItem> extends true
            ? `${Key}.${number}.${RegisterFlatPath<ArrayItem>}`
            : `${Key}` | `${Key}.${number}`
          : Value extends GenericForm
            ? `${Key}.${RegisterFlatPath<Value>}`
            : `${Key}`
        : never
      : Key extends number
        ?
            | `${Key}`
            | (Form[Key] extends GenericForm
                ? `${Key}.${RegisterFlatPath<Form[Key]>}`
                : Form[Key] extends Array<infer ArrayItem>
                  ? IsObjectOrArray<ArrayItem> extends true
                    ? `${Key}.${number}.${RegisterFlatPath<ArrayItem>}`
                    : `${Key}` | `${Key}.${number}`
                  : never)
        : never
    : never

/**
 * Sync transformation applied to a field's value as user input flows
 * from DOM through the directive's assigner. Composes left-to-right
 * via the `transforms: [...]` array on `register()`.
 *
 * The shape is intentionally generic-erased (`(unknown) => unknown`)
 * rather than per-path-typed: a personal library of transforms
 * (`trim`, `lowercase`, `slugify`, `clamp`, …) should plug into any
 * `register()` slot regardless of the path's value type. Library
 * authors write defensive bodies that no-op on type mismatch:
 *
 * ```ts
 * export const trim: RegisterTransform = (v) =>
 *   typeof v === 'string' ? v.trim() : v
 * ```
 *
 * Type-safety at the call site is delegated to attaform's slim-primitive
 * gate — a transform that produces a value the path's storage
 * doesn't accept gets rejected at write time with a standard
 * diagnostic.
 *
 * Transforms must be sync. A `Promise` return is treated as a
 * pipeline failure: the write is aborted and a console.error is
 * logged. Use async field validation for canonicalize-before-write
 * patterns; use sync transforms for fire-and-forget side effects
 * (`void doIt(value); return value`).
 *
 * Throws are caught and aborted: attaform wraps each transform call in
 * try/catch so a buggy or defensive-throw transform doesn't crash
 * the host app. On throw the pipeline aborts (subsequent transforms
 * don't run), nothing is written to form state, and the assigner
 * returns `false`.
 */
export type RegisterTransform = (value: unknown) => unknown

/**
 * Runtime type for a slim primitive kind. Used to narrow the
 * `transform` parameter and return value on a `CoercionEntry` so
 * authors writing rules don't have to cast `unknown`.
 *
 * Exhaustive over `SlimPrimitiveKind` — adding a new kind to that
 * union must add a corresponding branch here.
 */
export type SlimRuntimeOf<K extends SlimPrimitiveKind> = K extends 'string'
  ? string
  : K extends 'number'
    ? number
    : K extends 'boolean'
      ? boolean
      : K extends 'bigint'
        ? bigint
        : K extends 'date'
          ? Date
          : K extends 'null'
            ? null
            : K extends 'undefined'
              ? undefined
              : K extends 'array'
                ? readonly unknown[]
                : K extends 'set'
                  ? ReadonlySet<unknown>
                  : K extends 'map'
                    ? ReadonlyMap<unknown, unknown>
                    : K extends 'object'
                      ? Record<string, unknown>
                      : K extends 'symbol'
                        ? symbol
                        : K extends 'function'
                          ? (...args: never[]) => unknown
                          : never

/**
 * Outcome of a coercion attempt.
 *
 * - `coerced: true` — the rule produced `value`, which the directive
 *   forwards to the slim gate (the gate may still reject if the
 *   value doesn't satisfy the path's accept set).
 * - `coerced: false` — the rule decided it can't coerce this input.
 *   The directive passes the original value through; the slim gate
 *   decides downstream.
 *
 * Discriminated rather than `O | undefined` so rules with
 * `output: 'undefined'` or `output: 'null'` don't conflict with the
 * "skip" signal.
 */
export type CoercionResult<O> = { coerced: true; value: O } | { coerced: false }

/**
 * A single coercion rule. `input` and `output` are
 * `SlimPrimitiveKind` literals; `transform` receives a value already
 * narrowed to `SlimRuntimeOf<input>` and returns
 * `CoercionResult<SlimRuntimeOf<output>>`.
 *
 * Rules MUST be sync. They SHOULD NOT throw — wrap internal
 * try/catch when the conversion can fail (e.g. `BigInt(s)` throws
 * for non-numeric strings). The library wraps each invocation in
 * try/catch as defense in depth; throws are caught, logged once per
 * `(input, output)`, and the original value passes through.
 */
export type CoercionEntry<
  I extends SlimPrimitiveKind = SlimPrimitiveKind,
  O extends SlimPrimitiveKind = SlimPrimitiveKind,
> = {
  readonly input: I
  readonly output: O
  readonly transform: (value: SlimRuntimeOf<I>) => CoercionResult<SlimRuntimeOf<O>>
}

/**
 * A registry is an ordered array of `CoercionEntry` records.
 * Consumers compose by spreading `defaultCoercionRules` and
 * appending their own entries. Order is observable only when two
 * entries share the same `(input, output)` pair — the library emits
 * a one-shot dev-warn and the LATER entry wins.
 */
export type CoercionRegistry = readonly CoercionEntry[]

/**
 * Options for `register(path, options)`. Per-field rather than
 * per-form so each persisted path is opted in at its own call site —
 * adding a new field can't accidentally leak into the persistence
 * pipeline unless the field's `register` call says so explicitly.
 */
export type RegisterOptions = {
  /**
   * Opt this field into the form's persistence pipeline. The form
   * also needs `useForm({ persist })` configured for any storage
   * activity to happen.
   *
   * Persistence follows the field's lifecycle: writes flow on
   * mount, the field is dropped from the persisted draft on unmount.
   * If multiple inputs bind to the same path, the path keeps
   * persisting as long as any opted-in input is mounted.
   *
   * Throws `SensitivePersistFieldError` when the path looks
   * sensitive (password / cvv / ssn / token / etc.) unless
   * `acknowledgeSensitive: true` is also set.
   */
  persist?: boolean
  /**
   * Suppress the sensitive-name guard. Required to persist any path
   * whose name matches the heuristic (password, cvv, ssn, etc.).
   * Treat this as a code-review checkpoint: setting it should be a
   * deliberate decision that the path's data is safe to land in
   * client-side storage for this user's session.
   */
  acknowledgeSensitive?: boolean
  /**
   * Sync transformation pipeline applied to user-typed values before
   * they reach form state. Composes left-to-right: each transform
   * receives the previous transform's output (or the directive-
   * extracted DOM value for the first transform).
   *
   * Pipeline order:
   * `DOM event → modifier cast (.lazy/.trim/.number) → transforms[0] → … → transforms[n] → assigner`
   *
   * Applies to user input only. Programmatic writes
   * (`form.setValue(...)`, `rv.setValueWithInternalPath(...)`),
   * `form.reset()`, hydration, SSR replay, and `markBlank()` all
   * bypass transforms — those write canonical state, not normalized
   * user input. If you want the same normalization on a programmatic
   * write, compose the transforms yourself at the call site:
   *
   * ```ts
   * form.setValue('email', slugify(lowercase(rawValue)))
   * ```
   *
   * Transforms must be sync. Throws and Promise returns abort the
   * write and log to `console.error` (see `RegisterTransform` for
   * the failure-mode contract).
   *
   * For patterns that need to inspect the `RegisterValue` itself
   * (rejection-with-side-effect, redirection to other fields, custom
   * DOM mutation), use `@update:registerValue` on the bound element
   * instead — see the "Custom assigners" section in the API docs.
   */
  transforms?: ReadonlyArray<RegisterTransform>
}

/**
 * The object returned by `form.register(path)`. Pass it to a native
 * input via `v-register`:
 *
 * ```vue
 * <input v-register="form.register('email')" />
 * ```
 *
 * Or read `innerRef` directly when integrating with custom components.
 *
 * The returned value is a `shallowReadonly` reactive proxy: top-level
 * reads (`rv.path`, `rv.formKey`, `rv.persist`, …) track in reactive
 * scopes, mutations are blocked, and inner refs (`innerRef`,
 * `displayValue`) keep their `Ref` shape.
 *
 * `path`, `formKey`, and `formInstanceId` are the wrapper-component
 * primitives — a generic component using `useRegister()` can derive
 * field state and form identity from them without re-threading props
 * from the parent.
 */
export type RegisterValue<Value = unknown> = Readonly<{
  /**
   * Live, read-only reactive value at this path. Watch it to drive
   * UI that depends on the field's current value.
   */
  innerRef: Readonly<Ref<Value>>
  /**
   * Attach an HTML element to this binding. Called by `v-register`
   * automatically; expose it to custom integrations that need to
   * register an element manually.
   */
  registerElement: (el: HTMLElement) => void
  /**
   * Detach an HTML element from this binding. Pair with
   * `registerElement` for custom integrations.
   */
  deregisterElement: (el: HTMLElement) => void
  /**
   * Write the field's value programmatically. Returns `true` when the
   * write was accepted, `false` when it was rejected (e.g. wrong
   * primitive type for the path). The optional `meta` lets custom
   * directives signal whether the write should be persisted.
   */
  setValueWithInternalPath: (value: unknown, meta?: WriteMeta) => boolean
  /**
   * Mark this field as DOM-connected during SSR so a server-rendered
   * template that reads `form.fields.<path>.connected` doesn't
   * flicker on hydration. The `v-register` directive calls this for
   * you; no-op on the client.
   * @internal
   */
  markConnectedOptimistically: () => void
  /**
   * Canonical, JSON-encoded path key for this binding (e.g.
   * `'["items",0,"name"]'`). Useful for stable Map / Set keys, log
   * messages, and equality checks against another `RegisterValue`'s
   * path. Treat as opaque — for `form.fields(...)` / `form.values(...)`
   * lookups inside wrapper components, use `segments` instead.
   */
  path: PathKey
  /**
   * Structured path segments for this binding (e.g.
   * `['items', 0, 'name']`). The consumer-friendly form for
   * `form.fields(...)` / `form.values(...)` lookups in generic
   * wrapper components:
   *
   * ```ts
   * const rv = useRegister()
   * const form = injectForm()
   * const field = computed(() => form.fields(rv.value?.segments ?? []))
   * ```
   *
   * Frozen at runtime so wrapper components can read it without
   * defensive copying.
   */
  segments: Path
  /**
   * The form's user-supplied (or auto-allocated) `key`, mirroring
   * `form.key` on the public form API. Useful in wrapper components
   * that target a specific form by key without prop-drilling.
   */
  formKey: string
  /**
   * Per-mount runtime identifier for the form instance. Stable across
   * the form's lifetime. Used by the directive to scope element
   * registrations to a single mount and exposed here for wrapper
   * components that need to disambiguate sibling forms with the same
   * `key`.
   */
  formInstanceId: string
  /**
   * Whether this binding opted into persistence via `register(path, { persist: true })`.
   * @internal
   */
  persist: boolean
  /**
   * Whether this binding acknowledged a sensitive-name override.
   * @internal
   */
  acknowledgeSensitive: boolean
  /**
   * Per-element persistence opt-in registry. Used by directive integrations.
   * @internal
   */
  persistOptIns: PersistOptInRegistry
  /**
   * Sync transform pipeline applied by the directive's assigner to
   * user-typed values before they reach form state. See
   * `RegisterOptions.transforms` for the public contract; this is
   * the readonly internal handle the directive iterates. Optional
   * so hand-rolled `RegisterValue` mocks (test fixtures, custom
   * integrations) don't have to declare an empty array — the
   * directive falls back to a no-op pipeline.
   * @internal
   */
  transforms?: ReadonlyArray<RegisterTransform>
  /**
   * Schema-driven coercion closure baked at register-time. Captures
   * the path's slim accept set and the resolved coercion index so
   * the per-event hot path is a single function call. Identity
   * function when coercion is disabled or the path admits no
   * coercion target. Optional so hand-rolled `RegisterValue` mocks
   * (test fixtures, custom integrations) don't have to declare it —
   * the directive falls back to identity.
   * @internal
   */
  coerce?: (value: unknown) => unknown
  /**
   * Element-level coercion closure for container paths
   * (`z.array(...)` / `z.set(...)`). Coerces a scalar DOM-side
   * value (an option's `value` attribute, a checkbox's value)
   * against the container's element type. `undefined` when the
   * path isn't a container — scalar paths use `coerce` exclusively.
   *
   * Used by the directive's read-side comparisons in setChecked
   * (array/Set branches) and setSelected (multi-select) to keep
   * parity with the change handler's WRITE-side path-level coerce.
   * @internal
   */
  coerceElement?: (value: unknown) => unknown
  /**
   * Read-only, string-form view of the field's current value — what
   * the compile-time `:value` injection reads on every input /
   * textarea / select bound by `v-register`.
   *
   * Returns `''` when the path is in the form's `blankPaths`
   * set OR storage is `null` / `undefined`; otherwise stringifies
   * the storage value via `String(...)`. The blank branch
   * lets the user clear a numeric field without the next Vue render
   * patching `el.value` back to `'0'` (the slim default).
   */
  displayValue: Readonly<Ref<string>>
  /**
   * Add this field's path to the form's `blankPaths` set,
   * writing the slim default to storage. Returns the `setValueAtPath`
   * boolean (`true` accepted, `false` rejected by the slim-primitive
   * gate). Inherits the binding's `persist` meta so the mark rides
   * the same persistence channel as user-typed writes.
   *
   * Called by the directive's input listener on numeric clear (commit
   * 5) and by the imperative `setValue(path, unset)` translation
   * (commit 7). Don't call from consumer code.
   * @internal
   */
  markBlank: () => boolean
}>

/**
 * Internal extension of `RegisterValue` that includes directive-private
 * coordination state. Imported by the directive runtime; not part of
 * the public surface.
 *
 * `lastTypedForm` is the user's most recently typed string form for a
 * numeric field while mid-typing, or `null` once the field has been
 * blurred / cleared. The directive populates it on every committable
 * input event and clears it on the change (blur) event so:
 *
 *   - Mid-typing: `displayValue` returns the typed form (e.g.
 *     `'1e2'`) when it parses back to current storage. Vue's
 *     `:value` patch then targets the typed form, which already
 *     equals the DOM — idempotent, no cursor reset.
 *   - On blur: `displayValue` falls back to `String(storage)`
 *     (`'100'`), Vue patches the DOM to match. The user sees
 *     exactly what's stored.
 *
 * Why a separate field: JavaScript's Number carries no representation
 * info — `1e2 === 100`, so `String(parseFloat('1e2'))` yields `'100'`.
 * Tracking the typed form lets us avoid Vue's mid-typing DOM yank
 * without lying about storage. Only meaningful for `.number` text
 * inputs and `<input type="number">`; other bindings ignore it.
 *
 * @internal
 */
export type InternalRegisterValue<Value = unknown> = RegisterValue<Value> & {
  lastTypedForm: Ref<string | null>
}

/**
 * Custom assigner installed on an element via the directive's
 * `[assignKey]` slot OR an `@update:registerValue` listener. Called
 * by the directive when a DOM event (input / change / etc.) fires
 * on the bound element.
 *
 * The directive passes the extracted value plus the `RegisterValue`
 * the directive is currently bound to. The second arg lets a
 * top-level handler write back to form state without having to
 * capture the RV via closure:
 *
 * ```ts
 * function upperCaseAssigner(value: unknown, rv: RegisterValue): void {
 *   rv.setValueWithInternalPath(String(value ?? '').toUpperCase())
 * }
 * ```
 *
 * `registerValue` is omitted only for assigners installed directly
 * via `el[assignKey] = fn` — those callers already have the RV in
 * scope at install time.
 *
 * Return `true` when the write was accepted, `false` when it was
 * rejected (e.g. the value didn't match the path's expected type).
 * `undefined` is treated as "succeeded" so simple assigners can
 * just return `void`.
 */
export type CustomDirectiveRegisterAssignerFn = (
  value: unknown,
  registerValue?: RegisterValue
) => boolean | undefined
/**
 * Generic shape of a v-register directive variant. Used by the
 * library's text / checkbox / radio / select directive types and
 * available for custom integrations that need to drop in their own
 * variant.
 *
 * The value generic admits `undefined` because `useRegister()` may
 * return `undefined` (a wrapper component rendered without a parent
 * `registerValue`); binding that value to `v-register` is supported
 * and installs a no-op assigner at runtime.
 */
export type CustomRegisterDirective<T, Modifiers extends string = string> = ObjectDirective<
  T & {
    _assigning?: boolean
    /**
     * Snapshot of the last `value.innerRef.value` reference the
     * directive's DOM-sync (setSelected / setChecked / radio
     * `el.checked = …`) was applied for. Used by every input
     * directive's `updated` / `beforeUpdate` to skip the per-render
     * DOM sync when the model is identity-unchanged — preventing
     * parent re-renders (a typed character in a sibling, an async-
     * validation tick, any reactive read) from clobbering an in-
     * progress user interaction. Identity comparison is sound:
     * every form write produces a fresh value at the path (scalars
     * are new primitives; arrays/Sets get fresh references along the
     * spine via diff-apply), so reference equality on
     * `innerRef.value` tracks "did the model move" exactly. The
     * `_assigning` gate stays alongside — it short-circuits the
     * immediate post-write render where the DOM is already in sync
     * from the user's input.
     */
    _lastAppliedModel?: unknown
    [S: symbol]: CustomDirectiveRegisterAssignerFn
  },
  RegisterValue | undefined,
  Modifiers,
  string
>

/**
 * Modifier names supported by `v-register` on `<input type="text">`,
 * `<input type="number">`, and `<textarea>`. Mirrors Vue's
 * `v-model` modifier semantics on the same elements; combine freely
 * (`<input v-register.lazy.trim.number="..." />`).
 */
export type RegisterTextModifier =
  /**
   * Write on `change` (blur) instead of `input`. The reactive
   * model only updates after the user tabs/clicks out of the
   * field. IME composition handlers are skipped under `.lazy` —
   * composition events do not gate writes.
   */
  | 'lazy'
  /**
   * Strip leading and trailing whitespace on blur. The form holds
   * the user's raw input (whitespace included) while they're
   * typing; on `change` (blur / commit) the value is trimmed
   * once and written back to both the model and the visible DOM.
   * Combine with `.lazy` to skip the mid-typing writes entirely.
   */
  | 'trim'
  /**
   * Cast the value via `parseFloat` before writing. Values that
   * can't be parsed as a number (e.g. `'abc'`) pass through
   * unchanged — the slim-primitive gate then sees a string
   * heading to a numeric slot and rejects the write. Auto-applied
   * for `<input type="number">`; explicit `.number` is redundant
   * there.
   */
  | 'number'

/**
 * v-register directive variant for `<input type="text">`,
 * `<input type="number">`, and `<textarea>`. Supports the
 * `.lazy`, `.trim`, and `.number` modifiers — see
 * `RegisterTextModifier` for per-modifier semantics.
 */
export type RegisterTextCustomDirective = CustomRegisterDirective<
  HTMLInputElement | HTMLTextAreaElement,
  RegisterTextModifier
>

/** v-register directive variant for checkboxes. No modifiers. */
export type RegisterCheckboxCustomDirective = CustomRegisterDirective<HTMLInputElement>
/** v-register directive variant for radio inputs. No modifiers. */
export type RegisterRadioCustomDirective = CustomRegisterDirective<HTMLInputElement>

/**
 * Modifier name supported by `v-register` on `<select>`. Mirrors
 * Vue's `v-model` `.number` on the same element.
 */
export type RegisterSelectModifier =
  /**
   * Cast each selected option's `value` via `parseFloat` before
   * writing. The form state holds numbers, not numeric strings —
   * useful when option values are written as strings in the
   * markup but the schema expects numbers.
   */
  'number'

/**
 * v-register directive variant for `<select>`. Supports `.number`
 * — see `RegisterSelectModifier` for semantics.
 */
export type RegisterSelectCustomDirective = CustomRegisterDirective<
  HTMLSelectElement,
  RegisterSelectModifier
>

/** v-register directive variant for the dynamic input/select/textarea bridge. */
export type RegisterModelDynamicCustomDirective = ObjectDirective<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  RegisterValue | undefined,
  string
>
/**
 * The `v-register` directive. Binds a form field to a native
 * input, select, textarea, checkbox, or radio:
 *
 * ```vue
 * <input v-register="form.register('email')" />
 * <select v-register="form.register('country')">
 *   <option value="us">US</option>
 *   <option value="uk">UK</option>
 * </select>
 * ```
 *
 * Also works on custom components whose root is NOT a native
 * input — call `useRegister()` in the child's setup to read the
 * parent's binding, then re-bind `v-register` onto an inner native
 * element. (When the wrapper's root IS the input itself, attribute
 * fallthrough handles it; `useRegister` is unnecessary.)
 *
 * ```vue
 * <!-- Parent -->
 * <MyField label="Email" v-register="form.register('email')" />
 *
 * <!-- MyField.vue (root is <label>, not <input>) -->
 * <script setup>
 * import { useRegister } from 'attaform'
 * defineProps<{ label: string }>()
 * const register = useRegister()
 * </script>
 * <template>
 *   <label>
 *     <span>{{ label }}</span>
 *     <input v-register="register" />
 *   </label>
 * </template>
 * ```
 *
 * Modifier support varies by element:
 *   - text / number / textarea: `.lazy`, `.trim`, `.number`
 *   - select: `.number`
 *   - checkbox / radio: none
 *
 * See `RegisterTextModifier` / `RegisterSelectModifier` for
 * per-modifier semantics.
 *
 * Registered globally by `createAttaform()` (and by the
 * `attaform/nuxt` module). Most consumers don't import the
 * directive itself — it's exposed for integrations that install
 * directives manually.
 */
export type RegisterDirective =
  | RegisterTextCustomDirective
  | RegisterCheckboxCustomDirective
  | RegisterSelectCustomDirective
  | RegisterRadioCustomDirective
  | RegisterModelDynamicCustomDirective

/**
 * Callback form of `setValue`'s value argument. Receives the previous
 * value at the path and returns the next value:
 *
 * ```ts
 * form.setValue('count', (prev) => prev + 1)
 * form.setValue((prev) => ({ ...prev, name: 'Ada' }))
 * ```
 *
 * The library fills any missing structural slots (e.g. nested
 * objects) against the schema's defaults after the callback returns,
 * so partial returns are safe.
 */
export type SetValueCallback<Read, Write = Read> = (prev: Read) => Read | Write

/**
 * The value argument of `form.setValue`. Either the next value
 * directly, or a callback that derives it from the previous value.
 *
 * Type parameters:
 * - `Write` — what the direct value form accepts (the storable shape
 *   at the path).
 * - `Read` — what the callback's `prev` argument exposes (defaults
 *   to `Write`). For whole-form callbacks the read shape tags
 *   array elements as possibly-undefined to reflect runtime reality.
 */
export type SetValuePayload<Write, Read = Write> = Write | SetValueCallback<Read, Write>

/**
 * Focus / blur / touched flags for a registered field.
 *
 * - `focused` — `true` while the user is interacting with the field;
 *   `false` after blur. `null` until the field has ever been focused.
 * - `blurred` — `true` after the field has lost focus at least once.
 *   `null` before any blur event.
 * - `touched` — flips to `true` on the first blur after a focus and
 *   stays `true` thereafter. Useful for "show errors only after the
 *   user has interacted" UX.
 */
export type DOMFieldState = {
  /** `true` while focused; `false` after blur; `null` before first focus. */
  focused: boolean | null
  /** `true` once the field has lost focus at least once; `null` before. */
  blurred: boolean | null
  /** Flips to `true` on the first blur after a focus and stays there. */
  touched: boolean | null
}
/**
 * Per-field reactive shape returned by `form.fields.<leaf-path>` and
 * `form.fields(path)`. Slim, readonly across the board. The unified
 * shape replaces the older split between `FieldState` /
 * `FieldStateBranch`: one type lives at every path, with aggregations
 * rolled up at containers.
 *
 * Leaf-aware: this shape only injects these keys at LEAF paths via
 * dot-access. At container paths the proxy descends without
 * injecting, so a schema field literally named `dirty` at depth 2+
 * stays reachable as a descent target — no shadowing. Container
 * call-form (`form.fields('address')`) returns a `FieldState`
 * surface where the keys are aggregations of the descendant leaves.
 */
export type FieldState<Value = unknown> = {
  readonly value: Value
  readonly original: Value
  readonly pristine: boolean
  readonly dirty: boolean
  readonly focused: boolean | null
  readonly blurred: boolean | null
  readonly touched: boolean | null
  readonly connected: boolean
  /**
   * The first DOM element bound to this path via `v-register`, or
   * `null` when none is registered (initial mount, post-unmount,
   * SSR). "First" means first by registration order. Reach for it
   * when you need to call a native DOM method on a field's input —
   * `focus()`, `scrollIntoView()`, `select()`, `setSelectionRange()`,
   * etc. — without the library having to verb every imperative:
   *
   * ```ts
   * form.fields.email.element?.focus()
   * form.fields.email.element?.scrollIntoView({ block: 'center' })
   * ```
   *
   * For paths with multiple bindings (input syncing, mirrored
   * shadow inputs), prefer `elements` and pick the right target
   * yourself. Reactive: register / deregister triggers
   * re-evaluation.
   */
  readonly element: HTMLElement | null
  /**
   * Every DOM element currently bound to this path via `v-register`,
   * in registration order. Empty array when none is registered.
   * Two bindings to the same path are intentional — input syncing,
   * mirrored shadow inputs:
   *
   * ```ts
   * for (const el of form.fields.email.elements) el.blur()
   * ```
   *
   * For the common single-binding case, reach for `element` — sugar
   * over `elements[0] ?? null`.
   */
  readonly elements: readonly HTMLElement[]
  readonly updatedAt: string | null
  readonly errors: readonly ValidationError[]
  /**
   * `true` while a per-field validation run is in flight at this path.
   * Reflects field-level debounced runs (`validate-on-change`) and
   * cross-field re-validations targeting this path. Whole-form
   * `validate()` / `validateAsync()` calls drive `form.meta.validating`
   * only — they don't flip per-field flags.
   *
   * Per-field analogue of `form.meta.validating`. Use for a tight
   * "Checking…" indicator next to a single async-validated input
   * without commandeering the whole-form spinner.
   */
  readonly validating: boolean
  /**
   * `true` when this field has no errors AND no per-field validation
   * is in flight (`errors.length === 0 && !validating`). Confidence
   * that "we've checked, and we have no problems right now." Use for
   * green-checkmark / `aria-invalid` UX.
   */
  readonly valid: boolean
  /**
   * Centralised "should I render this field's errors right now?"
   * gate. Wraps `errors.length > 0 && shouldShowErrors(field, formMeta)`
   * so templates avoid re-spelling the heuristic at every error site:
   *
   * ```vue
   * <span v-if="form.fields.email.showErrors">
   *   {{ form.fields.email.firstError?.message }}
   * </span>
   * ```
   *
   * The heuristic itself comes from `useForm({ shouldShowErrors })` →
   * `createAttaform({ defaults: { shouldShowErrors } })` → library
   * default (`defaultShouldShowErrors` — show after first submit OR
   * after touched-and-dirty). Override per form, app-wide, or
   * compose with `defaultShouldShowErrors` for a layered predicate.
   *
   * Falls back to `false` whenever there are no errors — the gate
   * skips the predicate entirely in that case.
   *
   * Available on container paths too: `form.fields.users[0].showErrors`
   * aggregates over the row's descendants (any descendant with a
   * qualifying error flips the container on).
   */
  readonly showErrors: boolean
  /**
   * The first `ValidationError` at this path in the deterministic
   * schema-declaration order — equivalent to `errors[0]`, exposed as
   * a sugar accessor for the common case of "show the highest-priority
   * error message and ignore the rest":
   *
   * ```vue
   * <span v-if="form.fields.email.showErrors">
   *   {{ form.fields.email.firstError?.message }}
   * </span>
   * ```
   *
   * `undefined` when no errors exist. Independent of `showErrors` —
   * the data primitive is always available; the heuristic only
   * decides when to render it.
   *
   * On container paths, the first error in the aggregated subtree
   * (descendants sorted by `pathOrdinal`).
   */
  readonly firstError: ValidationError | undefined
  readonly path: ReadonlyArray<string | number>
  readonly blank: boolean
  /**
   * Presentational label for this field. Resolves through the
   * shared cross-adapter field-meta store — written via
   * `schema.register(fieldMeta, {...})` (Zod 4 native chain) or the
   * `withMeta()` helper (works on both majors) — and falls back to
   * a humanized form of the path's last segment when nothing has
   * been registered. Always a string.
   *
   * ```ts
   * z.string().register(fieldMeta, { label: 'Reference' })
   * // template: <label>{{ form.fields.reference.label }}</label>
   * ```
   *
   * Numeric segments (array indices) collapse to the empty string;
   * consumers wanting "Item 3" substitute their own format.
   */
  readonly label: string
  /**
   * Helper-text description for this field. Reads from the
   * registered `description` first; falls back to the schema's own
   * `.describe('...')` value (both Zod 3 and Zod 4 expose that as
   * `schema.description`); `undefined` when neither is set.
   *
   * Useful for `aria-describedby`-linked help text. Distinct from
   * `label` — descriptions are longer prose, labels are short
   * presentational nouns.
   */
  readonly description: string | undefined
  /**
   * Placeholder hint for input affordance. Reads from the
   * registered `placeholder`; `undefined` otherwise.
   */
  readonly placeholder: string | undefined
  /**
   * Full registered metadata payload, frozen — empty object when
   * nothing has been registered. Use as an escape hatch for
   * consumer-augmented keys (declared via TypeScript module
   * augmentation on `FieldMetaPayload`):
   *
   * ```ts
   * declare module 'attaform/zod' {
   *   interface FieldMetaPayload { tooltip?: string }
   * }
   * // template: {{ form.fields.email.meta.tooltip }}
   * ```
   */
  readonly meta: Readonly<FieldMetaPayload>
}

/**
 * Recursive type behind `form.fields`. Leaf-aware branching: at
 * primitive paths (string, number, boolean, bigint, Date, …) the
 * proxy returns a `FieldState`; at container paths (object,
 * array, …) the proxy descends without injecting leaf-keys.
 *
 * Field-name collisions at depth 2+ resolve unambiguously: a schema
 * field literally named `dirty` at depth 2 is reachable as a
 * descent target (`form.fields.address.dirty` returns the
 * FieldState for `address.dirty`). Reading `dirty` AT the
 * leaf-view (`form.fields.address.dirty.dirty`) reads the leaf's
 * own dirty boolean — path-segment and leaf-prop occupy different
 * proxy depths.
 *
 * The runtime implementation queries `schema.isLeafAtPath(segments)`
 * at every step; this type approximates that decision using
 * "T extends primitive". The two stay in sync for typical schemas;
 * exotic adapter-defined leaf kinds (custom `Date`-like) may need
 * a runtime check (the runtime is authoritative).
 *
 * The mapped type strips optional flags (`-?:`) because the field-
 * state surface always exposes a record per known leaf, regardless
 * of whether the schema field is declared `.optional()`. Optional
 * schemas mean the VALUE can be undefined — `FieldState<string |
 * undefined>` carries that — but the FieldState wrapper itself
 * always exists. Without the strip, `form.fields.notes` (where
 * `notes?: string`) would type as `FieldState<...> | undefined`,
 * forcing consumers to optional-chain through every reactive read.
 *
 * For discriminated-union containers the object branch uses
 * `[T] extends [object]` (non-distributive) plus
 * `KeyofUnion`/`ValueOfUnion` to merge variant key sets — so
 * `form.fields.cargo.tempMinC` (refrigerated-only) is reachable
 * regardless of the active variant, with the leaf typed as
 * `FieldState<number | undefined>`. Matches the runtime's stub
 * `FieldState` for inactive-variant paths.
 */
export type FieldStateMapEntry<T> = [T] extends [
  string | number | boolean | bigint | symbol | null | undefined | Date,
]
  ? FieldState<T>
  : [T] extends [ReadonlyArray<infer U>]
    ? { readonly [K: number]: FieldStateMapEntry<U> }
    : [T] extends [object]
      ? [IsUnion<T>] extends [true]
        ? {
            readonly [K in KeyofUnion<T>]-?: FieldStateMapEntry<ValueOfUnion<T, K>>
          }
        : { readonly [K in keyof T]-?: FieldStateMapEntry<T[K]> }
      : FieldState<T>

/**
 * Type of `form.fields` — leaf-aware drillable callable Proxy. At
 * a leaf path the proxy resolves to a `FieldState<Value>`; at
 * a container path it returns a sub-proxy you can keep drilling.
 *
 * Augmented with the callable signatures so dot-access and function-
 * call coexist on the same identifier:
 *
 * ```ts
 * form.fields.email.value           // string (leaf-prop on FieldState)
 * form.fields('email').value        // function-call (dynamic / programmatic)
 * form.fields(['users', 0, 'name']) // path-array form
 * form.fields()                     // root proxy
 * ```
 *
 * Single-bracket dotted access (`form.fields['address.city']`) is
 * intentionally NOT supported — JS object semantics treat the dotted
 * string as a single key. Use chained dot/bracket or the callable
 * form.
 */
export type FieldStateMap<Form extends GenericForm> = ([IsUnion<Form>] extends [true]
  ? {
      readonly [K in KeyofUnion<Form>]-?: FieldStateMapEntry<ValueOfUnion<Form, K>>
    }
  : { readonly [K in keyof Form]-?: FieldStateMapEntry<Form[K]> }) & {
  /**
   * Dotted-string fallback for dynamic paths. Returns
   * `FieldState<unknown>` — the runtime always lands on a FieldState
   * terminal at any depth (leaf or container). Cast to
   * `FieldState<TypedValue>` when the caller knows the leaf type.
   */
  (path: string): FieldState<unknown>
  /**
   * Tuple-segment form. Returns the typed `FieldStateMapEntry` for
   * the resolved path when the tuple resolves to a known path.
   * Equivalent to `form.fields[a][b][...]` but useful when the path
   * is built from variables.
   */
  <const S extends ReadonlyArray<string | number>>(
    segments: S & ([JoinSegments<S>] extends [FlatPath<Form>] ? unknown : never)
  ): FieldStateMapEntry<NestedType<Form, JoinSegments<S>>>
  /**
   * Dynamic-array fallback for callers passing `Path`-typed (runtime)
   * segment arrays — e.g. forwarding `RegisterValue.segments` to
   * resolve a field view. Returns `FieldState<unknown>`; cast when
   * the value type is known.
   */
  (segments: ReadonlyArray<string | number>): FieldState<unknown>
  /**
   * No-arg call returns the root FieldState — same as
   * `form.fields([])`. Aggregates over the whole form (one
   * conjunction over every active-variant leaf).
   */
  (): FieldState<Form>
}

export type DOMFieldStateStore = Map<string, DOMFieldState | undefined>

/**
 * Untyped error map keyed by dotted-string path. The same data
 * exposed by `form.errors`, but as a plain record — useful when
 * routing API errors that may land on paths the form's TypeScript
 * type doesn't know about.
 */
export type FormErrorRecord = Record<string, ValidationError[]>
export type FormErrorStore = Map<FormKey, FormErrorRecord>

/**
 * Type of `form.errors`. Leaf-aware drillable callable Proxy. At a
 * leaf path the proxy resolves to `ValidationError[] | undefined`;
 * at a container path it returns a sub-proxy you can keep drilling.
 *
 * Dot/bracket access mirrors the schema shape:
 *
 * ```ts
 * form.errors.email                  // ValidationError[] | undefined (leaf)
 * form.errors.user.profile.email     // ValidationError[] | undefined (chained leaves)
 * form.errors.address                // sub-proxy (container — descend further)
 * ```
 *
 * Callable form for dynamic / programmatic paths:
 *
 * ```ts
 * form.errors('user.profile.email')              // dotted-string
 * form.errors(['user', 'profile', 'email'])      // path-array
 * form.errors()                                  // root proxy
 * ```
 *
 * Single-bracket dotted access (`form.errors['user.profile.email']`)
 * is intentionally NOT supported — JS object semantics treat the
 * dotted string as a single key, which would land on a non-existent
 * path. Use chained dot/bracket access or the callable form.
 */

/**
 * Recursive shape of the `form.errors` proxy. Mirrors the schema:
 * primitive leaves expose `ValidationError[] | undefined` directly;
 * containers expose a sub-shape you can keep drilling. Arrays expose
 * numeric-indexed sub-shapes.
 *
 * Augmented with the callable signatures so dot-access and function-
 * call coexist on the same identifier.
 */
export type FormErrorsSurface<Form> = ErrorsProxyShape<Form> & {
  (path: string): readonly ValidationError[] | undefined
  /**
   * Tuple-segment form. Validated against `FlatPath<Form>` so literal
   * tuples that don't resolve to a known path fail at the call site.
   * Dynamic `Path`-typed inputs hit the untyped fallback overload below.
   */
  <const S extends ReadonlyArray<string | number>>(
    segments: S & ([JoinSegments<S>] extends [FlatPath<Form>] ? unknown : never)
  ): readonly ValidationError[] | undefined
  (segments: ReadonlyArray<string | number>): readonly ValidationError[] | undefined
  /**
   * No-arg call returns the form-level error aggregate — same as
   * `form.errors([])` and `form.meta.errors`. `undefined` when the
   * form has no errors; readonly array otherwise.
   */
  (): readonly ValidationError[] | undefined
}

type ErrorsProxyShape<T> = [T] extends [
  string | number | boolean | bigint | symbol | null | undefined | Date,
]
  ? readonly ValidationError[] | undefined
  : [T] extends [ReadonlyArray<infer U>]
    ? { readonly [K: number]: ErrorsProxyShape<U> }
    : [T] extends [object]
      ? [IsUnion<T>] extends [true]
        ? {
            readonly [K in KeyofUnion<T>]: ErrorsProxyShape<ValueOfUnion<T, K>>
          }
        : { readonly [K in keyof T]: ErrorsProxyShape<T[K]> }
      : readonly ValidationError[] | undefined

/**
 * Type of `form.values`. Drillable readonly callable proxy. Unlike
 * `form.errors` and `form.fields`, containers are USEFUL terminals:
 * `form.values.address` returns the actual `{ city, … }` subtree
 * (and keeps drilling). Asymmetry justified by density — every
 * container in `values` carries meaningful data; in errors / fields
 * containers are derivations.
 *
 * ```ts
 * form.values.email                  // string (the value)
 * form.values.address                // { city, … } — object (drillable)
 * form.values.address.city           // string (chained descent)
 * form.values('address.city')        // function-call (dynamic / programmatic)
 * form.values(['address', 'city'])   // path-array form
 * form.values()                      // the whole form value (root)
 * ```
 *
 * Single-bracket dotted access (`form.values['address.city']`) is
 * intentionally NOT supported — JS object semantics treat the dotted
 * string as a single key. Use chained dot/bracket or the callable
 * form.
 *
 * The chained shape applies the discriminated-union lift via
 * `LiftedValueShape<F>` so per-variant keys are reachable without
 * narrowing first (e.g. `form.values.cargo.permitNumber` types as
 * `string | undefined` regardless of which cargo variant is active —
 * matching the runtime, where plain JS object access on a missing
 * variant key returns `undefined`). The strict-variant shape is
 * still required at the WRITE side: `setValue` and `defaultValues`
 * use the un-lifted `WriteShape` so consumers can't accidentally
 * hand the form a partial / cross-variant object.
 */
export type ValuesSurface<F> = Readonly<LiftedValueShape<F>> & {
  (path: string): unknown
  (path: ReadonlyArray<string | number>): unknown
  (): Readonly<F>
}

/**
 * A single server-side error entry. Carries both the human-readable
 * `message` and a stable `code` identifier — both fields are required.
 * The `code` is stamped verbatim onto the produced `ValidationError`,
 * so consumers can branch on it without string-matching on `message`.
 *
 * Pick a prefix for your codes (`api:`, `auth:`, etc.) and stay
 * consistent so error-rendering UIs can switch on the code.
 */
export type ApiErrorEntry = {
  /** Human-readable failure description. */
  message: string
  /**
   * Stable machine identifier for the failure (e.g. `'api:duplicate-email'`).
   * Forwarded verbatim onto the produced `ValidationError`.
   */
  code: string
}

/**
 * Shape of a server-side error details record. Keys are dotted field
 * paths; values are either a single entry, an array of entries, or a
 * mix of structured and bare-string entries. Each entry is one of:
 *
 * - **Structured** — `{ message: string, code: string }`. The `code`
 *   forwards verbatim onto the produced `ValidationError`.
 * - **Bare string** — a plain string. The Rails / Django REST
 *   Framework / Laravel default JSON shape (`{ field: ["msg"] }`).
 *   Synthesized into `{ message: <string>, code: <defaultCode> }` at
 *   parse time, where `defaultCode` defaults to `'api:unknown'` and
 *   is configurable via `parseApiErrors`'s options bag.
 *
 * Multiple entries at the same path produce multiple
 * `ValidationError`s — useful for a single field that fails multiple
 * checks (e.g. `password` is too short *and* missing a digit).
 */
export type ApiErrorDetails = Record<string, ApiErrorValue>

/**
 * One entry inside an {@link ApiErrorDetails} value — either the
 * strict `{ message, code }` object, or a bare string (synthesised
 * with the parser's `defaultCode`).
 */
export type ApiErrorValue = string | ApiErrorEntry | ReadonlyArray<string | ApiErrorEntry>

/**
 * Outer envelope `parseApiErrors` accepts. Both the wrapped form
 * (`{ error: { details } }`) and the unwrapped form (`{ details }`)
 * are recognised; raw detail records (`{ email: { message, code } }`)
 * are also accepted directly.
 */
export type ApiErrorEnvelope = {
  /** Wrapped error envelope — `parseApiErrors` reads `details` from inside. */
  error?: {
    details?: ApiErrorDetails
    [k: string]: unknown
  }
  /** Unwrapped error envelope. */
  details?: ApiErrorDetails
}

/**
 * Reactive form-level flags, counters, and aggregates returned as
 * `form.meta`. "Meta" because every other surface (`form.values`,
 * `form.errors`, `form.fields`) is data-shaped — `form.meta` holds
 * facts derived ABOUT the form.
 *
 * Read fields directly with no `.value` — they auto-unwrap inside
 * the reactive object:
 *
 * ```vue
 * <button :disabled="form.meta.submitting">Save</button>
 * ```
 *
 * Watch a single field via the getter form:
 *
 * ```ts
 * watch(() => form.meta.submitting, (value) => …)
 * ```
 *
 * Per-field state (touched, dirty, errors) lives behind
 * `form.fields.<path>`; this is the aggregate view across the
 * whole form.
 *
 * Read-only at runtime — assignments throw. Destructuring snapshots
 * the current values; use `toRefs()` if you need reactive handles
 * to individual fields.
 */
export type FormMeta<F = unknown> = FieldState<F> & {
  /**
   * `true` while a `handleSubmit`-produced submit handler is running.
   * Covers both the validation phase and your async submit callback.
   * Useful for disabling the submit button.
   */
  readonly submitting: boolean

  /**
   * How many times the submit handler has been invoked, regardless of
   * outcome (validation failure, callback success, callback throw).
   * Useful for "show errors after first submit attempt" UX.
   */
  readonly submitCount: number

  /**
   * The error thrown or rejected by the most recent submit callback
   * (or its `onError` handler). Cleared to `null` at the start of
   * each new submission attempt; stays `null` on success.
   *
   * The submit handler still throws normally — this is the reactive
   * mirror for templates. Imperative callers can use
   * `try { await onSubmit() }` instead.
   */
  readonly submitError: unknown

  /** `true` when there is at least one undo step available. Always present (false when history is disabled). */
  readonly canUndo: boolean

  /** `true` when `undo()` has been called and a `redo()` would replay. Always present (false when history is disabled). */
  readonly canRedo: boolean

  /**
   * Total snapshots across the undo and redo stacks. Useful for
   * debug overlays; UI driving undo/redo buttons should gate on
   * `canUndo` / `canRedo` instead.
   */
  readonly historySize: number

  /**
   * Per-`useForm()`-call identity. Stable for the lifetime of one
   * `useForm()` call; new on every fresh mount. Orthogonal to
   * `form.key`: the key identifies a SHARED FormStore (so two
   * `useForm({ key: 'signup' })` calls return the same store and the
   * same key), while `instanceId` identifies THIS specific callsite —
   * useful when two forms share a key (sidebar + main rendering the
   * same form) and you need to disambiguate which caller is which.
   *
   * Format is opaque (Vue 3.5+ `useId()`-derived). Treat as identity,
   * not state — don't parse, don't compare ordinally, don't persist.
   *
   * Common patterns:
   *
   * - **Devtools panels** disambiguating shared-key form mounts.
   * - **Telemetry / logging hooks** tagging events with which mount
   *   triggered them.
   * - **E2E test selectors** stamping `data-form-id={form.meta.instanceId}`
   *   onto a wrapper to assert which form was focused.
   * - **Vue `:key`** for keyed lists of dynamically-rendered forms
   *   (drag-reorder, etc.) — stable identity per useForm() call.
   */
  readonly instanceId: string
}

/**
 * The object returned by `useForm`. Holds every reactive ref, write
 * helper, and lifecycle method bound to one form.
 *
 * ```ts
 * const form = useForm({ schema })
 * form.register('email')        // bind to <input v-register>
 * form.values.email             // current value (proxy, no .value)
 * form.fields.email.dirty   // per-field flags
 * form.errors.email             // ValidationError[] | undefined
 * form.setValue('email', 'a@b.c')
 * form.handleSubmit(onSubmit)   // returns a submit handler
 * form.meta.submitting        // form-level reactive flag
 * ```
 */
export type UseFormReturnType<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
> = {
  /**
   * Wraps your submit logic with validation and error routing.
   *
   * ```ts
   * <form @submit.prevent="form.handleSubmit(
   *   (data) => api.signup(data),
   *   (errors) => console.log(errors),
   * )">
   * ```
   *
   * `data` is the strictly-typed parsed value — refinements have
   * fired, so every leaf is guaranteed to satisfy its schema-level
   * format / range / membership constraints.
   */
  handleSubmit: HandleSubmit<Form>

  /**
   * Reactive readonly proxy over the form's storage value. Read
   * identically in script and template — no `.value`, no auto-unwrap
   * rules. Pinia setup-store pattern.
   *
   * ```vue
   * <script setup>
   *   const form = useForm({ schema, key: 'login' })
   * </script>
   *
   * <template>
   *   <p>{{ form.values.email }}</p>
   *   <p>{{ form.values.address.city }}</p>
   * </template>
   * ```
   *
   * Writes are blocked at the proxy boundary — go through `setValue`,
   * the directive, or one of the field-array helpers. The
   * slim-primitive write gate stays the only path into storage.
   *
   * Reads reflect what's storable: enum-typed slots widen to their
   * primitive supertype (`string`), so refinement-invalid but
   * structurally-valid values are visible. Use `handleSubmit` /
   * `validateAsync()` when you need the post-validation strict type.
   */
  values: ValuesSurface<WriteShape<GetValueFormType>>

  /**
   * Reactive per-field state proxy. Pinia-style nested object — read
   * leaf properties (`value`, `dirty`, `touched`, `errors`, `blurred`,
   * `focused`, `blank`, …) directly off the field's path:
   *
   * ```vue
   * <p v-if="form.fields.email.touched && form.fields.email.errors.length">
   *   {{ form.fields.email.errors[0].message }}
   * </p>
   * <p>City dirty? {{ form.fields.address.city.dirty }}</p>
   * ```
   *
   * The same proxy supports descent at every level — `address` reads
   * the FieldState for the address object, and `address.city`
   * descends into the nested leaf.
   *
   * Leaf values follow the slim WriteShape contract: enum-typed leaves
   * widen to their primitive supertype. The errors array, dirty flag,
   * focus state, etc. are unaffected.
   *
   * Shadowing: at depth 2+, FieldState keys (`dirty`, `touched`,
   * `errors`, `blank`, `focused`, `blurred`, `value`,
   * `original`, `pristine`, `connected`, `updatedAt`, `path`) win
   * over schema field names. Top-level fields are NOT shadowed.
   * Document edge case; rename the offending schema field if the
   * collision matters.
   */
  fields: FieldStateMap<WriteShape<GetValueFormType>>

  /**
   * Write to the form programmatically. Two forms:
   *
   * - `setValue(value)` — replace the whole form.
   * - `setValue(path, value)` — write at a specific path.
   *
   * Either takes a callback in place of `value` to derive the next
   * value from the previous one:
   *
   * ```ts
   * form.setValue('count', (prev) => prev + 1)
   * form.setValue((prev) => ({ ...prev, name: 'Ada' }))
   * ```
   *
   * Returns `true` when the write is accepted. A `false` return
   * means the value didn't match the slot's expected type
   * (e.g. writing a number to a string field) — the form state
   * stays unchanged. Refinement-level mismatches (out-of-enum
   * values, failing format checks, etc.) DO succeed and surface as
   * field errors instead.
   */
  setValue: {
    /**
     * Replace the whole form. Pass a value or a callback receiving
     * the previous form.
     *
     * ```ts
     * form.setValue({ name: 'Ada', email: 'a@b.c' })
     * form.setValue((prev) => ({ ...prev, name: 'Ada' }))
     * ```
     *
     * Returns `true` when the write was accepted, `false` when the
     * value didn't match the expected shape (e.g. wrong primitive
     * type at a leaf). Refinement-level mismatches (out-of-enum
     * values, failing format checks, etc.) succeed and surface as
     * field errors instead.
     */
    <Value extends SetValuePayload<DefaultValuesShape<Form>, WriteShape<Form>>>(
      value: Value
    ): boolean
    /**
     * Write at a specific path. Pass a value or a callback receiving
     * the previous value at that path.
     *
     * ```ts
     * form.setValue('email', 'a@b.c')
     * form.setValue('count', (prev) => prev + 1)
     * form.setValue('income', unset) // numeric leaf marked displayed-empty
     * ```
     *
     * Returns `true` when the write was accepted, `false` when the
     * value didn't match the slot's expected primitive type.
     * Refinement-level mismatches succeed and surface as field
     * errors. Pass the `unset` symbol at any primitive leaf to mark
     * it blank (storage holds the slim default; UI displays
     * empty; submit raises "No value supplied" for required schemas).
     */
    <
      Path extends FlatPath<Form>,
      Value extends SetValuePayload<
        DefaultValuesShape<NestedType<Form, Path>>,
        NonNullable<WriteShape<NestedType<Form, Path>>>
      >,
    >(
      path: Path,
      value: Value
    ): boolean
    /**
     * Tuple-segment form. Equivalent to the dotted-string overload —
     * useful when paths are built from variables or arrays:
     * `form.setValue([prefix, 'line1'], 'value')`. The resolved leaf
     * type is exact, matching the dotted-string form.
     */
    <
      const S extends ReadonlyArray<string | number>,
      Value extends SetValuePayload<
        DefaultValuesShape<NestedType<Form, JoinSegments<S>>>,
        NonNullable<WriteShape<NestedType<Form, JoinSegments<S>>>>
      >,
    >(
      segments: S & ([JoinSegments<S>] extends [FlatPath<Form>] ? unknown : never),
      value: Value
    ): boolean
  }

  /**
   * Reactive validation status. Re-runs whenever the form (or the
   * subtree at `path`) mutates. The returned ref carries a `pending`
   * flag — gate on `!status.value.pending` before reading
   * `success` / `errors`.
   *
   * ```ts
   * const status = form.validate()
   * watchEffect(() => {
   *   if (status.value.pending) return
   *   if (!status.value.success) console.log(status.value.errors)
   * })
   * ```
   *
   * Stale in-flight runs are dropped automatically — the ref only
   * settles to results from the most recent call.
   */
  validate: (path?: FlatPath<Form>) => Readonly<Ref<ReactiveValidationStatus<Form>>>

  /**
   * Run validation once and return the result. Unlike `validate()`,
   * this does not subscribe to form reactivity.
   *
   * ```ts
   * const result = await form.validateAsync()
   * if (!result.success) showErrors(result.errors)
   * ```
   *
   * Pass a path to validate a subtree. `state.validating` flips
   * `true` while the promise is in flight.
   */
  validateAsync: (path?: FlatPath<Form>) => Promise<ValidationResponseWithoutValue<Form>>
  /**
   * Bind a path to a native input via `v-register`. Returns a
   * `RegisterValue` carrying the live ref and event handlers the
   * directive needs.
   *
   * ```vue
   * <input v-register="form.register('email')" />
   * <input
   *   type="password"
   *   v-register="form.register('password', { persist: true, acknowledgeSensitive: true })"
   * />
   * ```
   *
   * Also accepts a segment-array form for callers building paths
   * dynamically — particularly inside a `v-for` over a prefix variable
   * where dotted-string concatenation widens the prefix's literal
   * union to plain `string`:
   *
   * ```vue
   * <fieldset v-for="block in [{ prefix: 'pickup' }, { prefix: 'delivery' }] as const">
   *   <input v-register="form.register([block.prefix, 'line1'])" />
   * </fieldset>
   * ```
   *
   * Pass `options.persist` to opt into the form's persistence
   * pipeline. Persistence requires `useForm({ persist })` configured
   * for storage activity to actually happen.
   */
  register: {
    <Path extends RegisterFlatPath<Form, keyof Form>>(
      path: Path,
      options?: RegisterOptions
    ): RegisterValue<NestedReadType<WriteShape<Form>, Path>>
    <const S extends ReadonlyArray<string | number>>(
      segments: S &
        ([JoinSegments<S>] extends [RegisterFlatPath<Form, keyof Form>] ? unknown : never),
      options?: RegisterOptions
    ): RegisterValue<NestedReadType<WriteShape<Form>, JoinSegments<S>>>
  }
  /**
   * The form's identifier — either the explicit `key` passed to
   * `useForm` or an auto-generated unique id when `key` was omitted.
   * Use it when feeding API errors through `parseApiErrors`:
   *
   * ```ts
   * const result = parseApiErrors(serverPayload, { formKey: form.key })
   * if (result.ok) form.setFieldErrors(result.errors)
   * ```
   */
  key: FormKey

  // --- Reactive field-error API ---

  /**
   * Reactive map of field errors, keyed by dotted path. Populated
   * automatically by `handleSubmit` and per-field validation; cleared
   * on validation success.
   *
   * Read in templates with no `.value`:
   *
   * ```vue
   * <p v-if="form.errors.email">{{ form.errors.email[0].message }}</p>
   * ```
   *
   * Watch from script via the getter form:
   *
   * ```ts
   * watch(() => form.errors.email, (errors) => …)
   * ```
   *
   * Use bracket access for nested dotted keys
   * (`form.errors['user.profile.email']`) — JS dot notation splits
   * on literal dots.
   *
   * Read-only — populate via `setFieldErrors`, `addFieldErrors`, and
   * `clearFieldErrors`. Server-side errors flow through
   * `parseApiErrors` first.
   */
  errors: FormErrorsSurface<Form>

  /**
   * Escape hatch for the rare case a consumer needs a `Ref<T>` —
   * e.g. handing the value to an external composable that expects a
   * Vue ref, or watching a single path with `watch(formRef, ...)`.
   *
   * ```ts
   * const emailRef = form.toRef('email')         // Readonly<Ref<string>>
   * watch(emailRef, (next) => console.log(next))
   * ```
   *
   * Returns `Readonly<Ref<...>>` — writes go through `setValue`,
   * `register()`, or the field-array helpers, never via the ref.
   * Prefer `form.values.email` for direct reads in templates +
   * scripts; `toRef` is for ref-shaped interop only.
   */
  toRef: {
    <Path extends FlatPath<Form>>(
      path: Path
    ): Readonly<Ref<NestedReadType<WriteShape<GetValueFormType>, Path>>>
    <const S extends ReadonlyArray<string | number>>(
      segments: S & ([JoinSegments<S>] extends [FlatPath<Form>] ? unknown : never)
    ): Readonly<Ref<NestedReadType<WriteShape<GetValueFormType>, JoinSegments<S>>>>
  }

  /**
   * Replace every field error for this form with the provided list.
   * Useful after `parseApiErrors` produces a fresh batch from a
   * server response.
   *
   * ```ts
   * const result = parseApiErrors(payload, { formKey: form.key })
   * if (result.ok) form.setFieldErrors(result.errors)
   * ```
   */
  setFieldErrors: (errors: ValidationError[]) => void

  /**
   * Append errors to the existing set without clearing prior entries.
   * Use when reporting an additional issue alongside existing errors
   * (e.g. a partial server response).
   */
  addFieldErrors: (errors: ValidationError[]) => void

  /**
   * Clear errors. Pass a path to clear errors for a single field;
   * call with no arguments to clear every error on the form.
   *
   * ```ts
   * form.clearFieldErrors('email')   // clear one field
   * form.clearFieldErrors()          // clear all
   * ```
   */
  clearFieldErrors: (path?: string | (string | number)[]) => void

  /**
   * Replace the form-level errors — the entries at the empty path
   * (`path: []`) — without disturbing any field-level errors. Pass an
   * empty array to clear them all.
   *
   * ```ts
   * form.setFormErrors([{ message: 'Capacity exceeded' }])
   * form.setFormErrors([
   *   { message: 'Capacity exceeded', code: 'capacity:exceeded' },
   *   { message: 'Pickup window full' },
   * ])
   * form.setFormErrors([])  // clear
   * ```
   *
   * Only `message` is required. `code` defaults to `'atta:form-error'`.
   * Any caller-provided `path` or `formKey` is ignored — `path` is
   * always forced to `[]` (this API is form-level-only by definition)
   * and `formKey` is filled in from the form instance. The lenient
   * input shape lets you pipe `parseApiErrors` output (or any
   * `ValidationError[]`) straight in:
   *
   * ```ts
   * const result = parseApiErrors(payload, { formKey: form.key })
   * if (result.ok) form.setFormErrors(result.errors)
   * ```
   *
   * Form-level errors land at the empty-string path bucket
   * (`path: ['']`). They surface in `form.meta.errors` (alongside
   * field errors), in `form.errors()` / `form.errors([])` (whole-form
   * subtree aggregates), and — uniquely — in `form.errors('')`,
   * which returns ONLY the form-level bucket. They're excluded from
   * the path-keyed `form.errors` drill proxy because no nested-object
   * key represents the empty-string path. Read them via
   * `meta.errors.filter(e => e.path.length === 1 && e.path[0] === '')`
   * if you need a programmatic split.
   */
  setFormErrors: (errors: ReadonlyArray<Partial<ValidationError> & { message: string }>) => void

  /**
   * Clear every form-level error. Equivalent to `setFormErrors([])`;
   * field errors are untouched.
   */
  clearFormErrors: () => void

  // --- Form-level meta ---

  /**
   * Form-level reactive flags, counters, and aggregates (`dirty`,
   * `valid`, `submitting`, `submitCount`, `canUndo`,
   * `historySize`, and the flat `errors` array). See `FormMeta` for
   * the full shape. Read leaves directly with no `.value`.
   *
   * For per-field state (touched, focused, blurred, errors at one
   * path), use `form.fields.<path>` instead.
   */
  meta: FormMeta<Form>

  // --- Reset ---

  /**
   * Restore the form to its initial state. Without arguments,
   * re-applies the schema defaults (and any `defaultValues` passed
   * to `useForm`). Pass `nextDefaultValues` to seed the reset with
   * a fresh set of overrides.
   *
   * Resets:
   *   - the form value back to defaults;
   *   - the dirty baseline (so the next edit flips `dirty` correctly);
   *   - field errors;
   *   - touched / focused / blurred per-field flags;
   *   - submission state (`submitting` / `submitCount` / `submitError`);
   *   - the persisted draft, if persistence is configured.
   *
   * The next edit on a still-mounted opted-in input will start
   * persisting again automatically.
   */
  reset: (nextDefaultValues?: DeepPartial<DefaultValuesShape<Form>>) => void

  /**
   * Restore a single field (or a sub-tree like `'user'`) to its
   * initial value. Clears errors and touched flags for the field
   * and its descendants; leaves siblings and submission state alone.
   *
   * No-op when the path doesn't exist on the form (e.g. a typo'd
   * dynamic key).
   *
   * If persistence is configured, the matching subpath is removed
   * from the persisted draft too.
   */
  resetField: (path: FlatPath<Form>) => void

  // --- Persistence (imperative APIs) ---

  /**
   * Write the current value at `path` to storage immediately. Useful
   * for explicit "Save draft" buttons, `beforeunload` handlers, or
   * multi-step checkpoints where the user shouldn't wait for the
   * debounce window.
   *
   * Bypasses both the per-field opt-in and the debouncer. Existing
   * paths in the persisted draft are preserved (this is a merge,
   * not a replace).
   *
   * Throws `SensitivePersistFieldError` for sensitive-looking paths
   * unless you pass `{ acknowledgeSensitive: true }`. No-op when
   * `useForm({ persist })` wasn't configured.
   */
  persist: (path: FlatPath<Form>, options?: { acknowledgeSensitive?: boolean }) => Promise<void>

  /**
   * Remove data from the persisted draft. Without arguments, wipes
   * the entire entry. With a path, removes just that subpath.
   *
   * Does not change the in-memory form state — pair with `reset()`
   * / `resetField()` if you need both. Future edits to still-mounted
   * opted-in fields will re-populate the entry. No-op when
   * persistence isn't configured.
   */
  clearPersistedDraft: (path?: FlatPath<Form>) => Promise<void>

  // --- Undo / redo ---

  /**
   * Revert the form to the previous snapshot. Returns `true` when a
   * snapshot was restored, `false` when there's nothing to undo.
   * No-op (returns `false`) when `useForm({ history })` wasn't configured.
   */
  undo: () => boolean

  /**
   * Replay a previously-undone snapshot. Returns `true` on success,
   * `false` when the redo stack is empty. The redo stack clears as
   * soon as a new mutation lands.
   */
  redo: () => boolean

  // --- Focus / scroll to first error ---

  /**
   * Focus the first errored field's first visible element. Returns
   * `true` when an element was focused, `false` when no candidate
   * element exists (no errors, or every errored field is unmounted
   * or hidden).
   *
   * Pass `{ preventScroll: true }` if you're scrolling separately
   * (e.g. via `scrollToFirstError`) and don't want the browser to
   * fight the explicit scroll.
   */
  focusFirstError: (options?: { preventScroll?: boolean }) => boolean

  /**
   * Scroll the first errored field's first visible element into
   * view. Returns `true` when the call ran, `false` when no
   * candidate element exists.
   *
   * `options` is forwarded to `Element.scrollIntoView` unchanged.
   */
  scrollToFirstError: (options?: ScrollIntoViewOptions) => boolean

  /**
   * Programmatically mark fields as touched — the sticky flag the
   * standard "show errors after interaction" pattern reads. Closes
   * the gap when fields are populated without a DOM gesture (post-
   * import, paste, autofill, server-seeded values you want to
   * validate immediately).
   *
   * ```ts
   * form.touch('email')                 // one leaf
   * form.touch('profile')               // every leaf under profile
   * form.touch(['profile', 'name'])     // segment-array form
   * form.touch()                        // every leaf in the form
   * ```
   *
   * Pure flag write — does not mutate value, focused, blurred, or
   * trigger validation. Idempotent: re-calling on an already-touched
   * field is a no-op. Touched is sticky-true; pair with
   * `form.reset()` / `form.resetField()` to clear.
   */
  touch: (path?: FlatPath<Form> | (string | number)[]) => void

  // --- Field arrays ---

  /**
   * Append `value` to the array at `path`.
   *
   * ```ts
   * form.append('items', { name: 'New' })
   * ```
   */
  append: <Path extends ArrayPath<Form>>(path: Path, value: ArrayItem<Form, Path>) => void
  /** Prepend `value` to the array at `path`. */
  prepend: <Path extends ArrayPath<Form>>(path: Path, value: ArrayItem<Form, Path>) => void
  /**
   * Insert `value` into the array at `path` at the given `index`.
   * Behaves like `Array.prototype.splice`: `index` is clamped into
   * `[0, length]`, and negative indices count from the end.
   */
  insert: <Path extends ArrayPath<Form>>(
    path: Path,
    index: number,
    value: ArrayItem<Form, Path>
  ) => void
  /** Remove the element at `index` from the array at `path`. No-op when out of range. */
  remove: <Path extends ArrayPath<Form>>(path: Path, index: number) => void
  /** Swap the elements at indices `a` and `b`. No-op when either is out of range. */
  swap: <Path extends ArrayPath<Form>>(path: Path, a: number, b: number) => void
  /**
   * Move the element at `from` to `to`. Useful for drag-and-drop
   * reordering. No-op when either index is out of range.
   */
  move: <Path extends ArrayPath<Form>>(path: Path, from: number, to: number) => void
  /** Replace the element at `index` with `value`. No-op when out of range. */
  replace: <Path extends ArrayPath<Form>>(
    path: Path,
    index: number,
    value: ArrayItem<Form, Path>
  ) => void
  /**
   * Read-only view of the form's blank path set. Each entry
   * is a canonical `PathKey` (the `JSON.stringify(segments)` form
   * `canonicalizePath` produces). The set is reactive — Vue 3.5
   * tracks `.has()` / `for..of` / size accesses, so consumers can
   * drive conditional UI off it directly:
   *
   * ```ts
   * watchEffect(() => {
   *   if (form.blankPaths.value.size > 0) {
   *     console.warn('unanswered fields:', [...form.blankPaths.value])
   *   }
   * })
   * ```
   *
   * For per-path access, use `form.fields.<path>.blank`.
   * Writes happen through `setValue(path, unset)`,
   * `markBlank()` on a register binding, and the directive's
   * input listener on numeric clear. Mutating the snapshot returned
   * here does nothing — it's `Object.freeze`-d.
   */
  blankPaths: ComputedRef<ReadonlySet<string>>
}
