/**
 * Type-level helpers for the unified `attaform/zod` entry. These give
 * tests and other type-query call sites a deterministic projection
 * over an arbitrary v4 OR v3 schema, sidestepping the brittle
 * instantiation-expression resolution rules TypeScript applies to
 * overloaded functions (`typeof useForm<X>` can pick the wrong
 * overload or the impl signature, depending on whether the type
 * argument is a concrete schema, a generic, or a constraint).
 *
 * The helpers dispatch ONCE per use site via a binary conditional —
 * no stacking, no amplification across the return type. Equivalent
 * to writing `ReturnType<typeof useForm<S>>` but cache-stable across
 * call patterns.
 *
 * Per `inference-first DX`, these helpers are test- and
 * internal-facing. Consumer code shouldn't reach for them — the
 * overloaded `useForm` already gives full inference at call sites.
 */
import type { z } from 'zod'
import type { z as zV3 } from 'zod-v3'
import type { StorageShape as StorageShapeV4 } from '../zod-v4/types-storage-shape'
import type { StorageShape as StorageShapeV3 } from '../zod-v3/types-storage-shape'
import type { UnwrapZodObject } from '../zod-v3/types-zod-adapter'
import type {
  AbstractSchema,
  FormKey,
  UseFormConfiguration,
  UseFormReturnType,
  ValidateOnConfig,
} from '../../types/types-api'
import type { DefaultValuesInput, GenericForm } from '../../types/types-core'

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
 * Direct V4 projection — no major-dispatch. Use when the schema's
 * Zod major is known statically (typical for V4 generic helpers like
 * `function setup<S extends z.ZodObject>(s: S)`). TS simplifies the
 * helper cleanly under generic constraints because no conditional
 * is present.
 */
export type UseFormReturnV4<
  Schema extends z.ZodObject,
  K extends FormKey = FormKey,
> = UseFormReturnType<V4FormOf<Schema>, V4OutOf<Schema>, V4ReadOf<Schema>, K>

/**
 * Direct V4 configuration projection. Mirrors `UseFormReturnV4`.
 */
export type UseFormConfigV4<Schema extends z.ZodObject, K extends FormKey = FormKey> = Omit<
  UseFormConfiguration<
    V4FormOf<Schema>,
    V4OutOf<Schema>,
    AbstractSchema<V4FormOf<Schema>, V4OutOf<Schema>>,
    DefaultValuesInput<V4FormOf<Schema>>,
    K
  >,
  'schema' | 'validateOn' | 'debounceMs'
> & { schema: Schema } & ValidateOnConfig

/**
 * Direct V3 projection — no major-dispatch. Use when the schema's
 * Zod major is known statically.
 */
export type UseFormReturnV3<
  Schema extends zV3.ZodObject<zV3.ZodRawShape>,
  K extends FormKey = FormKey,
> = UseFormReturnType<V3FormOf<Schema>, V3OutOf<Schema>, V3ReadOf<Schema>, K>

/**
 * Direct V3 configuration projection. Mirrors `UseFormReturnV3`.
 */
export type UseFormConfigV3<
  Schema extends zV3.ZodObject<zV3.ZodRawShape>,
  K extends FormKey = FormKey,
> = Omit<
  UseFormConfiguration<
    V3FormOf<Schema>,
    V3OutOf<Schema>,
    AbstractSchema<V3FormOf<Schema>, V3OutOf<Schema>>,
    DefaultValuesInput<V3FormOf<Schema>>,
    K
  >,
  'schema' | 'validateOn' | 'debounceMs'
> & { schema: Schema } & ValidateOnConfig

/**
 * The return shape of `useForm` for a given Zod schema. Dispatches
 * once on the schema's major version and projects to the matching
 * adapter's `Form` / `Out` / `Read` slots.
 *
 * Replaces `ReturnType<typeof useForm<Schema, K>>` in test code with
 * concrete schemas. For generic helpers (`<S extends z.ZodObject>`),
 * use `UseFormReturnV4<S>` directly — TS doesn't simplify
 * conditional types under generic constraints, so the dispatch in
 * this helper stays deferred and TS can't prove return-type
 * compatibility.
 */
export type UseFormReturn<Schema, K extends FormKey = FormKey> = Schema extends z.ZodObject
  ? UseFormReturnType<V4FormOf<Schema>, V4OutOf<Schema>, V4ReadOf<Schema>, K>
  : Schema extends zV3.ZodObject<zV3.ZodRawShape>
    ? UseFormReturnType<V3FormOf<Schema>, V3OutOf<Schema>, V3ReadOf<Schema>, K>
    : never

/**
 * The configuration parameter shape of `useForm` for a given Zod
 * schema. Mirrors `UseFormReturn`'s dispatch — replaces
 * `Parameters<typeof useForm<Schema, K>>[0]` in test code.
 */
export type UseFormConfig<Schema, K extends FormKey = FormKey> = Schema extends z.ZodObject
  ? Omit<
      UseFormConfiguration<
        V4FormOf<Schema>,
        V4OutOf<Schema>,
        AbstractSchema<V4FormOf<Schema>, V4OutOf<Schema>>,
        DefaultValuesInput<V4FormOf<Schema>>,
        K
      >,
      'schema' | 'validateOn' | 'debounceMs'
    > & { schema: Schema } & ValidateOnConfig
  : Schema extends zV3.ZodObject<zV3.ZodRawShape>
    ? Omit<
        UseFormConfiguration<
          V3FormOf<Schema>,
          V3OutOf<Schema>,
          AbstractSchema<V3FormOf<Schema>, V3OutOf<Schema>>,
          DefaultValuesInput<V3FormOf<Schema>>,
          K
        >,
        'schema' | 'validateOn' | 'debounceMs'
      > & { schema: Schema } & ValidateOnConfig
    : never
