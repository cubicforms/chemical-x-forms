export type GenericForm = Record<string, unknown>

type IsObjectOrArray<T> = T extends GenericForm
  ? true
  : T extends Array<unknown>
    ? true
    : false

type PartialFlatPath<
  Form,
  Key extends keyof Form = keyof Form,
> = IsObjectOrArray<Form> extends true
  ? Key extends string
    ? Form[Key] extends infer Value
      ? Value extends Array<infer ArrayItem>
        ?
        | `${Key}`
        | `${Key}.${number}`
        | `${Key}.${number}.${PartialFlatPath<ArrayItem>}`
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

export type CompleteFlatPath<
  Form,
  Key extends keyof Form = keyof Form,
> = IsObjectOrArray<Form> extends true
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

export type NestedType<
  RootValue,
  FlattenedPath extends string,
  FilterOutNullishTypesDuringRecursion extends boolean = true,
  _RootValue = FilterOutNullishTypesDuringRecursion extends false
    ? RootValue
    : NonNullable<RootValue>,
> = IsObjectOrArray<_RootValue> extends false
  ? never
  : FlattenedPath extends `${infer Key}.${infer Rest}`
    ? Key extends `${number}`
      ? Key extends keyof _RootValue
        ? NestedType<_RootValue[Key], Rest, FilterOutNullishTypesDuringRecursion>
        : Key extends `${infer NumericKey extends number}`
          ? NumericKey extends keyof _RootValue
            ? NestedType<
              _RootValue[NumericKey],
              Rest,
              FilterOutNullishTypesDuringRecursion
            >
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
