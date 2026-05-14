import type { Unset } from '../core/unset'

/**
 * The minimum shape any form value satisfies — a plain record. Use
 * as a constraint for composables that work generically across forms
 * (e.g. a custom hook that takes any form's `useForm` return).
 */
export type GenericForm = Record<string, unknown>

/** Internal helper — `true` when `T` is an object or array. */
export type IsObjectOrArray<T> = T extends GenericForm
  ? true
  : T extends Array<unknown>
    ? true
    : false

/**
 * Implementation detail backing `FlatPath` in its default
 * (partial-path) mode. Exported so `rollup-plugin-dts` preserves it
 * as a named alias in the bundled `.d.ts` rather than inlining the
 * full template-literal recursion body at every reference site
 * (`FlatPath`, `RegisterFlatPath`, every path-addressed API method).
 * Inlining at consumer call sites compounds into TS2589 territory
 * when multiple complex forms share a scope. Consumers should reach
 * for `FlatPath` instead; this alias is not part of the stable surface.
 */
export type PartialFlatPath<Form, Key extends keyof Form = keyof Form> =
  IsObjectOrArray<Form> extends true
    ? Key extends string
      ? Form[Key] extends infer Value
        ? Value extends Array<infer ArrayItem>
          ? `${Key}` | `${Key}.${number}` | `${Key}.${number}.${PartialFlatPath<ArrayItem>}`
          : Value extends GenericForm
            ? `${Key}` | `${Key}.${PartialFlatPath<Value>}`
            : `${Key}`
        : never
      : Key extends number
        ?
            | `${Key}`
            | (Form[Key] extends GenericForm
                ? `${Key}.${PartialFlatPath<Form[Key]>}`
                : Form[Key] extends Array<infer ArrayItem>
                  ? IsObjectOrArray<ArrayItem> extends true
                    ? `${Key}.${number}` | `${Key}.${number}.${PartialFlatPath<ArrayItem>}`
                    : `${Key}.${number}`
                  : never)
        : never
    : never

export type CompleteFlatPath<Form, Key extends keyof Form = keyof Form> =
  IsObjectOrArray<Form> extends true
    ? Key extends string
      ? Form[Key] extends infer Value
        ? Value extends Array<infer ArrayItem>
          ? `${Key}.${number}.${CompleteFlatPath<ArrayItem>}`
          : Value extends GenericForm
            ? `${Key}.${CompleteFlatPath<Value>}`
            : `${Key}`
        : never
      : Key extends number
        ?
            | `${Key}`
            | (Form[Key] extends GenericForm
                ? `${Key}.${CompleteFlatPath<Form[Key]>}`
                : Form[Key] extends Array<infer ArrayItem>
                  ? IsObjectOrArray<ArrayItem> extends true
                    ? `${Key}.${number}.${CompleteFlatPath<ArrayItem>}`
                    : `${Key}.${number}`
                  : never)
        : never
    : never

// FlatPath Generic Gotchas:
//
// 1. Typescript collapses paths like `something.${string}` | `something.${string}.deeper`
// into `something.${string}` because `${string}.deeper` is a subtype of string. This hurts type
// inference, but is currently outside our control. You can avoid this inference issue by not using
// records in schemas (which we recommend anyway, because static keys are safer than dynamic keys)
// whenever practical. Thus, using records will not result in warnings, but fewer paths may be suggested.
//
// 2. In Javascript, numbers with trailing decimals are valid (eg. 42. is valid). This means
// paths like `something.${number}` can resolve to 'something.42.' . It also means paths like
// `something.${number}.deeper` can resolve to 'something.42..deeper' -- one trailing decimal point
// for the number, and a second for the separator. We guard against this in useForm by stripping all
// trailing decimals when processing paths at runtime
/**
 * Union of dotted-string paths reachable inside `Form`, e.g. for
 * `{ user: { email: string }, items: string[] }`:
 *
 *   `'user' | 'user.email' | 'items' | 'items.0' | 'items.1' | …`
 *
 * Used by every path-addressed API (`setValue(path, value)`,
 * `register(path)`, `toRef(path)`, etc.) so paths autocomplete in
 * the IDE and typos compile-error.
 *
 * Set `ForceFullPath` to `true` to restrict to leaf paths only
 * (no intermediate container paths).
 */
export type FlatPath<
  Form,
  Key extends keyof Form = keyof Form,
  ForceFullPath extends boolean = false,
> = ForceFullPath extends true ? CompleteFlatPath<Form, Key> : PartialFlatPath<Form, Key>

