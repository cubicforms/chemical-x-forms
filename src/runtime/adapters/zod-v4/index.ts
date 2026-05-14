/**
 * Zod v4 adapter entry point. Re-exports the adapter + the useForm
 * wrapper that threads zod-v4-specific schema types through
 * useAbstractForm.
 */
import type { z } from 'zod'
import { useAbstractForm } from '../../composables/use-abstract-form'
import { InvalidUseFormConfigError } from '../../core/errors'
import type { SchemaFactoryOptions } from '../../core/get-computed-schema'
import type {
  AbstractSchema,
  FormKey,
  ValidateOnConfig,
  UseFormReturnType,
  UseFormConfiguration,
} from '../../types/types-api'
import type { DefaultValuesInput, FlatPath, GenericForm, NestedType } from '../../types/types-core'
import { zodV4Adapter } from './adapter'
import type { StorageShape } from './types-storage-shape'

export { zodV4Adapter as zodAdapter } from './adapter'
export { UnsupportedSchemaError } from './errors'
export { assertZodVersion, kindOf } from './introspect'
export type { ZodKind } from './introspect'
export type { StorageLeaf, StorageShape } from './types-storage-shape'

/**
 * Type of the value accepted at `Path` for `setValue` / `defaultValues`
 * — the schema's `z.input<Schema>` shape at that path. Matches what
 * `form.values.X` returns at runtime (the honest input view storage
 * holds before transforms run).
 *
 * ```ts
 * const schema = z.object({
 *   flag: z.string().transform((v) => v.length > 10),
 * })
 * type FlagWriteIn = PathInput<typeof schema, 'flag'> // string
 * ```
 */
export type PathInput<Schema extends z.ZodType, Path extends string> =
  z.input<Schema> extends GenericForm
    ? Path extends FlatPath<z.input<Schema>>
      ? NestedType<z.input<Schema>, Path>
      : never
    : never

/**
 * Type produced at `Path` after the full parse pipeline — the schema's
 * `z.output<Schema>` shape at that path. Matches the `data` payload of
 * `form.process()` and the value handed to `handleSubmit`'s callback.
 *
 * ```ts
 * const schema = z.object({
 *   flag: z.string().transform((v) => v.length > 10),
 * })
 * type FlagParsedOut = PathOutput<typeof schema, 'flag'> // boolean
 * ```
 */
export type PathOutput<Schema extends z.ZodType, Path extends string> =
  z.output<Schema> extends GenericForm
    ? Path extends FlatPath<z.output<Schema>>
      ? NestedType<z.output<Schema>, Path>
      : never
    : never

/**
 * Create a form bound to a Zod v4 schema.
 *
 * ```ts
 * import { useForm } from 'attaform/zod'
 * import { z } from 'zod'
 *
 * const form = useForm({
 *   schema: z.object({
 *     email: z.email(),
 *     password: z.string().min(8),
 *   }),
 *   defaultValues: { email: '' },
 * })
 * ```
 *
 * Returns a form API exposing `register`, `values`, `errors`,
 * `fields`, `setValue`, `handleSubmit`, `meta`, field-array
 * helpers, and more. See `UseFormReturnType` for the full
 * surface.
 *
 * For Zod v3, import from `attaform/zod-v3` instead.
 */
/**
 * `FormOf` / `OutOf` / `ReadOf` factor the three identical-shape
 * conditionals out of `useForm`'s public signature. The bundled
 * `.d.ts` then carries one alias per shape rather than re-inlining
 * `z.input<Schema> extends GenericForm ? z.input<Schema> : never`
 * four times — which is what produces TS2589 ("Type instantiation
 * is excessively deep") on consumer call sites with complex schemas
 * (discriminated unions, transform pipes, deep `.register()` chains).
 * Each alias is computed once per `Schema` instantiation; downstream
 * generics ride on the alias rather than re-evaluating the
 * conditional from scratch.
 */
