---
title: 'Shared types'
description: 'Reference for every public type Attaform exports — paths, write shapes, field state, validation, submit lifecycle, persistence, schema contract.'
---

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
  CustomDirectiveRegisterAssignerFn,
  DeepPartial,
  DefaultValuesResponse,
  DefaultValuesShape,
  FieldMetaPayload,
  FieldState,
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

The detailed entries below cover the types you'll reach for most often. Anything in the import block without its own section works as its TypeScript signature alone — the source's JSDoc is the canonical reference.

## Path types

### `FlatPath`

Union of every addressable path for the form. Dotted strings.

### `NestedType`

The strict leaf type at `Path`. Used for write-side APIs (`setValue` value argument) and for the path-form callback's `prev` — the runtime auto-defaults the slot before invoking the callback.

### `NestedReadType`

The read-side leaf type. Walks the path tracking whether a numeric segment was crossed; once tainted, all subsequent results are `T | undefined`. Tuple positions stay strict. Composed with [`WriteShape`](#writeshape) at the call site for `register`, `values`, `fields`, and `toRef`.

### `IsTuple`

`true` for tuples (literal `length`), `false` for unbounded arrays (`length: number`). Used internally by `NestedReadType` to decide whether to taint past a numeric segment.

## Write shapes

### `WriteShape`

Recursive mapped type that widens primitive-literal leaves to their primitive supertype:

- `'red' | 'green'` → `string`
- `42` → `number`
- Nested objects recurse; tuples preserve positions; unbounded arrays widen elements.
- `Date`, `RegExp`, `Map`, `Set`, and functions pass through unchanged.

Applied to read surfaces that observe storage (`form.values`, `form.fields.<path>.value`, `register.innerRef`). NOT applied to `handleSubmit` or `validate*()` payloads — those run after validation, so the strict zod-inferred shape is honest there.

### `DefaultValuesShape`

`WriteShape<T>` plus the `unset` sentinel admitted at every primitive leaf (`string`, `number`, `boolean`, `bigint`). Applied to the write surfaces that accept intent (`defaultValues`, `setValue`'s value, `reset`'s argument, field-array helpers). Non-primitive leaves (`Date`, `RegExp`, etc.) stay strict — `defaultValues: { joinedAt: unset }` against `z.date()` is a type error.

### `Unset`

The brand-typed `unique symbol` flavor of the `unset` sentinel for type-level usage. The runtime symbol is exported alongside under the same name from `attaform`.

## setValue payloads

### `SetValuePayload`

Union of `Write` and `SetValueCallback<Read>`. The whole-form `setValue` parameterises both to `WriteShape<Form>` (`prev` matches `form.values`); the path-form parameterises `Read` to `NonNullable<NestedType<F, P>>`.

### `SetValueCallback`

`(prev: Read) => Read`. The callback's return shape matches its input shape; runtime `mergeStructural` completes any structural gaps.

## Field arrays

### `ArrayPath`

`FlatPath<Form>` filtered to array-leaf paths. The path-constraint type used by `append` / `prepend` / `insert` / `remove` / `swap` / `move` / `replace`.

### `ArrayItem`

The element type of the array at `Path`. Field-array helpers parameterise their `value` argument by `WriteShape<ArrayItem<Form, Path>>`.

## Field state

### `FieldState`

Runtime shape returned by `form.fields.<path>` and `form.fields(path)`. Same shape at every path — leaf or container.

Fields by concern:

- **Identity** — `path`
- **Value** — `value`, `original`
- **Change** — `pristine`, `dirty`, `updatedAt`
- **Interaction** — `focused`, `blurred`, `touched`, `connected`
- **Validation** — `valid`, `validating`, `errors`
- **Emptiness** — `blank`
- **DOM** — `element`, `elements`
- **Metadata** — `label`, `description`, `placeholder`, `meta`

At containers the keys aggregate over active-variant descendants — event-presence by disjunction (`dirty`, `focused`, `touched`, `validating`), uniformity by conjunction (`pristine`, `valid`, `blank`). See [the fields surface](/docs/api/use-form-return#reading-values).

### `FieldStateMap`

The recursive type behind `form.fields`. Dot-access descends through nested objects; call-form (`form.fields('pickup')`) returns a [`FieldState`](#fieldstate) at any depth. Schema fields whose names collide with `FieldState` keys at depth ≥ 2 stay reachable as descent targets — leaf-keys inject only at the FieldState terminal.

### `FieldMetaPayload`

Schema-attached metadata payload: `label?`, `description?`, `placeholder?`. Declared as an `interface` so consumers can extend it via TypeScript module augmentation. Written via `schema.register(fieldMeta, {...})` (Zod 4) or `withMeta(schema, {...})` (helper, both v3 and v4); read off `form.fields(p).meta`. See [Schema-attached metadata](/docs/api/zod#schema-attached-metadata) for usage.

### `MetaTrackerValue`

Internal per-leaf record (`updatedAt`, `rawValue`, `connected`, `formKey`, `path`, `blank`). Surfaced for custom-adapter authors who thread metadata through their own pipelines; most consumers don't reach for it directly — the matching fields appear with friendlier shape on [`FieldState`](#fieldstate).

## Form-level meta and errors

### `FormMeta`

`FieldState<Form> & { submitting, submitCount, submitError, canUndo, canRedo, historySize, instanceId }`.

The shape of `form.meta`. Inherits every `FieldState` field at the root path (so `meta.dirty`, `meta.valid`, `meta.errors`, `meta.label`, `meta.element`, etc. all resolve) and adds the form-lifecycle fields.

### `FormErrorsSurface`

The shape of `form.errors`. Drillable callable Proxy: dot-access descends; call-form aggregates and returns `readonly ValidationError[] | undefined` at any path (active-variant filtered, sorted by schema-declaration order).

## Validation

### `ValidationError`

```ts
{
  path: readonly Segment[]
  message: string
  formKey: FormKey
  code: string
}
```

### `ValidateOn`

`'change' | 'blur' | 'submit'`. The trigger for per-field validation. Default `'change'`. `'submit'` opts out of live validation entirely (submit is the only validator).

### `ValidateOnConfig`

Discriminated union over `validateOn` that enforces `debounceMs` is only valid with `'change'`. The public `useForm` signature intersects `UseFormConfiguration` with this so pairing `debounceMs` with `'blur'` / `'submit'` is a TS error rather than a silent runtime drop.

## Coercion

### `CoercionEntry`

```ts
{
  input: I
  output: O
  transform: (value) => CoercionResult<O>
}
```

Where `I`, `O` extend `SlimPrimitiveKind`. One coercion rule. Author with `defineCoercion(...)` for narrowed `transform` parameter typing.

### `CoercionRegistry`

`readonly CoercionEntry[]`. The shape consumed by `useForm({ coerce })` and `defaults.coerce`. Spread `defaultCoercionRules` to extend rather than replace.

### `CoercionResult`

```ts
{ coerced: true; value: O } | { coerced: false }
```

Returned by a `CoercionEntry.transform`. Returning `{ coerced: false }` signals "this rule doesn't apply" — the write passes through untouched.

### `SlimPrimitiveKind`

The set of primitive `typeof`-style kinds the slim-write contract recognises:

`'string'`, `'number'`, `'boolean'`, `'bigint'`, `'date'`, `'null'`, `'undefined'`, `'object'`, `'array'`, `'symbol'`, `'function'`, `'map'`, `'set'`.

Returned by `AbstractSchema.getSlimPrimitiveTypesAtPath(path)`.

## Schema contract

### `AbstractSchema`

The schema contract. Ten required methods:

`fingerprint`, `getDefaultValues`, `getDefaultAtPath`, `arrayShapeAtPath`, `getSchemasAtPath`, `validateAtPath`, `getSlimPrimitiveTypesAtPath`, `isLeafAtPath`, `isRequiredAtPath`, `getUnionDiscriminatorAtPath`.

Two optional hooks:

- `getFieldMetaAtPath` — drives the schema-attached metadata surface.
- `needsAsyncValidation` — async-detection at the schema level.

See the [custom-adapter recipe](/docs/recipes/custom-adapter) for the full contract.

## Register and directive

### `RegisterDirective`

The union of every `v-register` directive variant (text input, select, checkbox, radio, dynamic). Most consumers use this only when augmenting Vue's `GlobalDirectives` manually; the Nuxt module wires it automatically.

### `RegisterFlatPath`

The path-constraint type used by `register(path)`. Consumers wrapping `register` in higher-order helpers can re-use it to type their wrapper's path parameter.

### `RegisterTransform`

`(value: unknown) => unknown`. Element of `register(path, { transforms: [...] })`. Generic-erased so a personal library of transforms plugs into any path. See [Transforms](/docs/api/core#transforms--registerpath--transforms-).

### `CustomDirectiveRegisterAssignerFn`

Function shape for custom assigners installed via the exported `assignKey` symbol.

## Persistence

### `FormStorage`

The storage contract — four methods: `getItem`, `setItem`, `removeItem`, `listKeys`. See the [persistence recipe](/docs/recipes/persistence).
