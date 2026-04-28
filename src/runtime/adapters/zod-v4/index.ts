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
  UseAbstractFormReturnType,
  UseFormConfiguration,
} from '../../types/types-api'
import type { DeepPartial, GenericForm, WriteShape } from '../../types/types-core'
import { zodV4Adapter } from './adapter'

export { zodV4Adapter as zodAdapter } from './adapter'
export { UnsupportedSchemaError } from './errors'
export { assertZodVersion, kindOf } from './introspect'
export type { ZodKind } from './introspect'

/**
 * Zod-typed useForm. Accepts a `z.ZodObject<...>` schema and wires it
 * through the v4 adapter + the abstract form.
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
      DeepPartial<WriteShape<z.output<Schema> extends GenericForm ? z.output<Schema> : never>>
    >,
    'schema'
  > & { schema: Schema }
): UseAbstractFormReturnType<
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
  return useAbstractForm<Form, Form>({
    ...configuration,
    schema: adapter,
  })
}
