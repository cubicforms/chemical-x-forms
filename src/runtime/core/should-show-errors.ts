import type { ShouldShowErrors, ShouldShowErrorsConfig } from '../types/types-api'

/**
 * Library-default heuristic for `shouldShowErrors`. Drives
 * `field.showErrors` and `form.meta.showErrors` whenever the consumer
 * has not configured an override at either the plugin or per-form
 * level.
 *
 * Reads "show errors after the first submit attempt, OR after the
 * user has interacted (`touched`) and made a change (`dirty`)." The
 * framework already gates on `errors.length > 0` before invoking the
 * predicate, so the body only decides *when* to surface existing
 * errors — not whether errors exist.
 *
 * Public re-export so adopters can compose with this without
 * copy-pasting the rule body. A layered predicate that adds a
 * special case but otherwise defers to the library default picks up
 * future heuristic refinements automatically:
 *
 * ```ts
 * import { defaultShouldShowErrors } from 'attaform'
 *
 * useForm({
 *   schema,
 *   shouldShowErrors: (field, formMeta) =>
 *     field.path[0] === 'urgent' || defaultShouldShowErrors(field, formMeta),
 * })
 * ```
 */
export const defaultShouldShowErrors: ShouldShowErrors = (field, formMeta) =>
  formMeta.submitCount > 0 || (field.touched === true && field.dirty)

const SHOW_ALWAYS: ShouldShowErrors = () => true
const SHOW_NEVER: ShouldShowErrors = () => false

/**
 * Resolve a `ShouldShowErrorsConfig` (function | boolean | undefined)
 * to a concrete `ShouldShowErrors` predicate. Boolean shorthand lifts
 * to a constant predicate; `undefined` falls back to the library
 * default. Called once at form construction; the resolved predicate
 * is then stored on `FormStore` for the field-state computeds.
 */
export function resolveShouldShowErrors(
  config: ShouldShowErrorsConfig | undefined
): ShouldShowErrors {
  if (config === undefined) return defaultShouldShowErrors
  if (config === true) return SHOW_ALWAYS
  if (config === false) return SHOW_NEVER
  return config
}
