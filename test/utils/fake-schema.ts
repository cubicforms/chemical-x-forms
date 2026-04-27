import { getAtPath } from '../../src/runtime/core/path-walker'
import type { Path } from '../../src/runtime/core/paths'
import type {
  AbstractSchema,
  DefaultValuesResponse,
  ValidationResponse,
} from '../../src/runtime/types/types-api'
import type { DeepPartial, GenericForm } from '../../src/runtime/types/types-core'

/**
 * A minimal, dependency-free AbstractSchema implementation used by the core
 * test suite. Tests against the core must exercise the schema-agnostic
 * contract without pulling in Zod — that would defeat the purpose of the
 * decoupling.
 *
 * Usage:
 *   const schema = fakeSchema<MyForm>({ user: { name: 'alice', age: 30 } })
 *   const state = createFormStore({ formKey: 'test', schema })
 *
 * This schema:
 * - Accepts any form shape; no validation rules.
 * - Uses the provided `defaults` as the initial state.
 * - `validateAtPath` always reports success.
 * - `getSchemasAtPath` returns `[]` (no path-specific subschemas).
 *
 * For tests that need validation failure cases, pass a custom `validator`.
 * The validator can return either a synchronous `ValidationResponse<F>` or
 * a `Promise` — the schema's `validateAtPath` is always Promise-returning,
 * matching the Phase 5.6 `AbstractSchema` contract.
 */
export function fakeSchema<F extends GenericForm>(
  defaults: F,
  validator?: (
    data: unknown,
    path: Path | undefined
  ) => ValidationResponse<F> | Promise<ValidationResponse<F>>,
  /**
   * Optional fingerprint override. Defaults to a constant so most
   * tests that don't care about the schema-mismatch warning land in
   * the "schemas match" branch automatically. Tests that exercise
   * the shared-key mismatch path pass distinct strings to simulate
   * two structurally-different schemas.
   */
  fingerprint = 'fake-schema'
): AbstractSchema<F, F> {
  const schema: AbstractSchema<F, F> = {
    fingerprint: () => fingerprint,
    getDefaultValues(config): DefaultValuesResponse<F> {
      const merged = mergeDeepPartial(defaults, config.constraints) as F
      return {
        data: merged,
        errors: undefined,
        success: true,
        formKey: '',
      }
    },
    getDefaultAtPath(path) {
      // Tests that don't care just inherit a "lookup-in-defaults" semantic
      // — for any path that exists in the provided defaults tree, return
      // the value there; otherwise undefined. Tests that DO care can
      // overwrite this on the returned object before passing to consumers.
      return getAtPath(defaults, path)
    },
    getSchemasAtPath(path) {
      void path
      return []
    },
    async validateAtPath(data, path): Promise<ValidationResponse<F>> {
      if (validator) return await validator(data, path)
      return {
        data: data as F,
        errors: undefined,
        success: true,
        formKey: '',
      }
    },
  }
  return schema
}

function mergeDeepPartial<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (override === undefined || override === null) return base
  if (typeof base !== 'object' || base === null) return override as T
  if (Array.isArray(base)) {
    return Array.isArray(override) ? (override as unknown as T) : base
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const key of Object.keys(override as object)) {
    const overrideValue = (override as Record<string, unknown>)[key]
    const baseValue = (base as Record<string, unknown>)[key]
    if (
      typeof baseValue === 'object' &&
      baseValue !== null &&
      !Array.isArray(baseValue) &&
      typeof overrideValue === 'object' &&
      overrideValue !== null &&
      !Array.isArray(overrideValue)
    ) {
      result[key] = mergeDeepPartial(
        baseValue as Record<string, unknown>,
        overrideValue as DeepPartial<Record<string, unknown>>
      )
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue
    }
  }
  return result as T
}
