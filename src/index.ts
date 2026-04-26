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
export { useFormContext } from './runtime/composables/use-form-context'

// The v-register directive (registered automatically by createChemicalXForms,
// but exported for advanced consumers who install directives themselves).
export { vRegister, isRegisterValue, assignKey } from './runtime/core/directive'

// Public types
export type {
  AbstractSchema,
  ApiErrorDetails,
  ApiErrorEnvelope,
  ChemicalXFormsDefaults,
  DefaultValuesResponse,
  FieldState,
  FieldValidationConfig,
  FieldValidationMode,
  FormErrorRecord,
  FormFieldErrors,
  FormKey,
  FormState,
  FormStorage,
  FormStorageKind,
  HandleSubmit,
  HistoryConfig,
  OnError,
  OnInvalidSubmitPolicy,
  OnSubmit,
  PendingValidationStatus,
  PersistConfig,
  PersistIncludeMode,
  ReactiveValidationStatus,
  RegisterValue,
  SettledValidationStatus,
  SubmitHandler,
  UseAbstractFormReturnType,
  UseFormConfiguration,
  ValidationError,
  ValidationMode,
  ValidationResponse,
  ValidationResponseWithoutValue,
} from './runtime/types/types-api'

export type { DeepPartial, FlatPath, GenericForm, NestedType } from './runtime/types/types-core'

// Path primitives — exposed for consumers writing custom adapters that
// need to canonicalise user-provided paths.
export { canonicalizePath, parseDottedPath, ROOT_PATH, ROOT_PATH_KEY } from './runtime/core/paths'
export type { Path, PathKey, Segment } from './runtime/core/paths'

// Error classes
export {
  InvalidPathError,
  RegistryNotInstalledError,
  SubmitErrorHandlerError,
} from './runtime/core/errors'
