/**
 * Zod v4 adapter entry point. Re-exports the adapter + the useForm
 * wrapper that threads zod-v4-specific schema types through
 * useAbstractForm.
 */
import type { z } from 'zod'
import { useAbstractForm } from '../../composables/use-abstract-form'
import type {
  AbstractSchema,
  UseAbstractFormReturnType,
  UseFormConfiguration,
} from '../../types/types-api'
import type { DeepPartial, GenericForm } from '../../types/types-core'
import { zodV4Adapter } from './adapter'

export { zodV4Adapter as zodAdapter } from './adapter'
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
      DeepPartial<z.output<Schema> extends GenericForm ? z.output<Schema> : never>
    >,
    'schema'
  > & { schema: Schema }
): UseAbstractFormReturnType<
  z.output<Schema> extends GenericForm ? z.output<Schema> : never,
  z.output<Schema> extends GenericForm ? z.output<Schema> : never
> {
  type Form = z.output<Schema> extends GenericForm ? z.output<Schema> : never
  const adapter = zodV4Adapter(configuration.schema)
  return useAbstractForm<Form, Form>({
    ...configuration,
    schema: adapter as unknown as AbstractSchema<Form, Form>,
  })
}