/**
 * Convert a tuple of path segments to its dotted-string equivalent.
 *
 *   `JoinSegments<['cargo', 'items', 0, 'sku']>` → `'cargo.items.0.sku'`
 *
 * Recursion depth is bounded by the tuple length (typically 3–4),
 * not by form depth — the cost does not scale with `FlatPath<Form>`.
 * Template literal types distribute over union members, so segments
 * containing unions like `'pickup' | 'delivery'` propagate through
 * to the joined path's union: `JoinSegments<['pickup' | 'delivery', 'line1']>`
 * → `'pickup.line1' | 'delivery.line1'`. This is what makes
 * tuple-form path APIs work cleanly inside `v-for` over a prefix
 * variable: the joined result is checked against `FlatPath<Form>` /
 * `RegisterFlatPath<Form>` (which already exist), so we don't
 * enumerate a separate tuple-path union.
 */
export type JoinSegments<
  S extends ReadonlyArray<string | number>,
  Acc extends string = '',
> = S extends readonly [
  infer Head extends string | number,
  ...infer Rest extends ReadonlyArray<string | number>,
]
  ? Acc extends ''
    ? JoinSegments<Rest, `${Head}`>
    : JoinSegments<Rest, `${Acc}.${Head}`>
  : Acc

/**
 * `true` when `T` is a union (multiple members), `false` when it's a
 * single type. Used to gate non-homomorphic mapped-type forms so
 * single-object types retain their homomorphic `[K in keyof T]`
 * lookup (preserving literal keys instead of widening to an index
 * signature).
 */
export type IsUnion<T, U = T> = T extends T ? ([U] extends [T] ? false : true) : never

/**
 * Union of all keys across all members of `T`. For a single object
 * type this equals `keyof T`; for a discriminated union `A | B`, it
 * produces `keyof A | keyof B` (whereas naked `keyof (A | B)` would
 * intersect to common keys only).
 *
 * Paired with `ValueOfUnion` to merge variant key sets in chained
 * metadata proxies (`form.fields`, `form.errors`) so per-variant
 * leaves are addressable through one chained-access shape, regardless
 * of which discriminant is currently active.
 */
export type KeyofUnion<T> = T extends unknown ? keyof T : never

/**
 * Value at key `K` across union members of `T`. Members containing
 * `K` contribute `T[K]`; members lacking `K` contribute `undefined`.
 *
 * The resulting union mirrors the runtime semantics of metadata
 * proxies: chained access works at every union member, with the leaf
 * carrying `T | undefined` to reflect that the key is absent in some
 * variants and the runtime returns a stable stub there.
 */
export type ValueOfUnion<T, K extends PropertyKey> = T extends unknown
  ? K extends keyof T
    ? T[K]
    : undefined
  : never

/**
 * Apply the discriminated-union "lift" to a value shape (i.e., a
 * shape carrying actual values, not metadata leaves like
 * `FieldState`). Single-object types map homomorphically;
 * discriminated unions of objects merge keys via
 * `KeyofUnion` / `ValueOfUnion` so per-variant fields are reachable
 * through one chained-access shape.
 *
 * Used by `ValuesSurface` to make `form.values.cargo.permitNumber`
 * (oversized-only) typecheck regardless of the active variant —
 * matching the runtime, where plain JS object access on a missing
 * variant key returns `undefined` rather than throwing.
 *
 * Distinct from `FieldStateMapEntry`: that variant carries
 * `FieldState<T>` at the leaf; this one carries the leaf VALUE
 * directly. They share the same union-merging logic but differ in
 * what the recursion bottoms out at.
 *
 * Date / Map / Set / RegExp / function leaves stay opaque (not
 * recursed into) — value reads of those types should preserve the
 * platform shape unchanged.
 */
export type LiftedValueShape<T> = [T] extends [
  string | number | boolean | bigint | symbol | null | undefined,
]
  ? T
  : [T] extends [
        Date | RegExp | Map<unknown, unknown> | Set<unknown> | ((...args: never) => unknown),
      ]
    ? T
    : [T] extends [ReadonlyArray<unknown>]
      ? T
      : [T] extends [object]
        ? [IsUnion<T>] extends [true]
          ? { [K in KeyofUnion<T>]: LiftedValueShape<ValueOfUnion<T, K>> }
          : { [K in keyof T]: LiftedValueShape<T[K]> }
        : T

/**
 * Recursive `Partial` — every property at every depth is optional.
 * Used as the parameter type of `defaultValues` and `reset()` so
 * partial overrides at any nesting level are valid.
 */
