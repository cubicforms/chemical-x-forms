/**
 * Unified `useForm` for the `attaform/zod` entry. Runtime-dispatches
 * on schema shape: a Zod v4 schema (`def.type` truthy) routes to the
 * v4 adapter; a Zod v3 schema (or any other `AbstractSchema`) routes
 * to the v3 wrapper, which already accepts both Zod v3 input and
 * `AbstractSchema` directly via its built-in shape branch.
 *
 * This module is the FALLBACK path. Vite consumers see the
 * `attaform/vite` plugin's `resolveId` hook rewrite `attaform/zod`
 * imports to either `attaform/zod-v3` or `attaform/zod-v4` at build
 * time — in that case this dispatch never runs and the consumer
 * bundle ships only the matching adapter. Other bundlers (and
 * non-bundled ESM consumption) hit this dispatch instead, paying a
 * modest size cost for the convenience of a single hello-world import.
 *
 * Power users who want a guaranteed lean bundle on non-Vite tooling
 * can import directly from `attaform/zod-v3` or `attaform/zod-v4` —
 * those subpaths are never rewritten and never load the other
 * adapter.
 */
import type { z } from 'zod'
import { InvalidUseFormConfigError } from '../../core/errors'
import { isZodV4SchemaShape } from '../../core/zod-shape'
import { useForm as useFormV3 } from '../../composables/use-form'
import { useForm as useFormV4 } from '../zod-v4'
import type {
  AbstractSchema,
  ValidateOnConfig,
  UseFormReturnType,
  UseFormConfiguration,
} from '../../types/types-api'
import type { DeepPartial, DefaultValuesShape, GenericForm } from '../../types/types-core'

/**
 * Create a form bound to a Zod schema. Accepts both Zod v3 and Zod v4
 * schemas; the runtime picks the right adapter from the schema's
 * shape.
 *
 * Type inference targets Zod v4 — the recommended major. Consumers
 * still on Zod v3 get correct runtime behavior here, but the strongest
 * TypeScript inference comes from importing `attaform/zod-v3`
 * directly.
 *
 * ```ts
 * import { useForm } from 'attaform/zod'
 * import { z } from 'zod'
 *
 * const form = useForm({
 *   schema: z.object({
 *     username: z.string().min(2, 'At least 2 characters'),
 *     password: z.string().min(8, 'At least 8 characters'),
 *   }),
 * })
 * ```
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
  z.output<Schema> extends GenericForm ? z.output<Schema> : never
> {
  // Foot-gun guard mirrors the typed wrappers'.
  if (
    configuration === undefined ||
    configuration === null ||
    (configuration as { schema?: unknown }).schema === undefined
  ) {
    throw new InvalidUseFormConfigError()
  }

  const { schema } = configuration as { schema: unknown }
  if (isZodV4SchemaShape(schema)) {
    return useFormV4(configuration as Parameters<typeof useFormV4<Schema>>[0]) as ReturnType<
      typeof useForm<Schema>
    >
  }
  // Anything else (Zod v3 schema, custom AbstractSchema, schema
  // factory) goes through the v3 wrapper, which already accepts both
  // Zod v3 input and AbstractSchema directly via its existing shape
  // branch. Cast through unknown — the unified entry's TS surface
  // tracks v4, but the runtime accepts the broader shape.
  return useFormV3(configuration as never) as unknown as ReturnType<typeof useForm<Schema>>
}
