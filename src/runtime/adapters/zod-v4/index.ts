/**
 * Zod v4 adapter entry point. Re-exports the adapter + the useForm
 * wrapper that threads zod-v4-specific schema types through
 * useAbstractForm.
 */
import type { z } from 'zod'
import { useAbstractForm } from '../../composables/use-abstract-form'
import type {
  AbstractSchema,
  FormKey,
  ValidateOnConfig,
  UseFormReturnType,
  UseFormConfiguration,
} from '../../types/types-api'
import type { DeepPartial, DefaultValuesShape, GenericForm } from '../../types/types-core'
import { zodV4Adapter } from './adapter'

export { zodV4Adapter as zodAdapter } from './adapter'
export { UnsupportedSchemaError } from './errors'
export { assertZodVersion, kindOf } from './introspect'
export type { ZodKind } from './introspect'

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
      z.output<Schema> extends GenericForm ? z.output<Schema> : never,
      z.output<Schema> extends GenericForm ? z.output<Schema> : never,
      AbstractSchema<
        z.output<Schema> extends GenericForm ? z.output<Schema> : never,
        z.output<Schema> extends GenericForm ? z.output<Schema> : never
      >,
      DeepPartial<
        DefaultValuesShape<z.output<Schema> extends GenericForm ? z.output<Schema> : never>
      >
    >,
    'schema' | 'validateOn' | 'debounceMs'
  > & { schema: Schema } & ValidateOnConfig
): UseFormReturnType<
  z.output<Schema> extends GenericForm ? z.output<Schema> : never,
  z.output<Schema> extends GenericForm ? z.output<Schema> : never
> {
  type Form = z.output<Schema> extends GenericForm ? z.output<Schema> : never
  // `zodV4Adapter` returns a factory `(formKey: FormKey) => AbstractSchema`;
  // `UseFormConfiguration.schema` accepts `Schema | ((key) => Schema)`, so
  // the factory is a first-class input — previously the call site cast it
  // through `unknown as AbstractSchema`, which converted a function to an
  // object type and hid the mismatch. The narrower cast below preserves
  // the factory shape at the boundary.
  const adapter: (key: FormKey) => AbstractSchema<Form, Form> = zodV4Adapter(
    configuration.schema
  ) as (key: FormKey) => AbstractSchema<Form, Form>
  // The discriminated `ValidateOnConfig` doesn't narrow cleanly through
  // `Omit` + spread — TS picks the wrong variant after the structural
  // rebuild. The runtime input is genuinely the right shape (the
  // public `useForm` signature already enforced the discriminant on
  // `configuration` before we got here), so cast to the parameter
  // type to side-step the structural disagreement.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return useAbstractForm<Form, Form>({
    ...configuration,
    schema: adapter,
  } as Parameters<typeof useAbstractForm<Form, Form>>[0])
}