export type DeepPartial<T> = T extends Primitive // Base case for primitive types
  ? T
  : T extends Array<infer ArrayItem> // Recursively process arrays
    ? DeepPartial<ArrayItem>[]
    : T extends object // Handle objects and apply DeepPartial recursively
      ? {
          [Key in keyof T]?: DeepPartial<T[Key]>
        }
      : T

/**
 * Resolve the type at a dotted-string path inside `RootValue`. Used
 * by the strict (write-side) APIs to derive the type at a path:
 *
 *   `NestedType<{ user: { email: string } }, 'user.email'>` → `string`
 *
 * On discriminated-union descents (e.g. `cargo` is `A | B | C`), uses
 * `KeyofUnion` / `ValueOfUnion` so per-variant keys resolve to
 * `T | undefined` instead of `never`. This keeps NestedType in lockstep
 * with `FlatPath`: any path FlatPath says is reachable resolves to a
 * useful value type (vs. silently collapsing to `never` because
 * `keyof (A|B|C)` would be the intersection of all variants' keys).
 *
 * TypeScript caps conditional-type recursion at around 50 levels;
 * paths deeper than that resolve to `never`. Real form schemas
 * never reach this depth.
 */
export type NestedType<
  RootValue,
  FlattenedPath extends string,
  FilterOutNullishTypesDuringRecursion extends boolean = true,
  _RootValue = FilterOutNullishTypesDuringRecursion extends false
    ? RootValue
    : NonNullable<RootValue>,
> =
  IsObjectOrArray<_RootValue> extends false
    ? never
    : FlattenedPath extends `${infer Key}.${infer Rest}`
      ? Key extends `${number}`
        ? Key extends KeyofUnion<_RootValue>
          ? NestedType<ValueOfUnion<_RootValue, Key>, Rest, FilterOutNullishTypesDuringRecursion>
          : Key extends `${infer NumericKey extends number}`
            ? NumericKey extends KeyofUnion<_RootValue>
              ? NestedType<
                  ValueOfUnion<_RootValue, NumericKey>,
                  Rest,
                  FilterOutNullishTypesDuringRecursion
                >
              : never
            : never
        : Key extends KeyofUnion<_RootValue>
          ? NestedType<ValueOfUnion<_RootValue, Key>, Rest, FilterOutNullishTypesDuringRecursion>
          : never
      : FlattenedPath extends `${number}`
        ? FlattenedPath extends KeyofUnion<_RootValue>
          ? ValueOfUnion<_RootValue, FlattenedPath>
          : FlattenedPath extends `${infer NumericKey extends number}`
            ? NumericKey extends KeyofUnion<_RootValue>
              ? ValueOfUnion<_RootValue, NumericKey>
              : never
            : never
        : FlattenedPath extends KeyofUnion<_RootValue>
          ? ValueOfUnion<_RootValue, FlattenedPath>
          : never

/**
 * Implementation-detail primitive-leaf marker used by `DeepPartial`
 * and sibling structural walkers. Exported so the bundled `.d.ts`
 * references one alias instead of re-emitting the union at every
 * recursion branch of every walker that depends on it. Not part of
 * the stable consumer-facing surface — reach for `DeepPartial`
 * instead.
 */
export type Primitive = string | number | boolean | symbol | bigint | null | undefined

/**
 * Distinguish a tuple from a regular array.
 *
 *   `IsTuple<[string, number]>` → `true`
 *   `IsTuple<string[]>` → `false`
 *
 * Useful for write-side helpers that need to preserve tuple
 * positions instead of widening to `Array<element>`.
 */
export type IsTuple<T extends readonly unknown[]> = number extends T['length'] ? false : true

/**
 * Path-resolved type for read-side APIs. Like `NestedType`, but once
 * the walk crosses an array index segment the resulting type is
 * tagged `| undefined` (the runtime can return undefined for
 * out-of-bounds reads). Discriminated-union descents follow the same
 * `KeyofUnion`/`ValueOfUnion` rule as `NestedType` — per-variant
 * keys resolve to `T | undefined`, agreeing with `FlatPath`.
 *
 * Used by `form.values.<path>` reads, `form.toRef(path)`, and
 * `register(path).innerRef` so the compile-time type honours the
 * runtime possibility of a missing array position.
 */
export type NestedReadType<
  RootValue,
  FlattenedPath extends string,
  _Tainted extends boolean = false,
  _RootValue = NonNullable<RootValue>,
