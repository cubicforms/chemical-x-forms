/**
 * Unified `useForm` for the `attaform/zod` entry. Runtime-dispatches
 * on schema shape: a Zod v4 schema (`def.type` truthy) routes to the
 * v4 adapter; a Zod v3 schema (or any other `AbstractSchema`) routes
 * to the v3 wrapper, which already accepts both Zod v3 input and
 * `AbstractSchema` directly via its built-in shape branch.
 *
 * Type-level dispatch happens through a single signature with a
 * union constraint — `Schema extends z.ZodObject |
 * zV3.ZodObject<zV3.ZodRawShape>`. The configuration parameter and
 * return type both dispatch conditionally on whether `Schema` is a
 * v4 or v3 object. The two majors don't structurally satisfy each
 * other's `ZodObject` constraints (v4 has `loose` / `safeExtend` /
 * `def` / `type` members v3 lacks), so neither alone is enough — the
 * union accepts both, and the conditional return type routes through
 * the matching adapter's `StorageShape` / `z.input` / `z.output`.
 *
 * A single signature (rather than overloads) keeps `typeof
 * useForm<X>` instantiation expressions in test code unambiguous:
 * TypeScript's overload-resolution rules for these expressions are
 * brittle when multiple overloads partially match, so we collapse to
 * one signature.
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
import type { DeepPartial, DefaultValuesShape, GenericForm } from '../../types/types-core'

// ───────────────────────────────────────────────────────────────────
// Per-major projections. Each dispatches a single Schema to the
// matching adapter's input / output / storage-shape slot. The
// trailing `never` arms catch the "other major" case so an isolated
// instantiation stays well-formed; the union constraint on the
// public signature guarantees one arm always fires.
// ───────────────────────────────────────────────────────────────────

// Per-major helpers. Naming each variant keeps `rollup-plugin-dts`
// from inlining the `z.input<X> extends GenericForm ? z.input<X> :
// never` conditional twice inside each branch of the unified
// `FormInput` / `FormOutput` / `FormStorageShape` aliases — the
// bundled `.d.ts` preserves the helper as a single alias rather
// than re-evaluating it at every consumer call site. Critical for
// TS2589 headroom in setups that wire several `useForm` calls in
// one scope (multistep wizards, parallel inline pickers, etc.).
type FormInputV4<S extends z.ZodObject> = z.input<S> extends GenericForm ? z.input<S> : never
type FormOutputV4<S extends z.ZodObject> = z.output<S> extends GenericForm ? z.output<S> : never
type FormStorageShapeV4<S extends z.ZodObject> =
  StorageShapeV4<S> extends GenericForm ? StorageShapeV4<S> : never

type FormInputV3<S extends zV3.ZodObject<zV3.ZodRawShape>> =
  zV3.input<UnwrapZodObject<S>> extends GenericForm ? zV3.input<UnwrapZodObject<S>> : never
type FormOutputV3<S extends zV3.ZodObject<zV3.ZodRawShape>> =
  zV3.output<UnwrapZodObject<S>> extends GenericForm ? zV3.output<UnwrapZodObject<S>> : never
type FormStorageShapeV3<S extends zV3.ZodObject<zV3.ZodRawShape>> =
  StorageShapeV3<UnwrapZodObject<S>> extends GenericForm
    ? StorageShapeV3<UnwrapZodObject<S>>
    : never

type FormInput<Schema> = Schema extends z.ZodObject
  ? FormInputV4<Schema>
  : Schema extends zV3.ZodObject<zV3.ZodRawShape>
    ? FormInputV3<Schema>
    : never

type FormOutput<Schema> = Schema extends z.ZodObject
  ? FormOutputV4<Schema>
  : Schema extends zV3.ZodObject<zV3.ZodRawShape>
    ? FormOutputV3<Schema>
    : never

type FormStorageShape<Schema> = Schema extends z.ZodObject
  ? FormStorageShapeV4<Schema>
  : Schema extends zV3.ZodObject<zV3.ZodRawShape>
    ? FormStorageShapeV3<Schema>
    : never

// Single unified configuration shape. The outer structure is
// non-conditional (so TS can resolve it for any Schema satisfying
// the union constraint, including generic `F extends z.ZodObject`
// helpers in test code); only the field-level types dispatch on
// Schema kind via `FormInput` / `FormOutput`. The runtime cast
// passes the configuration through unchanged — each adapter's own
// signature absorbs the residual structural drift.
type UnifiedConfiguration<Schema, K extends FormKey = FormKey> = Omit<
  UseFormConfiguration<
    FormInput<Schema>,
    FormOutput<Schema>,
    AbstractSchema<FormInput<Schema>, FormOutput<Schema>>,
    DeepPartial<DefaultValuesShape<FormInput<Schema>>>,
    K
  >,
  'schema' | 'validateOn' | 'debounceMs'
> & { schema: Schema } & ValidateOnConfig

/**
 * Create a form bound to a Zod schema. Accepts both Zod v3 and Zod v4
 * schemas; the runtime picks the right adapter from the schema's
 * shape.
 *
 * Type inference works transparently for both Zod v3 and Zod v4
 * schemas — the adapter is selected from the schema's shape at both
 * runtime and type-check time. `form.values`, `form.fields`,
 * `register`, and the `handleSubmit` callback data type all resolve
 * against the matching adapter's storage shape; consumers don't need
 * to reach for `attaform/zod-v3` or `attaform/zod-v4` to get full
 * inference. Those subpath entries remain as lean-bundle escape
 * hatches for non-Vite tooling, not correctness escape hatches.
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
export function useForm<
  Schema extends z.ZodObject | zV3.ZodObject<zV3.ZodRawShape>,
  K extends FormKey = FormKey,
>(
  configuration: UnifiedConfiguration<Schema, K>
): UseFormReturnType<FormInput<Schema>, FormOutput<Schema>, FormStorageShape<Schema>, K> {
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
    return useFormV4(
      configuration as Parameters<typeof useFormV4>[0]
    ) as unknown as UseFormReturnType<
      FormInput<Schema>,
      FormOutput<Schema>,
      FormStorageShape<Schema>,
      K
    >
  }
  // Anything else (Zod v3 schema, custom AbstractSchema, schema
  // factory) goes through the v3 wrapper, which already accepts both
  // Zod v3 input and AbstractSchema directly via its existing shape
  // branch.
  return useFormV3(
    configuration as Parameters<typeof useFormV3>[0]
  ) as unknown as UseFormReturnType<
    FormInput<Schema>,
    FormOutput<Schema>,
    FormStorageShape<Schema>,
    K
  >
}
