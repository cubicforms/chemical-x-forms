/**
 * `attaform/zod` — the unified Zod entry. Auto-detects the consumer's
 * installed Zod major and routes to the matching adapter:
 *
 * - **Build-time alias (recommended).** With the `attaform/vite`
 *   plugin (or `attaform/nuxt`, which installs it), `attaform/zod`
 *   imports are rewritten at build time to either `attaform/zod-v3`
 *   or `attaform/zod-v4` based on the consumer's installed Zod
 *   version. The bundle ships a single adapter — same DX, smaller
 *   payload.
 *
 * - **Runtime dispatch (fallback).** Without the Vite plugin (other
 *   bundlers, plain ESM consumption), this entry's `useForm` checks
 *   the schema's shape at runtime and routes to the v3 or v4
 *   adapter. The bundle ships both adapters; the size cost is
 *   modest but real. Power users who want a lean bundle on non-Vite
 *   bundlers should reach for `attaform/zod-v3` or `attaform/zod-v4`
 *   directly.
 *
 * Usage:
 *
 *   import { useForm } from 'attaform/zod'
 *   import { z } from 'zod'
 *
 *   const { register, handleSubmit, errors } = useForm({
 *     schema: z.object({ email: z.email() }),
 *     key: 'signup',
 *   })
 *
 * Surface:
 * - `useForm` — runtime-dispatching wrapper.
 * - `injectForm`, `useRegister`, `unset` / `isUnset`,
 *   `AttaformErrorCode` — schema-agnostic; identical across adapters.
 * - `fieldMeta`, `withMeta` — re-exported from the v4 adapter. With
 *   the build-time alias the consumer's bundle gets the right
 *   `fieldMeta` for their Zod version. Without the alias, v3
 *   consumers should import `fieldMeta` from `attaform/zod-v3`
 *   directly.
 *
 * Surfaces NOT exposed here (use the explicit subpath):
 * - `UnsupportedSchemaError`, `zodAdapter`, `assertZodVersion`,
 *   `kindOf`, `ZodKind` — diverge between v3 and v4.
 */

export { useForm } from './runtime/adapters/unified/use-form'
export { injectForm } from './runtime/composables/use-form-context'
export { useRegister } from './runtime/composables/use-register'
export { AttaformErrorCode } from './runtime/core/error-codes'
export { unset, isUnset } from './runtime/core/unset'
export type { Unset } from './runtime/core/unset'
export { fieldMeta, withMeta } from './runtime/adapters/zod-v4/field-meta'
export type { FieldMetaPayload } from './runtime/core/field-meta'
