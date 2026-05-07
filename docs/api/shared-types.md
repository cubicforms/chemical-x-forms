# Types

All types listed below are exported from the core entry:

```ts
import type {
  AbstractSchema,
  ApiErrorDetails,
  ApiErrorEnvelope,
  ArrayItem,
  ArrayPath,
  CoercionEntry,
  CoercionRegistry,
  CoercionResult,
  CurrentValueContext,
  CurrentValueWithContext,
  CustomDirectiveRegisterAssignerFn,
  DeepPartial,
  DefaultValuesResponse,
  DefaultValuesShape,
  FieldState,
  FieldStateLeaf,
  FieldStateMap,
  FieldStateMapEntry,
  FlatPath,
  FormErrorRecord,
  FormErrorsSurface,
  FormKey,
  FormMeta,
  FormStorage,
  FormStorageKind,
  GenericForm,
  HandleSubmit,
  HistoryConfig,
  IsTuple,
  MetaTrackerValue,
  NestedReadType,
  NestedType,
  OnError,
  OnInvalidSubmitPolicy,
  OnSubmit,
  ParseApiErrorsOptions,
  ParseApiErrorsResult,
  PendingValidationStatus,
  PersistConfig,
  PersistConfigOptions,
  PersistIncludeMode,
  ReactiveValidationStatus,
  RegisterDirective,
  RegisterFlatPath,
  RegisterTransform,
  RegisterValue,
  SetValueCallback,
  SetValuePayload,
  SettledValidationStatus,
  SlimPrimitiveKind,
  SubmitHandler,
  Unset,
  UseFormReturnType,
  UseFormConfiguration,
  ValidateOn,
  ValidateOnConfig,
  ValidationError,
  ValidationResponse,
  ValidationResponseWithoutValue,
  WriteShape,
} from 'attaform'
```

The ones you'll touch most:

- **`FlatPath<Form>`** — union of every addressable path for the
  form. Dotted strings.
- **`NestedType<Form, Path>`** — the strict leaf type at `Path`.
  Used for write-side APIs (`setValue` value argument) and for
  the path-form callback's `prev` (the runtime auto-defaults the
  slot before invoking the callback).
- **`NestedReadType<Form, Path>`** — the read-side leaf type. Walks
  the path tracking whether a numeric segment was crossed; once
  tainted, all subsequent results are `T | undefined`. Tuple
  positions stay strict. Composed with `WriteShape<...>` (see
  below) at the call site for `register`, `values`, `fields`,
  and `toRef`.
- **`WriteShape<T>`** — recursive mapped type that widens primitive-
  literal leaves to their primitive supertype. `'red' | 'green'` →
  `string`; `42` → `number`; nested objects recurse; tuples
  preserve positions; unbounded arrays widen elements; `Date`,
  `RegExp`, `Map`, `Set`, and functions pass through unchanged.
  Applied to read surfaces that observe storage (`form.values`,
  `form.fields.<path>.value`, `register.innerRef`). NOT applied
  to `handleSubmit` or `validate*()` payloads — those run after
  validation, so the strict zod-inferred shape is honest there.
- **`DefaultValuesShape<T>`** — `WriteShape<T>` plus the `unset`
  sentinel admitted at every primitive leaf (`string`, `number`,
  `boolean`, `bigint`). Applied to the write surfaces that accept
  intent (`defaultValues`, `setValue`'s value, `reset`'s argument,
  field-array helpers). Non-primitive leaves (`Date`, `RegExp`,
  etc.) stay strict — `defaultValues: { joinedAt: unset }` against
  `z.date()` is a type error.
- **`Unset`** — the brand-typed `unique symbol` flavor of the
  `unset` sentinel for type-level usage. The runtime symbol is
  exported alongside under the same name from `attaform`.
- **`IsTuple<T>`** — `true` for tuples (literal `length`), `false`
  for unbounded arrays (`length: number`). Used internally by
  `NestedReadType` to decide whether to taint past a numeric
  segment.
- **`SetValuePayload<Write, Read = Write>`** — union of `Write` and
  `SetValueCallback<Read>`. The whole-form `setValue` parameterises
  both to `WriteShape<Form>` (`prev` matches `form.values`); the
  path-form parameterises `Read` to `NonNullable<NestedType<F, P>>`.
- **`SetValueCallback<Read>`** — `(prev: Read) => Read`. The
  callback's return shape matches its input shape; runtime
  mergeStructural completes any structural gaps.
- **`ArrayPath<Form>`** — `FlatPath<Form>` filtered to array-leaf
  paths. Used by `append` / `remove` / etc.
- **`ArrayItem<Form, Path>`** — the element type of the array at
  `Path`.
