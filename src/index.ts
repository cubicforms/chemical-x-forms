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

// The abstract useForm — works against any AbstractSchema implementation.
export {
  useAbstractForm,
  useAbstractForm as useForm,
} from './runtime/composables/use-abstract-form'

// The v-register directive (registered automatically by createChemicalXForms,
// but exported for advanced consumers who install directives themselves).
export { vRegister, isRegisterValue, assignKey } from './runtime/core/directive'

// Public types
export type {
  AbstractSchema,
  ApiErrorDetails,
  ApiErrorEnvelope,
  FieldState,
  FormErrorRecord,
  FormKey,
  HandleSubmit,
  InitialStateResponse,
  OnError,
  OnSubmit,
  RegisterValue,
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
  InvalidApiErrorPayloadError,
  InvalidPathError,
  RegistryNotInstalledError,
  SubmitErrorHandlerError,
} from './runtime/core/errors'
