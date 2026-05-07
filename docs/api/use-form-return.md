# The useForm return value

`useForm(options)` returns a single object with every reactive
piece of form state as a named field. Grouped by concern:

## Reading values

Pinia-style proxies — dot-access leaves directly, no `.value`, in
templates and scripts identically. Read types widen primitive-literal
leaves to their primitive supertype (`'red' | 'green' | 'blue'` →
`string`) to match what the store can hold under the
[slim-write contract](#slim-write-contract).

Array-crossing paths taint with `| undefined`: once a path crosses
a numeric segment, every result is `T | undefined`. Tuple positions
stay strict. For the strict, post-validation shape, route through
`handleSubmit` / `validate*()`.

`values`, `fields`, `errors` are callable Proxies. **At leaf paths**,
dot-access and call-form converge — `form.fields.email.dirty` ≡
`form.fields('email').dirty` ≡ `form.fields(['email']).dirty`. **At
container paths** they split: dot-access keeps drilling
(`form.fields.pickup.street.dirty`); call-form returns the
aggregated `FieldState` directly (`form.fields('pickup').valid`,
`form.errors('pickup')`). Single-bracket dotted access
(`form.errors['user.email']`) is NOT supported — JS object
semantics treat the dotted string as a single key.

| Member        | Type                                                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `values`      | `ValuesSurface<WriteShape<Form>>`                              | Whole-form reactive read. `form.values.email`, `form.values.address.city`, `form.values.posts[0]?.title`. Containers ARE useful — `form.values.address` returns the subtree object AND keeps drilling. Array element types are strict (`tags: string[]`); the safety on `arr[N]` reads relies on the consumer's `noUncheckedIndexedAccess: true` tsconfig flag, which TypeScript correctly suppresses on iteration so `v-for` / `for-of` keep `T`. Auto-unwraps in templates and scripts. `form.values('a.b.c')` and `form.values()` available for dynamic / programmatic access.                                                                                                                                         |
| `fields`      | `FieldStateMap<Form>`                                          | Reactive per-field state map. Dot-access descends; reserved `FieldState` keys (`value`, `dirty`, `errors`, `validating`, `valid`, `blank`, `connected`, `label`, `element`, `elements`, …) inject ONLY at the FieldState terminal — a schema field named for one of those keys at depth 2+ is reachable as a descent target (no shadowing). Call-form returns `FieldState` at any depth: `form.fields('pickup').valid` (all descendants valid), `form.fields('pickup').dirty` (any descendant dirty), `form.fields('pickup').errors` (active-variant aggregate), `form.fields('pickup').label` (registry-derived). `.element` / `.elements` give the registered DOM nodes for native ops (`focus()`, `scrollIntoView()`). |
| `errors`      | `FormErrorsSurface<Form>`                                      | Drillable per-leaf error proxy. Dot-access descends: `form.errors.email?.[0]?.message`. Call-form aggregates: `form.errors('pickup')` returns `readonly ValidationError[] \| undefined` for the prefix at any depth, with active-variant (DU) filtering and schema-declaration ordering. Schema entries first, user entries second. See [error store](#error-store).                                                                                                                                                                                                                                                                                                                                                      |
| `toRef(path)` | `(path: FlatPath<Form>) => Readonly<Ref<NestedReadType<...>>>` | Escape hatch — get a `Readonly<Ref>` at `path` for `watch()` or external composables that expect ref-shaped inputs. Read type matches `form.values.<path>` (slim-widened, array-tainted).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Writing values

### Slim-write contract

Writes are gated on primitive `typeof`-style checks (`string`,
`number`, `boolean`, `bigint`, `Date`, `null`, `undefined`, plain
object, array, `Map`, `Set`). Refinement-level constraints
(`z.enum`, `.email()`, `.min(N)`, regex) surface as field errors,
not write rejections.

`WriteShape<T>` (the TS reflection) widens primitive-literal leaves
to their primitive supertype, preserves objects, tuples, arrays;
`Date`, `RegExp`, `Map`, `Set`, and functions pass through unchanged.

`setValue` and field-array helpers return `boolean` — `false` on
slim-primitive rejection or out-of-range index. Rejected writes
emit a one-shot dev warning per `(path, kind)`.

After every `setValue`, the form satisfies the slim schema: sparse
array writes auto-pad missing indices from the schema default, and
partial object writes get sibling keys filled. Path-form callback
`prev` is `NonNullable<NestedType<Form, Path>>` — fully defaulted
before the callback fires.

### Surfaces

| Member                     | Signature                                                                                                                                                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setValue(value)`          | `<V extends SetValuePayload<WriteShape<Form>, WriteShape<Form>>>(value: V) => boolean`                                                                               | Replace the whole form. Callback form's `prev` widens via `WriteShape<Form>` (matching what's actually storable). Array `prev.posts[N]` reads get `\| undefined` from the consumer's `noUncheckedIndexedAccess: true`; iteration over `prev.posts` stays strict. Returns `false` if the slim-primitive gate rejects. Programmatic — does NOT trigger persistence.                                                                                                                                                                                                                                                    |
| `setValue(path, value)`    | `<P extends FlatPath<Form>, V extends SetValuePayload<WriteShape<NestedType<Form, P>>, NonNullable<WriteShape<NestedType<Form, P>>>>>(path: P, value: V) => boolean` | Replace a single leaf or sub-tree. Callback form's `prev` is `NonNullable<WriteShape<NestedType<Form, P>>>` — runtime auto-defaults missing slots before the callback fires. Returns `false` on slim-primitive rejection. Programmatic — does NOT trigger persistence.                                                                                                                                                                                                                                                                                                                                               |
| `register(path, options?)` | `(path: P, options?: RegisterOptions) => RegisterValue<NestedReadType<WriteShape<Form>, P>>`                                                                         | Produces the binding the `v-register` directive consumes. `innerRef`'s read type widens via `WriteShape<Form>` (matches what's storable) and carries `\| undefined` at array-crossing paths; the directive renders `undefined` as empty correctly. `options.persist: true` opts the field into persistence; `options.acknowledgeSensitive: true` overrides the sensitive-name heuristic; `options.transforms: [...]` runs a sync pipeline on user input before it lands in form state (see [Transforms](/docs/api/core#transforms--registerpath--transforms-)). See [persistence recipe](/docs/recipes/persistence). |

## Validation + submission

| Member                     | Signature                                                  | What it does                                                                          |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `validate(path?)`          | `(path?) => Readonly<Ref<ReactiveValidationStatus<Form>>>` | Reactive validation result. Re-runs on form mutation; value carries a `pending` flag. |
| `validateAsync(path?)`     | `(path?) => Promise<ValidationResponseWithoutValue<Form>>` | Imperative one-shot. Resolves to the settled response.                                |
| `handleSubmit(cb, onErr?)` | `(cb, onErr?) => (event?) => Promise<void>`                | Builds a submit handler. Awaits validation internally.                                |

`ReactiveValidationStatus<Form>` is a discriminated union on
`pending` — narrow on `status.pending` before trusting `success` /
`errors`. See [async-validation recipe](/docs/recipes/async-validation).

## Error store

Errors are stored source-segregated under the hood — `schemaErrors`
(written by the validation pipeline) and `userErrors` (written by the
APIs below). The public surfaces below merge both transparently
(schema-first, user-second). User-injected errors **survive** schema
revalidation and successful submits — the consumer owns their lifecycle
explicitly.

| Member                    | Type                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errors`                  | `FormErrorsSurface<Form>` — drillable callable Proxy. Dot-access descends; call-form aggregates and returns `readonly ValidationError[] \| undefined` at any path. Active-variant (DU) filtered, sorted by schema-declaration order. Schema entries first, user entries second. |
| `setFieldErrors(errors)`  | `(ValidationError[]) => void` — replaces the user-error store. For server / API responses, parse the payload via `parseApiErrors` (top-level helper) and feed the result here. See [server-errors recipe](/docs/recipes/server-errors).                                         |
| `addFieldErrors(errors)`  | `(ValidationError[]) => void` — appends to the user-error store.                                                                                                                                                                                                                |
| `clearFieldErrors(path?)` | `(path?) => void` — clears BOTH stores at the given path (or all paths if omitted). With live validation, the schema half re-populates on the next mutation if the value is still invalid.                                                                                      |

For a "show all errors" UI (path-keyed, form-level, unmapped server,
cross-field-refine), use `form.meta.errors` — the root-level aggregate
(active-variant filtered, schema-declaration ordered). Equivalent to
`form.errors()` and `form.fields().errors`; same computed under the
hood.

## Form-level meta

`form.meta` extends `FieldState<Form>` at the root path and adds the
form-lifecycle fields below. Every key on `FieldState` resolves on
`meta` — `meta.dirty` (any-leaf dirty), `meta.valid` (all-leaves
valid), `meta.errors` (active-variant aggregate), `meta.label`,
`meta.value`, `meta.element`, etc. The full type is the exported
`FormMeta<Form>` interface. Vue's reactive auto-unwraps refs at
property access, so `form.meta.submitting` is a primitive in both
templates and scripts — no `.value`.

| Member             | Type      | What it does                                                                                                                                                                               |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `meta.submitting`  | `boolean` | `true` while the submit handler is running.                                                                                                                                                |
| `meta.submitCount` | `number`  | Incremented once per call, regardless of outcome.                                                                                                                                          |
| `meta.submitError` | `unknown` | Whatever the callback threw; `null` on success. Cleared on every new submission.                                                                                                           |
| `meta.canUndo`     | `boolean` | Gate an "Undo" button on this. Always present; `false` when `history` is off.                                                                                                              |
| `meta.canRedo`     | `boolean` | Gate a "Redo" button on this. Always present; `false` when `history` is off.                                                                                                               |
| `meta.historySize` | `number`  | Total snapshots across both stacks. `0` when `history` is off.                                                                                                                             |
| `meta.instanceId`  | `string`  | Per-`useForm()`-call identity. Stable for one mount, new on remount; orthogonal to `form.key`. Use for DevTools, telemetry, E2E selectors (`data-form-id`), and Vue `:key`. Opaque format. |

`meta` is read-only — assignments are rejected at runtime with a
dev warning. Watchers use the getter form:
`watch(() => form.meta.submitting, …)`.

## Focus + scroll

| Member                         | Signature               | What it does                                                                                                                                                      |
| ------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `focusFirstError(options?)`    | `(options?) => boolean` | Focuses the **visually-first** errored field's connected, visible element registered through this `useForm()` callsite. Returns `true` if an element was focused. |
| `scrollToFirstError(options?)` | `(options?) => boolean` | Scrolls that element into view. Returns `true` on success.                                                                                                        |

"Visually-first" is DOM-tree order via `compareDocumentPosition`.
CSS `order:` flexbox/grid reordering is not respected (DOM-tree
order wins).

Scope is per `useForm()` callsite: when two `useForm({ key })` calls
share a key, each callsite's `focusFirstError` only targets elements
registered through THAT callsite. `injectForm()` children inherit
their ancestor's instance ID, so parent-submit-focus reaches inputs
registered by deep children.

## Reset

| Member             | Signature                                                | What it does                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reset(next?)`     | `(next?: DeepPartial<DefaultValuesShape<Form>>) => void` | Re-seed the whole form. Rebuilds originals, clears errors + touched + submit state. Wipes the persisted draft if `persist:` is configured. Each leaf in `next` may be `unset` to mark the path displayed-empty post-reset. |
| `resetField(path)` | `(path: FlatPath<Form>) => void`                         | Restore one path (leaf or container) to its original value. Wipes the matching subpath from storage if `persist:` is configured.                                                                                           |

## Persistence (imperative)

| Member                       | Signature                                                                               | What it does                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `persist(path, options?)`    | `(path: FlatPath<Form>, options?: { acknowledgeSensitive?: boolean }) => Promise<void>` | One-shot read-merge-write of `path`'s current value. Bypasses the per-element opt-in gate and the debouncer. Throws `SensitivePersistFieldError` on sensitive paths unless acknowledged. Silent no-op when `persist:` isn't configured. |
| `clearPersistedDraft(path?)` | `(path?: FlatPath<Form>) => Promise<void>`                                              | Wipe the persisted entry. With `path`, removes only that subpath. Does NOT touch in-memory state or active opt-ins. Silent no-op when `persist:` isn't configured.                                                                      |

See [persistence recipe](/docs/recipes/persistence) for the per-field
opt-in model these APIs sit on top of.

## Undo / redo

| Member   | Type            | What it does                         |
| -------- | --------------- | ------------------------------------ |
| `undo()` | `() => boolean` | Revert to the previous snapshot.     |
| `redo()` | `() => boolean` | Replay a previously-undone snapshot. |

`undo()` and `redo()` are top-level methods. The matching flags
(`meta.canUndo`, `meta.canRedo`, `meta.historySize`) live on the
`meta` bundle above. Inert stubs when `history` isn't
configured — consistent API shape, zero overhead.

## Field arrays (typed)

All seven helpers return `boolean` — `true` on a successful write,
`false` when the slim-primitive gate rejects the value or the
operation is a no-op (out-of-range index on `remove` / `swap` /
`move` / `replace`). Element types widen via
`WriteShape<ArrayItem<...>>` to match what the store can hold.

| Member                        | Returns   | Notes                                                                  |
| ----------------------------- | --------- | ---------------------------------------------------------------------- |
| `append(path, value)`         | `boolean` | Path narrowed to `ArrayPath<Form>`; value widened via `WriteShape<…>`. |
| `prepend(path, value)`        | `boolean` | Same typing as `append`.                                               |
| `insert(path, index, value)`  | `boolean` | Same typing as `append`; index numeric.                                |
| `remove(path, index)`         | `boolean` | Numeric index. `false` on out-of-range.                                |
| `swap(path, a, b)`            | `boolean` | Two numeric indices. `false` on out-of-range.                          |
| `move(path, from, to)`        | `boolean` | Two numeric indices. `to` clamped to `[0, length]`.                    |
| `replace(path, index, value)` | `boolean` | Never grows the array; `false` on out-of-range.                        |

See [dynamic-field-arrays recipe](/docs/recipes/dynamic-field-arrays)
for the `v-for` pattern.

## Blank introspection

| Member                | Type                  | What it does                                                                                                                                                                                                                                                                                                                   |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blankPaths.value`    | `ReadonlySet<string>` | Frozen snapshot of every path-key currently in the form's `blankPaths` set. Reactive — Vue tracks `.has()` / `.size` / iteration. Mutating the snapshot is a no-op (writes go through `setValue(_, unset)`, the directive's input listener, or `markBlank()` on a register binding). See `unset` exported from the core entry. |
| `fields.<path>.blank` | `boolean`             | Per-path equivalent: `true` while `path` is in the form's `blankPaths` set.                                                                                                                                                                                                                                                    |

## Identity

| Member | Type      | What it does                              |
| ------ | --------- | ----------------------------------------- |
| `key`  | `FormKey` | The form's key (echoes the `key` option). |
