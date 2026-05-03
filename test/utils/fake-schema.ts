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
      const merged = mergeDeepPartial(defaults, config.constraints as DeepPartial<F>) as F
      return {
        data: merged,
        errors: undefined,
        success: true,
        formKey: '',
      }
    },
    getDefaultAtPath(path) {
      // fakeSchema is data-keyed, not schema-keyed — it can't distinguish
      // tuple from unbounded array. To keep the structural-completeness
      // machinery honest in tests:
      //   - Object paths: return the value at the path (lookup).
      //   - Once any intermediate is an array, return undefined: the test
      //     util doesn't model element schemas.
      //   - Empty path: return the whole defaults tree.
      // Tests that need array element defaults (e.g. element-fill on
      // sparse writes) should use a Zod adapter instead, or override
      // this method on the returned object.
      if (path.length === 0) return defaults
      let current: unknown = defaults
      for (const seg of path) {
        if (Array.isArray(current)) return undefined
        if (current === null || typeof current !== 'object') return undefined
        const key = typeof seg === 'number' ? String(seg) : seg
        current = (current as Record<string, unknown>)[key]
      }
      return current
    },
    arrayShapeAtPath(path) {
      // fakeSchema can't model element schemas — return `undefined` so
      // the runtime falls back to the legacy probe loop, matching the
      // old behaviour. Tests needing tuple/array shape semantics
      // override this on the returned object.
      void path
      return undefined
    },
    getSchemasAtPath(path) {
      void path
      return []
    },
    getSlimPrimitiveTypesAtPath(path) {
      void path
      // Permissive default: tests that don't model schema kinds get a
      // permissive write-gate. Tests that need stricter behaviour
      // override this method on the returned object.
      return new Set(['string', 'number', 'boolean', 'object', 'array', 'null', 'undefined'])
    },
    isLeafAtPath(path) {
      // fakeSchema is data-keyed — derive leaf-ness from the defaults
      // shape. A path resolves to a leaf iff the value at that path
      // exists and is a primitive (string, number, boolean, bigint,
      // null, undefined, Date, function). Objects and arrays descend.
      // Empty path (root) is always a container.
      if (path.length === 0) return false
      let current: unknown = defaults
      for (const seg of path) {
        if (current === null || current === undefined) return false
        if (typeof current !== 'object') return false
        const key = typeof seg === 'number' ? String(seg) : seg
        // Treat array index out of range as non-existent — descend
        // permissively (most callers extending arrays haven't filled
        // the slot yet, and we don't want to terminate prematurely).
        if (Array.isArray(current)) {
          if (typeof seg !== 'number' || seg < 0 || seg >= current.length) return false
          current = current[seg]
        } else {
          if (!(key in current)) return false
          current = (current as Record<string, unknown>)[key]
        }
      }
      // The value is a leaf iff it's a primitive at this point.
      if (current === null || current === undefined) return true
      const t = typeof current
      if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return true
      if (current instanceof Date) return true
      // Arrays / plain objects → container.
      return false
    },
    isRequiredAtPath(path) {
      void path
      // Permissive default: fake-schema doesn't model required-ness.
      // Tests that need to exercise the required-empty validation
      // augmentation override this method on the returned object.
      return false
    },
    getUnionDiscriminatorAtPath(path) {
      void path
      // fake-schema doesn't model discriminated unions. Tests that
      // need to exercise the variant-switch reshape override this
      // method on the returned object.
      return undefined
    },
    validateAtPath(data, path, options) {
      // No consumer validator → trivial success. Sync arm when the
      // caller asked (`options.sync === true`); async arm otherwise,
      // matching the production adapters' default. With a custom
      // validator, always go async (we'd need the consumer to supply
      // a sync overload separately, which they don't, so opt-in sync
      // simply isn't supported here).
      if (validator) return validator(data, path)
      const response: ValidationResponse<F> = {
        data: data as F,
        errors: undefined,
        success: true,
        formKey: '',
      }
      return options?.sync === true ? response : Promise.resolve(response)
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
