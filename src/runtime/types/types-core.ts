export type GenericForm = Record<string, unknown>

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
export type FlatPath<
  Form,
  Key extends keyof Form = keyof Form,
  ForceFullPath extends boolean = false,
> = ForceFullPath extends true ? CompleteFlatPath<Form, Key> : PartialFlatPath<Form, Key>

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
 * Resolve the type at a dotted-string path within `RootValue`. The
 * recursion peels one segment per recursion step.
 *
 * **TS recursion-depth limit.** The TypeScript compiler caps conditional-
 * type recursion at 50 (under the `tsc` instantiation budget; tighter
 * for `--strict` builds). A path with more than ~45-50 segments will
 * resolve to `never` instead of the correct leaf type — TS gives up
 * silently rather than erroring at the call site. Real form schemas
 * never approach this limit, but consumers who hand-author paths via
 * `as` casts on extremely deep state should use a tuple-counter
 * variant or split the lookup into chunks.
 *
 * The runtime walker (`path-walker.ts`) has no such limit; only the
 * static type lookup is affected.
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
 * Distinguish a tuple from a regular array. Tuples have a literal
 * `length` (`2`, `3`, ...); arrays have `length: number`.
 *
 *   IsTuple<[string, number]>  // true
 *   IsTuple<string[]>          // false
 *
 * Used by `WithIndexedUndefined` to skip taint on tuple positions
 * (which are guaranteed to be defined at runtime once the tuple is
 * structurally complete) while still tainting unbounded array
 * elements (where `arr[N]` can return `undefined` for out-of-bounds
 * reads).
 */
export type IsTuple<T extends readonly unknown[]> = number extends T['length'] ? false : true

/**
 * "Honest read shape" for a form value. Tags every UNBOUNDED array's
 * element type with `| undefined` so consumer code that touches
 * `prev.posts[5]` or similar must narrow before using the result —
 * matching the runtime reality that array index reads can fall off
 * the end. Recurses into objects and tuple positions; leaves Date /
 * RegExp / Map / Set / class instances untouched.
 *
 * Used for:
 * - Whole-form callback `prev` in `setValue(cb)` (the live form is
 *   read; the runtime structural-completeness invariant guarantees
 *   the form is structurally complete after every write, but doesn't
 *   guarantee any particular array LENGTH).
 * - `getValue(path)` returns at array sub-paths.
 *
 * NOT applied to:
 * - Path-form callback `prev` in `setValue(path, cb)` — the runtime
 *   auto-defaults `prev` from `schema.getDefaultAtPath(path)` when
 *   the slot is missing, so the strict `NestedType` is honest there.
 * - `setValue` value form — write shapes stay strict so consumers
 *   can't accidentally pass partial-array values that the type
 *   system promises but the validation layer rejects.
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
 * Like `NestedType` but tracks whether a numerical-index segment was
 * crossed during the walk. Once tainted, every subsequent result is
 * `T | undefined`. Use for the READ side of path-walking APIs
 * (`getValue`, `register`'s value ref) where the runtime can return
 * `undefined` if the array index is out of bounds.
 *
 * The strict `NestedType` stays in place for write-side APIs and for
 * path-form callback prev (which is auto-defaulted at runtime).
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
