/**
 * `attaform` — framework-agnostic core entry.
 *
 * Consumers under bare Vue 3:
 *
 *   import { createApp } from 'vue'
 *   import { createAttaform, useForm } from 'attaform'
 *   import { attaform as attaformVite } from 'attaform/vite'
 *
 *   createApp(App).use(createAttaform()).mount('#app')
 *
 * Consumers under Nuxt don't touch this file — the Nuxt module (`./nuxt`
 * subpath) installs everything automatically.
 *
 * For schema-library integrations (Zod v3 today; Valibot / ArkType /
 * custom later), import from the matching subpath:
 *
 *   import { useForm, zodAdapter } from 'attaform/zod-v3'
 */

// The plugin, registry, serialization helpers
export { createAttaform } from './runtime/core/plugin'
export type { AttaformPluginOptions } from './runtime/core/plugin'
export {
  createRegistry,
  getRegistryFromApp,
  kAttaformRegistry,
  useRegistry,
} from './runtime/core/registry'
export type { AttaformRegistry, SerializedFormData } from './runtime/core/registry'
export { hydrateAttaformState, renderAttaformState } from './runtime/core/serialize'
export type { SerializedAttaformState } from './runtime/core/serialize'
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

// Multistep-form orchestrator. Composes existing `useForm` instances
// into a wizard with navigation, status aggregation, and activation
// lifecycle. See the composable's docblock for invariants.
export { useStepper } from './runtime/composables/use-stepper'
export type {
  AnyForm,
  FormKeyOf,
  KeysOf,
  StepperNavOptions,
  StepperOptions,
  UseStepperReturnType,
} from './runtime/types/types-stepper'

// Ambient bridge for components that wrap a single field and want to
// re-bind v-register onto an inner native element. See the
// `useRegister` section in `docs/api.md` for the wrapper-component
// pattern; for compound components reaching multiple fields, prefer
// `injectForm`.
export { useRegister } from './runtime/composables/use-register'

// The v-register directive (registered automatically by createAttaform,
// but exported for advanced consumers who install directives themselves).
export { vRegister, isRegisterValue, assignKey } from './runtime/core/directive'
export { defaultCoercionRules, defineCoercion } from './runtime/core/schema-coerce'

// The `unset` sentinel — pass in `defaultValues`, `setValue`, or `reset`
// to mark a primitive leaf as displayed-empty while storage holds the
// slim default. See `src/runtime/core/unset.ts` for the full docblock.
export { unset, isUnset } from './runtime/core/unset'
export type { Unset } from './runtime/core/unset'

// Stable error-code identifiers for library-emitted ValidationErrors.
// Use in tests and error-routing UI in place of brittle message-string
// matching. `atta:` prefix denotes the framework-agnostic core; the Zod
// adapter emits `zod:` codes (computed from `issue.code`) and consumer
// codes use whatever prefix the consumer picks (`api:`, `auth:`, etc.).
export { AttaformErrorCode } from './runtime/core/error-codes'

// Public types
export type {
  AbstractSchema,
  ApiErrorDetails,
  ApiErrorEntry,
  ApiErrorEnvelope,
  AttaformDefaults,
  CoercionEntry,
  CoercionRegistry,
  CoercionResult,
  CustomDirectiveRegisterAssignerFn,
  DefaultValuesResponse,
  ErrorsProxyShape,
  FieldMetaPayload,
  FieldState,
  FieldStateMap,
  FieldStateMapEntry,
  FormErrorRecord,
  FormErrorsSurface,
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
  RegisterTransform,
  RegisterValue,
  SetValueCallback,
  SetValuePayload,
  SettledValidationStatus,
  ShouldShowErrors,
  ShouldShowErrorsConfig,
  SlimPrimitiveKind,
  SlimRuntimeOf,
  SubmitHandler,
  ValidateOn,
  ValidateOnConfig,
  UseFormReturnType,
  UseFormConfiguration,
  ValidationError,
  ValidationResponse,
  ValidationResponseWithoutValue,
  WriteMeta,
} from './runtime/types/types-api'

export type {
  ArrayItem,
  ArrayPath,
  DeepPartial,
  DefaultValuesInput,
  DefaultValuesShape,
  FlatPath,
  GenericForm,
  IsTuple,
  IsUnion,
  JoinSegments,
  KeyofUnion,
  LiftedValueShape,
  NestedReadType,
  NestedType,
  PartialFlatPath,
  Primitive,
  ValueOfUnion,
  WriteShape,
} from './runtime/types/types-core'

// Path primitives — exposed for consumers writing custom adapters that
// need to canonicalise user-provided paths.
export {
  canonicalizePath,
  isPathPrefix,
  parseDottedPath,
  ROOT_PATH,
  ROOT_PATH_KEY,
} from './runtime/core/paths'
export type { Path, PathKey, Segment } from './runtime/core/paths'

// DevTools shared primitives — sensitive-name redaction policy and the
// window-bridge contract the Nuxt overlay panel + iframe page consume
// at runtime. Exposed so the panel components (shipped as `.vue` files
// under `dist/runtime/`) can `import { … } from 'attaform'` without
// brittle relative paths into the bundled chunk layout.
export {
  DEVTOOLS_WINDOW_KEY,
  REDACTED,
  redactSensitiveLeaves,
} from './runtime/core/devtools-shared'
export type { AttaformDevtoolsBridge } from './runtime/core/devtools-shared'

// Error classes — every library-emitted error extends `AttaformError`, so
// consumers can write a single polymorphic catch (`catch (e) { if (e
// instanceof AttaformError) ... }`) instead of OR-chaining instanceof
// checks for each subclass.
export {
  AnonPersistError,
  AttaformError,
  InvalidPathError,
  InvalidUseFormConfigError,
  OutsideSetupError,
  RegistryNotInstalledError,
  ReservedFormKeyError,
  SensitivePersistFieldError,
  SubmitErrorHandlerError,
} from './runtime/core/errors'

// Library-default heuristic for `shouldShowErrors`. Public so adopter
// predicates can compose with it (a layered predicate that defers to
// the library default for the unhandled cases).
export { defaultShouldShowErrors } from './runtime/core/should-show-errors'

// Library-default list of identifier name stems flagged as sensitive
// (password, ssn, cvv, token, etc.). Compose with `sensitiveNames` at
// the global or per-form level to extend:
//
//   useForm({ sensitiveNames: [...DEFAULT_SENSITIVE_NAMES, 'mrn'] })
//
// The resolved list gates persistence writes, multi-tab sync
// broadcasts, AND the DevTools redact walk — one configurable source
// of truth for "what counts as sensitive" across every surface.
export { DEFAULT_SENSITIVE_NAMES } from './runtime/core/persistence/sensitive-names'

// API-error parser. Pure transformation: takes a server response in
// the common shapes (wrapped envelope, raw details record) and returns
// `ValidationError[]` + an `ok` discriminator for malformed payloads.
// Pair with `form.setFieldErrors` (or `addFieldErrors`) to apply the
// result. The form API has no `setFieldErrorsFromApi` shortcut by
// design — keeping the parse step explicit is the consolidation move
// that lets the form's setter surface stay narrow.
export { parseApiErrors, PARSE_API_ERRORS_DEFAULTS } from './runtime/core/parse-api-errors'
export type { ParseApiErrorsOptions, ParseApiErrorsResult } from './runtime/core/parse-api-errors'
