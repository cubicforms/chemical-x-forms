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
import type {
  DeepPartial,
  DefaultValuesShape,
  FlatPath,
  GenericForm,
  NestedType,
} from '../../types/types-core'
import { zodV4Adapter } from './adapter'
import type { ReadShape } from './types-read-shape'

export { zodV4Adapter as zodAdapter } from './adapter'
export { UnsupportedSchemaError } from './errors'
export { assertZodVersion, kindOf } from './introspect'
export type { ZodKind } from './introspect'
export type { ReadShape, ReadShapeField } from './types-read-shape'

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
export function useForm<Schema extends z.ZodObject>(
  configuration: Omit<
    UseFormConfiguration<
      z.input<Schema> extends GenericForm ? z.input<Schema> : never,
      z.output<Schema> extends GenericForm ? z.output<Schema> : never,
      AbstractSchema<
        z.input<Schema> extends GenericForm ? z.input<Schema> : never,
        z.output<Schema> extends GenericForm ? z.output<Schema> : never
      >,
      DeepPartial<DefaultValuesShape<z.input<Schema> extends GenericForm ? z.input<Schema> : never>>
    >,
    'schema' | 'validateOn' | 'debounceMs'
  > & { schema: Schema } & ValidateOnConfig
): UseFormReturnType<
  z.input<Schema> extends GenericForm ? z.input<Schema> : never,
  z.output<Schema> extends GenericForm ? z.output<Schema> : never,
  ReadShape<Schema> extends GenericForm ? ReadShape<Schema> : never
> {
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
  // Two-slot generic split: `Form` is the storage / write shape
  // (z.input — pre-transform), `Out` is the parsed output shape
  // (z.output — post-transform). `handleSubmit` and `form.process()`
  // resolve to `Out`; every write- and path-addressed API resolves
  // to `Form`.
  type Form = z.input<Schema> extends GenericForm ? z.input<Schema> : never
  type Out = z.output<Schema> extends GenericForm ? z.output<Schema> : never
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
  type Read = ReadShape<Schema> extends GenericForm ? ReadShape<Schema> : never
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return useAbstractForm<Form, Out, Read>({
    ...configuration,
    schema: adapter,
  } as Parameters<typeof useAbstractForm<Form, Out, Read>>[0])
}
