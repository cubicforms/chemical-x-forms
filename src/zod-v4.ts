/**
 * `attaform/zod-v4` — explicit Zod v4 adapter subpath.
 *
 * Use this when you want to pin the v4 adapter regardless of what
 * other tooling resolves. Bundles ship a single adapter (no runtime
 * dispatch) — handy for non-Vite bundlers (webpack, esbuild standalone,
 * Rollup) where you'd otherwise pay for both adapters via the unified
 * `attaform/zod` entry's runtime fallback.
 *
 * Most Vite consumers should import from `attaform/zod` instead — the
 * `attaform/vite` plugin rewrites that import to this subpath at build
 * time when zod@^4 is detected, so the same lean bundle ships with
 * less ceremony.
 *
 * Requires `zod@^4` in the consumer's project. Importing this subpath
 * with zod@3 installed throws a clear version-mismatch error from the
 * adapter at the first schema parse.
 *
 * Usage:
 *
 *   import { useForm } from 'attaform/zod-v4'
 *   import { z } from 'zod'
 *
 *   const { register, handleSubmit, errors } = useForm({
 *     schema: z.object({ email: z.email() }),
 *     key: 'signup',
 *   })
 */

export { UnsupportedSchemaError, useForm, zodAdapter } from './runtime/adapters/zod-v4'
export type { PathInput, PathOutput } from './runtime/adapters/zod-v4'
export { assertZodVersion, kindOf } from './runtime/adapters/zod-v4/introspect'
export type { ZodKind } from './runtime/adapters/zod-v4/introspect'
// injectForm is schema-agnostic — the consumer supplies the Form
// generic — so re-exporting from the /zod-v4 subpath is purely for
// discoverability alongside useForm.
export { injectForm } from './runtime/composables/use-form-context'
export { useRegister } from './runtime/composables/use-register'
export { AttaformErrorCode } from './runtime/core/error-codes'
export { unset, isUnset } from './runtime/core/unset'
export type { Unset } from './runtime/core/unset'
export { fieldMeta, withMeta } from './runtime/adapters/zod-v4/field-meta'
export type { FieldMetaPayload } from './runtime/core/field-meta'