> =
  IsObjectOrArray<_RootValue> extends false
    ? never
    : FlattenedPath extends `${infer Key}.${infer Rest}`
      ? Key extends `${number}`
        ? Key extends KeyofUnion<_RootValue>
          ? NestedReadType<ValueOfUnion<_RootValue, Key>, Rest, true>
          : Key extends `${infer NumericKey extends number}`
            ? NumericKey extends KeyofUnion<_RootValue>
              ? NestedReadType<ValueOfUnion<_RootValue, NumericKey>, Rest, true>
              : never
            : never
        : Key extends KeyofUnion<_RootValue>
          ? NestedReadType<ValueOfUnion<_RootValue, Key>, Rest, _Tainted>
          : never
      : FlattenedPath extends `${number}`
        ? FlattenedPath extends KeyofUnion<_RootValue>
          ? ValueOfUnion<_RootValue, FlattenedPath> | undefined
          : FlattenedPath extends `${infer NumericKey extends number}`
            ? NumericKey extends KeyofUnion<_RootValue>
              ? ValueOfUnion<_RootValue, NumericKey> | undefined
              : never
            : never
        : FlattenedPath extends KeyofUnion<_RootValue>
          ? _Tainted extends true
            ? ValueOfUnion<_RootValue, FlattenedPath> | undefined
            : ValueOfUnion<_RootValue, FlattenedPath>
          : never

/**
 * Filter FlatPath<Form> down to the subset of paths whose resolved leaf
 * is an array. Used by the typed field-array helpers (append / remove /
 * swap / ...) so those helpers only accept paths that actually address
 * an array — calling `append('email', ...)` on a `{ email: string }`
 * is a compile error.
 *
 * `P extends string` re-triggers distribution over the `FlatPath<Form>`
 * union so the conditional evaluates per member. Without it, the
 * branch would reduce against the union as a whole and collapse to
 * `never` whenever a single member failed the predicate.
 */
export type ArrayPath<Form, P extends FlatPath<Form> = FlatPath<Form>> = P extends string
  ? NestedType<Form, P> extends readonly unknown[]
    ? P
    : never
  : never

/**
 * Extract the element type of the array addressed by `Path`. Callers
 * constrain `Path extends ArrayPath<Form>` so this is always well-defined.
 */
export type ArrayItem<Form, Path extends ArrayPath<Form>> =
  NestedType<Form, Path> extends ReadonlyArray<infer Item> ? Item : never

/**
 * Widens primitive-literal leaves to their primitive supertype to
 * match the runtime "slim-primitive write contract."
 *
 *   WriteShape<{ color: 'red' | 'green' }>
 *     // → { color: string }
 *   WriteShape<{ kind: 'on' }>
 *     // → { kind: string }
 *   WriteShape<{ count: 42 }>
 *     // → { count: number }
 *
 * The runtime gate accepts any value at a path whose primitive type
 * matches the schema's slim primitive set at that path. Refinement-
 * level constraints (enum membership, literal equality, format
 * checks, length / range bounds, regex, custom predicates) are NOT
 * enforced at write time — they surface via field-level validation.
 * The type widening here mirrors that runtime behaviour, so
 * `setValue('color', 'magenta')` and `defaultValues: { color: 'teal' }`
 * are not TS errors despite being out-of-enum at the validation
 * layer.
 *
 * Tuple positions preserve their literal types via the homomorphic
 * mapped form (`{ [K in keyof T]: ... }` over a readonly tuple
 * preserves the position labels), so `[string, number]` stays a
 * 2-tuple of widened primitives instead of collapsing to
 * `Array<string | number>`.
 *
 * Date / RegExp / Map / Set / function instances pass through
 * unchanged — those aren't "primitive literals" and the runtime
 * accepts them as their own slim kinds. Tuple-detection runs before
 * the array-recursion branch so positionally-typed array literals
 * survive intact.
 *
 * Read-side types (handleSubmit's `data` argument,
 * validate*() result payloads) intentionally stay STRICT — those
 * payloads have been parsed by the schema, so the widened shape
 * doesn't apply.
 */
export type WriteShape<T> = T extends string | number | boolean | bigint | symbol | null | undefined
  ? T extends string
    ? string
    : T extends number
      ? number
      : T extends boolean
        ? boolean
        : T extends bigint
          ? bigint
          : T extends symbol
            ? symbol
            : T
  : T extends Date | RegExp | Map<unknown, unknown> | Set<unknown> | ((...args: never) => unknown)
    ? T
    : T extends readonly [unknown, ...unknown[]]
      ? { -readonly [K in keyof T]: WriteShape<T[K]> }
      : T extends ReadonlyArray<infer U>
        ? IsTuple<T> extends true
          ? { -readonly [K in keyof T]: WriteShape<T[K]> }
          : Array<WriteShape<U>>
        : T extends object
          ? { [K in keyof T]: WriteShape<T[K]> }
          : T

