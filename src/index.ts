/**
 * `@chemical-x/forms` — framework-agnostic core entry.
 *
 * Consumers under bare Vue 3:
 *
 *   import { createApp } from 'vue'
 *   import { createChemicalXForms, useForm } from '@chemical-x/forms'
 *   import { chemicalXForms as chemicalXVite } from '@chemical-x/forms/vite'
 *
 *   createApp(App).use(createChemicalXForms()).mount('#app')
 *
 * Consumers under Nuxt don't touch this file — the Nuxt module (`./nuxt`
 * subpath) installs everything automatically.
 *
 * For schema-library integrations (Zod v3 today; Valibot / ArkType /
 * custom later), import from the matching subpath:
 *
 *   import { useForm, zodAdapter } from '@chemical-x/forms/zod-v3'
 */

// The plugin, registry, serialization helpers
export { createChemicalXForms } from './runtime/core/plugin'
export type { ChemicalXFormsPluginOptions } from './runtime/core/plugin'
export {
  createRegistry,
  getRegistryFromApp,
  kChemicalXRegistry,
  useRegistry,
} from './runtime/core/registry'
export type { ChemicalXRegistry, SerializedFormData } from './runtime/core/registry'
export { hydrateChemicalXState, renderChemicalXState } from './runtime/core/serialize'
export type { SerializedChemicalXState } from './runtime/core/serialize'
export { escapeForInlineScript } from './runtime/core/serialize-script'

// The abstract useForm — works against any AbstractSchema implementation.
// Zod-typed wrappers live at `/zod` (v4) and `/zod-v3`; this entry is the
// schema-agnostic core.
export { useAbstractForm as useForm } from './runtime/composables/use-abstract-form'

// Re-export for nested components that want to reach the nearest
// ancestor form (or an arbitrary form by key) without prop-threading.
// The consumer supplies the `Form` generic — see the composable's
// docblock for the type-erasure reasoning.
export { injectForm } from './runtime/composables/use-form-context'

// Ambient bridge for components that wrap a single field and want to
// re-bind v-register onto an inner native element. See the
// `useRegister` section in `docs/api.md` for the wrapper-component
// pattern; for compound components reaching multiple fields, prefer
// `injectForm`.
export { useRegister } from './runtime/composables/use-register'

// The v-register directive (registered automatically by createChemicalXForms,
// but exported for advanced consumers who install directives themselves).
export { vRegister, isRegisterValue, assignKey } from './runtime/core/directive'

// The `unset` sentinel — pass in `defaultValues`, `setValue`, or `reset`
// to mark a primitive leaf as displayed-empty while storage holds the
// slim default. See `src/runtime/core/unset.ts` for the full docblock.
export { unset, isUnset } from './runtime/core/unset'
export type { Unset } from './runtime/core/unset'

// Stable error-code identifiers for library-emitted ValidationErrors.
// Use in tests and error-routing UI in place of brittle message-string
// matching. `cx:` prefix denotes the framework-agnostic core; the Zod
// adapter emits `zod:` codes (computed from `issue.code`) and consumer
// codes use whatever prefix the consumer picks (`api:`, `auth:`, etc.).
export { CxErrorCode } from './runtime/core/error-codes'

// Public types
export type {
  AbstractSchema,
  ApiErrorDetails,
  ApiErrorEntry,
  ApiErrorEnvelope,
  ChemicalXFormsDefaults,
  CustomDirectiveRegisterAssignerFn,
  DefaultValuesResponse,
  FieldState,
  FieldStateLeaf,
  FieldStateMap,
  FieldStateMapEntry,
  FieldValidationConfig,
  FieldValidationMode,
  FormErrorRecord,
  FormFieldErrors,
  FormKey,
  FormMeta,
  FormStorage,
  FormStorageKind,
  HandleSubmit,
  HistoryConfig,
  MetaTrackerValue,
  OnError,
  OnInvalidSubmitPolicy,
  OnSubmit,
  PendingValidationStatus,
  PersistConfig,
  PersistConfigOptions,
  PersistIncludeMode,
  ReactiveValidationStatus,
  RegisterDirective,
  RegisterFlatPath,
  RegisterOptions,
  RegisterSelectModifier,
  RegisterTextModifier,
  RegisterValue,
  SetValueCallback,
  SetValuePayload,
  SettledValidationStatus,
  SlimPrimitiveKind,
  SubmitHandler,
  UseAbstractFormReturnType,
  UseFormConfiguration,
  ValidationError,
  ValidationMode,
  ValidationResponse,
  ValidationResponseWithoutValue,
  WriteMeta,
} from './runtime/types/types-api'

export type {
  DeepPartial,
  DefaultValuesShape,
  FlatPath,
  GenericForm,
  IsTuple,
  NestedReadType,
  NestedType,
} from './runtime/types/types-core'

// Path primitives — exposed for consumers writing custom adapters that
// need to canonicalise user-provided paths.
export { canonicalizePath, parseDottedPath, ROOT_PATH, ROOT_PATH_KEY } from './runtime/core/paths'
export type { Path, PathKey, Segment } from './runtime/core/paths'

// Error classes
export {
  AnonPersistError,
  InvalidPathError,
  OutsideSetupError,
  RegistryNotInstalledError,
  ReservedFormKeyError,
  SensitivePersistFieldError,
  SubmitErrorHandlerError,
} from './runtime/core/errors'

// API-error parser. Pure transformation: takes a server response in
// the common shapes (wrapped envelope, raw details record) and returns
// `ValidationError[]` + an `ok` discriminator for malformed payloads.
// Pair with `form.setFieldErrors` (or `addFieldErrors`) to apply the
// result. The form API has no `setFieldErrorsFromApi` shortcut by
// design — keeping the parse step explicit is the consolidation move
// that lets the form's setter surface stay narrow.
export { parseApiErrors, PARSE_API_ERRORS_DEFAULTS } from './runtime/core/parse-api-errors'
export type { ParseApiErrorsOptions, ParseApiErrorsResult } from './runtime/core/parse-api-errors'
