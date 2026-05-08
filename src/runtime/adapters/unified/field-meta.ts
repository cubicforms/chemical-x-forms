/**
 * Field-metadata write/read API for the unified `attaform/zod` entry.
 *
 * Storage is shared with both adapters via `field-meta-store` — a
 * payload written here is visible to whichever adapter the unified
 * `useForm` dispatches to at runtime, regardless of Zod major. No
 * `zod` runtime import; the type-only `import type` is erased at
 * build, so `attaform/zod` carries no `z.registry` reference even
 * when consumed by a Zod 3 project without the Vite plugin alias.
 *
 * The native v4 chain `schema.register(fieldMeta, payload)` continues
 * to work — Zod 4's `.register()` only calls `.add(this, payload)`
 * structurally, satisfied by the shared store.
 */
import type { z } from 'zod'
import type { FieldMetaPayload } from '../../core/field-meta'
import { fieldMetaStore, getFieldMetaForSchema } from '../../core/field-meta-store'

// Zod v4's `$ZodRegistry` class isn't surfaced under the `z` namespace
// of the classic external entry, but `z.registry()` returns one — so
// `ReturnType<typeof z.registry<T>>` resolves to the registry type
// without needing a direct import. The `import type` keeps the
// reference type-only; nothing about `z.registry` lands in the bundle.
type ZodFieldMetaRegistry = ReturnType<typeof z.registry<FieldMetaPayload>>

/**
 * The shared registry every Attaform-aware Zod schema can register
 * field metadata against, regardless of major. Same instance the v3
 * and v4 adapter entries expose — write in one place, read from
 * any.
 *
 * Cast to Zod 4's `$ZodRegistry<FieldMetaPayload>` so the native
 * `schema.register(fieldMeta, payload)` chain type-checks for v4
 * users; the runtime call only needs `.add` structurally, which the
 * shared store provides.
 */
export const fieldMeta = fieldMetaStore as unknown as ZodFieldMetaRegistry

/**
 * Attach `payload` to `schema` in the shared registry and return a
 * clone of `schema` so each call gets its own identity (the registry
 * keys on schema reference, so cloning prevents last-write-wins
 * collisions for sub-schemas reused at multiple paths).
 *
 * Works on both Zod 3 and Zod 4 schemas — branches on the runtime
 * shape of the schema:
 * - Zod 4 schemas expose a public `.clone()` method; we call it.
 * - Zod 3 schemas don't, so we reconstruct via
 *   `new schema.constructor(schema._def)`.
 *
 * Both forms produce a fresh schema with the same effective
 * structure, so the registry slot is unique to this call site.
 */
export function withMeta<S>(schema: S, payload: FieldMetaPayload): S {
  const target = schema as object
  const existing = getFieldMetaForSchema(target) ?? {}
  const cloned = cloneSchema(schema)
  fieldMetaStore.add(cloned as object, { ...existing, ...payload })
  return cloned
}

function cloneSchema<S>(schema: S): S {
  const candidate = schema as { clone?: unknown; constructor: unknown; _def: unknown }
  if (typeof candidate.clone === 'function') {
    return (candidate.clone as () => S)()
  }
  // Zod 3 path: reconstruct via constructor + _def (no public
  // `.clone()` on v3).
  const Ctor = candidate.constructor as new (def: unknown) => S
  return new Ctor(candidate._def)
}