type FormOf<Schema extends z.ZodObject> =
  z.input<Schema> extends GenericForm ? z.input<Schema> : never
type OutOf<Schema extends z.ZodObject> =
  z.output<Schema> extends GenericForm ? z.output<Schema> : never
type ReadOf<Schema extends z.ZodObject> =
  StorageShape<Schema> extends GenericForm ? StorageShape<Schema> : never

export function useForm<Schema extends z.ZodObject, K extends FormKey = FormKey>(
  configuration: Omit<
    UseFormConfiguration<
      FormOf<Schema>,
      OutOf<Schema>,
      AbstractSchema<FormOf<Schema>, OutOf<Schema>>,
      DefaultValuesInput<FormOf<Schema>>,
      K
    >,
    'schema' | 'validateOn' | 'debounceMs'
  > & { schema: Schema } & ValidateOnConfig
): UseFormReturnType<FormOf<Schema>, OutOf<Schema>, ReadOf<Schema>, K> {
  // Foot-gun guard: catches `useForm(z.object({...}))` (raw schema as
  // the first arg — its `.schema` field is undefined), `useForm()` (no
  // args), and `useForm({ schema: undefined })` before they reach the
  // adapter and crash deep with an opaque message. JS callers and
  // `as any` callers can defy the static signature; the `unknown`
  // cast forces the runtime checks to stay live under tsc.
  const candidate = configuration as unknown
  if (
    candidate === undefined ||
    candidate === null ||
    (candidate as { schema?: unknown }).schema === undefined
  ) {
    throw new InvalidUseFormConfigError()
  }
  // Three-slot generic split:
  //  - `Form` (z.input) is the WRITE view — what setValue / register
  //    / defaultValues accept. Loose for honest-input wrappers
  //    (preprocess accepts `unknown` at the write boundary).
  //  - `Out` (z.output) is the parsed-output view — what handleSubmit
  //    and form.process() yield. Refinements have fired, transforms
  //    have run.
  //  - `Read` (StorageShape) is the READ view — what form.values /
  //    form.fields / register's read side / toRef expose. Per-key
  //    z.output for write-boundary wrappers (default / preprocess /
  //    etc.) so defaulted leaves type as `T` (not `T | undefined`),
  //    z.input for transforms (storage holds pre-transform input).
  type Form = z.input<Schema> extends GenericForm ? z.input<Schema> : never
  type Out = z.output<Schema> extends GenericForm ? z.output<Schema> : never
  type Read = StorageShape<Schema> extends GenericForm ? StorageShape<Schema> : never
  // `zodV4Adapter` returns a factory
  // `(formKey, options: SchemaFactoryOptions) => AbstractSchema`;
  // `UseFormConfiguration.schema` accepts `Schema | ((key, options) => Schema)`,
  // so the factory is a first-class input — previously the call site cast it
  // through `unknown as AbstractSchema`, which converted a function to an
  // object type and hid the mismatch. The narrower cast below preserves the
  // factory shape at the boundary so per-form `maxRecursionDepth` threads
  // through cleanly.
  const adapter: (key: FormKey, options: SchemaFactoryOptions) => AbstractSchema<Form, Out> =
    zodV4Adapter(configuration.schema) as (
      key: FormKey,
      options: SchemaFactoryOptions
    ) => AbstractSchema<Form, Out>
  // The discriminated `ValidateOnConfig` doesn't narrow cleanly through
  // `Omit` + spread — TS picks the wrong variant after the structural
  // rebuild. The runtime input is genuinely the right shape (the
  // public `useForm` signature already enforced the discriminant on
  // `configuration` before we got here), so cast to the parameter
  // type to side-step the structural disagreement.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return useAbstractForm<Form, Out, Read, K>({
    ...configuration,
    schema: adapter,
  } as Parameters<typeof useAbstractForm<Form, Out, Read, K>>[0])
}