/**
 * Like `WriteShape<T>`, but additionally widens every primitive leaf
 * (`string`, `number`, `boolean`, `bigint`) to admit `Unset` — the
 * brand-typed sentinel consumers pass to indicate "this leaf starts
 * displayed-empty" in `defaultValues`, `setValue`, and `reset`.
 *
 * Non-primitive leaves (`Date`, `RegExp`, `Map`, `Set`, functions)
 * stay strict — `defaultValues: { joinedAt: unset }` against a
 * `Date`-typed leaf is a type error.
 *
 * The recursion mirrors `WriteShape<T>` exactly so `defaultValues`
 * stays compatible at every nested position; the only divergence is
 * the leaf widening. Tuple positions, unbounded arrays, and nested
 * records all flow through unchanged.
 *
 * Example:
 *
 *   DefaultValuesShape<{ income: number; name: string; age: 21 }>
 *     // → { income: number | Unset; name: string | Unset; age: number | Unset }
 *
 * Used by `UseFormConfiguration.defaultValues`, `setValue`'s value
 * parameter, and `reset`'s parameter (commit 7 widens all three).
 */
export type DefaultValuesShape<T> = T extends
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  ? T extends string
    ? string | Unset
    : T extends number
      ? number | Unset
      : T extends boolean
        ? boolean | Unset
        : T extends bigint
          ? bigint | Unset
          : T extends symbol
            ? symbol
            : T
  : T extends Date | RegExp | Map<unknown, unknown> | Set<unknown> | ((...args: never) => unknown)
    ? T
    : T extends readonly [unknown, ...unknown[]]
      ? { -readonly [K in keyof T]: DefaultValuesShape<T[K]> }
      : T extends ReadonlyArray<infer U>
        ? IsTuple<T> extends true
          ? { -readonly [K in keyof T]: DefaultValuesShape<T[K]> }
          : Array<DefaultValuesShape<U>>
        : T extends object
          ? { [K in keyof T]: DefaultValuesShape<T[K]> }
          : T

/**
 * Single-walker fusion of `DeepPartial` and `DefaultValuesShape` — the
 * type accepted at `defaultValues`, `reset()`'s parameter, and every
 * partial-shape consumer. Every level is optional and every primitive
 * leaf admits its supertype `| Unset`, in one tree walk where the
 * prior `DeepPartial<DefaultValuesShape<F>>` composition walked twice.
 *
 * Both passes had identical topology (object → mapped, tuple →
 * positional, array → recurse, primitive → terminal) — the doubled
 * recursion exhausted the depth budget at consumer call sites that
 * wire multiple complex forms into one scope. Collapsing them buys
 * back the headroom plus a side fix: opaque leaves (`Date`, `Map`,
 * `Set`, `RegExp`, functions) now stay intact when their containing
 * property is optional, rather than getting structurally destructured
 * by `DeepPartial`'s pass.
 *
 * Tuple positions, array elements, and discriminated-union variants
 * all flow through unchanged from the prior semantics.
 *
 * ```ts
 * type T = DefaultValuesInput<{
 *   email: string
 *   joinedAt: Date
 *   profile: { name: string; age: number }
 * }>
 * // → {
 * //   email?: string | Unset
 * //   joinedAt?: Date
 * //   profile?: { name?: string | Unset; age?: number | Unset }
 * // }
 * ```
 */
export type DefaultValuesInput<T> = T extends string
  ? string | Unset
  : T extends number
    ? number | Unset
    : T extends boolean
      ? boolean | Unset
      : T extends bigint
        ? bigint | Unset
        : T extends symbol
          ? symbol
          : T extends null | undefined
            ? T
            : T extends
                  | Date
                  | RegExp
                  | Map<unknown, unknown>
                  | Set<unknown>
                  | ((...args: never) => unknown)
              ? T
              : T extends readonly [unknown, ...unknown[]]
                ? { -readonly [K in keyof T]?: DefaultValuesInput<T[K]> }
                : T extends ReadonlyArray<infer U>
                  ? IsTuple<T> extends true
                    ? { -readonly [K in keyof T]?: DefaultValuesInput<T[K]> }
                    : Array<DefaultValuesInput<U>>
                  : T extends object
                    ? { [K in keyof T]?: DefaultValuesInput<T[K]> }
                    : T
