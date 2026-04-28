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

type PartialFlatPath<Form, Key extends keyof Form = keyof Form> =
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
 * Used by every path-addressed API (`getValue(path)`,
 * `setValue(path, value)`, `register(path)`, etc.) so paths
 * autocomplete in the IDE and typos compile-error.
 *
 * Set `ForceFullPath` to `true` to restrict to leaf paths only
 * (no intermediate container paths) — used by `getFieldState`.
 */
export type FlatPath<
  Form,
  Key extends keyof Form = keyof Form,
  ForceFullPath extends boolean = false,
> = ForceFullPath extends true ? CompleteFlatPath<Form, Key> : PartialFlatPath<Form, Key>

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
        ? Key extends keyof _RootValue
          ? NestedType<_RootValue[Key], Rest, FilterOutNullishTypesDuringRecursion>
          : Key extends `${infer NumericKey extends number}`
            ? NumericKey extends keyof _RootValue
              ? NestedType<_RootValue[NumericKey], Rest, FilterOutNullishTypesDuringRecursion>
              : never
            : never
        : Key extends keyof _RootValue
          ? NestedType<_RootValue[Key], Rest, FilterOutNullishTypesDuringRecursion>
          : never
      : FlattenedPath extends `${number}`
        ? FlattenedPath extends keyof _RootValue
          ? _RootValue[FlattenedPath]
          : FlattenedPath extends `${infer NumericKey extends number}`
            ? NumericKey extends keyof _RootValue
              ? _RootValue[NumericKey]
              : never
            : never
        : FlattenedPath extends keyof _RootValue
          ? _RootValue[FlattenedPath]
          : never

// Helper type for primitive types (non-object and non-array)
type Primitive = string | number | boolean | symbol | bigint | null | undefined

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
 * Tags every unbounded array's element type with `| undefined` so
 * code reading `arr[N]` has to narrow before using the result. This
 * mirrors the runtime reality that out-of-bounds reads return
 * `undefined`.
 *
 * Used by `getValue()` and the whole-form `setValue((prev) => …)`
 * callback's `prev` argument so accessors are honest about
 * possibly-missing array positions. Tuple positions are preserved
 * unchanged — they're guaranteed by their position in the type.
 *
 * `Date`, `RegExp`, `Map`, `Set`, and function instances pass
 * through.
 */
export type WithIndexedUndefined<T> = T extends
  | Date
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | ((...args: never) => unknown)
  ? T
  : T extends ReadonlyArray<infer Item>
    ? IsTuple<T> extends true
      ? { -readonly [K in keyof T]: WithIndexedUndefined<T[K]> }
      : ReadonlyArray<WithIndexedUndefined<Item> | undefined>
    : T extends object
      ? { [K in keyof T]: WithIndexedUndefined<T[K]> }
      : T

/**
 * Path-resolved type for read-side APIs. Like `NestedType`, but once
 * the walk crosses an array index segment the resulting type is
 * tagged `| undefined` (the runtime can return undefined for
 * out-of-bounds reads).
 *
 * Used by `getValue(path)` and `register(path).innerRef` so the
 * compile-time type honours the runtime possibility of a missing
 * array position.
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
        ? Key extends keyof _RootValue
          ? NestedReadType<_RootValue[Key], Rest, true>
          : Key extends `${infer NumericKey extends number}`
            ? NumericKey extends keyof _RootValue
              ? NestedReadType<_RootValue[NumericKey], Rest, true>
              : never
            : never
        : Key extends keyof _RootValue
          ? NestedReadType<_RootValue[Key], Rest, _Tainted>
          : never
      : FlattenedPath extends `${number}`
        ? FlattenedPath extends keyof _RootValue
          ? _RootValue[FlattenedPath] | undefined
          : FlattenedPath extends `${infer NumericKey extends number}`
            ? NumericKey extends keyof _RootValue
              ? _RootValue[NumericKey] | undefined
              : never
            : never
        : FlattenedPath extends keyof _RootValue
          ? _Tainted extends true
            ? _RootValue[FlattenedPath] | undefined
            : _RootValue[FlattenedPath]
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
 * level constraints (enum membership, literal equality, .email,
 * .min(N), regex, custom refines) are NOT enforced at write time —
 * they surface via field-level validation. The type widening here
 * mirrors that runtime behaviour, so `setValue('color', 'magenta')`
 * and `defaultValues: { color: 'teal' }` are not TS errors despite
 * being out-of-enum at the validation layer.
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
export type WriteShape<T> = T extends string | number | boolean | bigint | null | undefined
  ? T extends string
    ? string
    : T extends number
      ? number
      : T extends boolean
        ? boolean
        : T extends bigint
          ? bigint
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
 * stay strict — `defaultValues: { joinedAt: unset }` against
 * `z.date()` is a type error.
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
export type DefaultValuesShape<T> = T extends string | number | boolean | bigint | null | undefined
  ? T extends string
    ? string | Unset
    : T extends number
      ? number | Unset
      : T extends boolean
        ? boolean | Unset
        : T extends bigint
          ? bigint | Unset
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