- **`ValidationError`** — `{ path: readonly Segment[]; message:
string; formKey: FormKey }`.
- **`FieldStateLeaf<Value>`** — runtime shape of a single
  `form.fields.<path>` read: `value` / `original` (typed
  `Value`), `pristine` / `dirty` / `blank` (booleans), `focused` /
  `blurred` / `touched` (`boolean | null`), `errors`
  (`readonly ValidationError[]`), `path`, `connected`, `updatedAt`.
  Schema fields with names matching these leaf keys at depth ≥ 2
  are shadowed by the leaf — bracket-access via `toRef` is the
  workaround.
- **`FieldStateMap<Form>`** — the recursive type behind
  `form.fields`. Top-level fields and nested objects are
  reachable via dot-descent; leaf keys (`value`, `dirty`, `errors`,
  …) read off the FieldStateLeaf at the current path.
- **`FieldState<Value = unknown>`** — richer per-field type kept for
  type-level utility code: `currentValue` / `originalValue` /
  `previousValue` (typed `Value`), the same flag set as
  `FieldStateLeaf`, plus `meta` (`MetaTrackerValue`). Returned by no
  current public API directly; useful when type-narrowing or
  building higher-order helpers.
- **`ValidateOn`** — `'change' | 'blur' | 'submit'`. The trigger for
  per-field validation. Default `'change'`. `'submit'` opts out of
  live validation entirely (submit is the only validator).
- **`ValidateOnConfig`** — discriminated union over `validateOn` that
  enforces `debounceMs` is only valid with `'change'`. The public
  `useForm` signature intersects `UseFormConfiguration` with this so
  pairing `debounceMs` with `'blur'` / `'submit'` is a TS error
  rather than a silent runtime drop.
- **`RegisterTransform`** — `(value: unknown) => unknown`. Element of
  `register(path, { transforms: [...] })`. Generic-erased so a
  personal library of transforms plugs into any path. See
  [Transforms](/docs/api/core#transforms--registerpath--transforms-).
- **`CoercionEntry<I, O>`** — `{ input: I; output: O; transform: (value) => CoercionResult<O> }`
  where `I`, `O` extend `SlimPrimitiveKind`. One coercion rule. Author
  with `defineCoercion(...)` for narrowed `transform` parameter typing.
- **`CoercionRegistry`** — `readonly CoercionEntry[]`. The shape
  consumed by `useForm({ coerce })` and `defaults.coerce`. Spread
  `defaultCoercionRules` to extend rather than replace.
- **`CoercionResult<O>`** — `{ coerced: true; value: O } | { coerced: false }`.
  Returned by a `CoercionEntry.transform`. Returning `{ coerced: false }`
  signals "this rule doesn't apply" — the write passes through
  untouched.
- **`FormMeta`** — the shape of `form.meta`: form-level flags
  (`dirty`, `valid`, `submitting`, `validating`), counters
  (`submitCount`, `historySize`), the flat `errors` aggregate, and
  the per-mount `instanceId`.
- **`FormErrorsSurface<F>`** — the shape of `form.errors`. Drillable
  callable Proxy; per-leaf `ValidationError[] | undefined`. Replaces
  the pre-0.14 flat-record shape `Partial<Record<FlatPath<F>, ValidationError[]>>`.
- **`AbstractSchema`** — the schema contract (6 methods:
  `fingerprint`, `getDefaultValues`, `getDefaultAtPath`,
  `getSchemasAtPath`, `validateAtPath`, `getSlimPrimitiveTypesAtPath`).
  See [custom-adapter recipe](/docs/recipes/custom-adapter).
- **`SlimPrimitiveKind`** — the set of primitive `typeof`-style
  kinds the slim-write contract recognises: `'string'`, `'number'`,
  `'boolean'`, `'bigint'`, `'date'`, `'null'`, `'undefined'`,
  `'object'`, `'array'`, `'symbol'`, `'function'`, `'map'`, `'set'`.
  Returned by `AbstractSchema.getSlimPrimitiveTypesAtPath(path)`.
- **`MetaTrackerValue`** — per-leaf metadata: `updatedAt`,
  `rawValue`, `connected`, `formKey`, `path`. Read from
  `FieldState.meta` when type-narrowing through that surface.
- **`RegisterDirective`** — the union of every `v-register`
  directive variant (text input, select, checkbox, radio, dynamic).
  Most consumers use this only when augmenting Vue's `GlobalDirectives`
  manually; the Nuxt module wires it automatically.
- **`CustomDirectiveRegisterAssignerFn`** — function shape for
  custom assigners installed via the exported `assignKey` symbol.
- **`RegisterFlatPath<Form>`** — the path-constraint type used by
  `register(path)`. Consumers wrapping `register` in higher-order
  helpers can re-use it to type their wrapper's path parameter.
- **`FormStorage`** — the storage contract (4 methods: `getItem`,
  `setItem`, `removeItem`, `listKeys`). See
  [persistence recipe](/docs/recipes/persistence).
