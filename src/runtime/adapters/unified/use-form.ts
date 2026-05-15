/**
 * Unified `useForm` for the `attaform/zod` entry. Runtime-dispatches
 * on schema shape: a Zod v4 schema (`def.type` truthy) routes to the
 * v4 adapter; a Zod v3 schema (or any other `AbstractSchema`) routes
 * to the v3 wrapper, which already accepts both Zod v3 input and
 * `AbstractSchema` directly via its built-in shape branch.
 *
 * Type-level dispatch happens via TWO typed overloads — v4 first, v3
 * second — plus an untyped impl. Each overload mirrors the matching
 * direct adapter's signature exactly, so a v4-schema call site pays
 * the same per-call depth cost as importing from `attaform/zod-v4`
 * directly. Overload resolution at concrete call sites commits to one
 * overload immediately on argument shape — no type-level dispatch tax.
 *
 * Tests and other call sites that need the equivalent of
 * `typeof useForm<X>` should reach for the `UseFormReturn<X>` /
 * `UseFormConfig<X>` helpers in `types-api.ts` — instantiation
 * expressions on overloaded functions follow brittle resolution rules,
 * and the helper types give a deterministic projection.
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
import type { z as zV3 } from 'zod-v3'
import { InvalidUseFormConfigError } from '../../core/errors'
import { isZodV4SchemaShape } from '../../core/zod-shape'
import { useForm as useFormV3 } from '../../composables/use-form'
import { useForm as useFormV4 } from '../zod-v4'
import type { StorageShape as StorageShapeV4 } from '../zod-v4/types-storage-shape'
import type { StorageShape as StorageShapeV3 } from '../zod-v3/types-storage-shape'
import type { UnwrapZodObject } from '../zod-v3/types-zod-adapter'
import type {
  AbstractSchema,
  FormKey,
  ValidateOnConfig,
  UseFormReturnType,
  UseFormConfiguration,
} from '../../types/types-api'
import type { DefaultValuesInput, GenericForm } from '../../types/types-core'

// ───────────────────────────────────────────────────────────────────
// Per-major projection helpers. Each overload's constraint scopes the
// Schema to one Zod major, so the projection is a direct read — no
// dispatch in the type body. Mirrors the direct adapter shapes so the
// unified entry pays the same per-call depth cost as a direct import.
// ───────────────────────────────────────────────────────────────────

type V4FormOf<S extends z.ZodObject> = z.input<S> extends GenericForm ? z.input<S> : never
type V4OutOf<S extends z.ZodObject> = z.output<S> extends GenericForm ? z.output<S> : never
type V4ReadOf<S extends z.ZodObject> =
  StorageShapeV4<S> extends GenericForm ? StorageShapeV4<S> : never

type V3FormOf<S extends zV3.ZodObject<zV3.ZodRawShape>> =
  zV3.input<UnwrapZodObject<S>> extends GenericForm ? zV3.input<UnwrapZodObject<S>> : never
type V3OutOf<S extends zV3.ZodObject<zV3.ZodRawShape>> =
  zV3.output<UnwrapZodObject<S>> extends GenericForm ? zV3.output<UnwrapZodObject<S>> : never
type V3ReadOf<S extends zV3.ZodObject<zV3.ZodRawShape>> =
  StorageShapeV3<UnwrapZodObject<S>> extends GenericForm
    ? StorageShapeV3<UnwrapZodObject<S>>
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
 *     username: z.string().min(2, 'At least 2 characters'),
 *     password: z.string().min(8, 'At least 8 characters'),
 *   }),
 * })
 * ```
 *
 * v4 schemas match this overload first via their structural `def`
 * field. v3 schemas fall through to the v3 overload below.
 */
export function useForm<Schema extends z.ZodObject, K extends FormKey = FormKey>(
  configuration: Omit<
    UseFormConfiguration<
      V4FormOf<Schema>,
      V4OutOf<Schema>,
      AbstractSchema<V4FormOf<Schema>, V4OutOf<Schema>>,
      DefaultValuesInput<V4FormOf<Schema>>,
      K
    >,
    'schema' | 'validateOn' | 'debounceMs'
  > & { schema: Schema } & ValidateOnConfig
): UseFormReturnType<V4FormOf<Schema>, V4OutOf<Schema>, V4ReadOf<Schema>, K>
/**
 * Create a form bound to a Zod v3 schema.
 *
 * ```ts
 * import { useForm } from 'attaform/zod'
 * import { z } from 'zod-v3'
 *
 * const form = useForm({
 *   schema: z.object({
 *     username: z.string().min(2, 'At least 2 characters'),
 *     password: z.string().min(8, 'At least 8 characters'),
 *   }),
 * })
 * ```
 *
 * v3 schemas match this overload; v4 schemas hit the v4 overload
 * above first and never reach here.
 */
export function useForm<Schema extends zV3.ZodObject<zV3.ZodRawShape>, K extends FormKey = FormKey>(
  configuration: Omit<
    UseFormConfiguration<
      V3FormOf<Schema>,
      V3OutOf<Schema>,
      AbstractSchema<V3FormOf<Schema>, V3OutOf<Schema>>,
      DefaultValuesInput<V3FormOf<Schema>>,
      K
    >,
    'schema' | 'validateOn' | 'debounceMs'
  > & { schema: Schema } & ValidateOnConfig
): UseFormReturnType<V3FormOf<Schema>, V3OutOf<Schema>, V3ReadOf<Schema>, K>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useForm(configuration: any): any {
  if (
    configuration === undefined ||
    configuration === null ||
    (configuration as { schema?: unknown }).schema === undefined
  ) {
    throw new InvalidUseFormConfigError()
  }
  const { schema } = configuration as { schema: unknown }
  if (isZodV4SchemaShape(schema)) {
    return useFormV4(configuration as Parameters<typeof useFormV4>[0])
  }
  return useFormV3(configuration as Parameters<typeof useFormV3>[0])
}
