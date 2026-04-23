import { getCurrentScope, onScopeDispose, provide } from 'vue'
import { buildFormApi } from '../core/build-form-api'
import { createFormState, type FormState } from '../core/create-form-state'
import type { FieldStateView } from '../core/field-state-api'
import { getComputedSchema } from '../core/get-computed-schema'
import { kFormContext, useRegistry } from '../core/registry'
import type {
  AbstractSchema,
  FormKey,
  UseAbstractFormReturnType,
  UseFormConfiguration,
} from '../types/types-api'
import type { DeepPartial, GenericForm } from '../types/types-core'

/**
 * useForm's abstract entry point. The Zod-typed `useForm` sitting at
 * ../composables/use-form.ts delegates here after wrapping its Zod schema
 * with `zodAdapter` — the result is an `AbstractSchema<Form, GetValueFormType>`
 * instance indistinguishable from a hand-rolled adapter.
 *
 * Wiring:
 * - Fetches the current Vue app's ChemicalXRegistry via useRegistry().
 * - Looks up (or creates) the FormState<F> for the configured key. If the
 *   registry has a pending hydration entry for the key, threads it into
 *   createFormState so the client side starts from the server's snapshot.
 * - Builds register / getFieldState / validate / handleSubmit /
 *   setFieldErrorsFromApi from that FormState via the Phase 1b factories.
 *
 * The old pre-rewrite implementation stitched together five separate Nuxt
 * useState composables and a cache in register.ts. This file collapses all
 * of that into one registry-backed closure.
 */

export function useAbstractForm<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
>(
  configuration: UseFormConfiguration<
    Form,
    GetValueFormType,
    AbstractSchema<Form, GetValueFormType>,
    DeepPartial<Form>
  >
): UseAbstractFormReturnType<Form, GetValueFormType> {
  const key = requireFormKey(configuration.key)

  // Resolve the schema (accepts either an AbstractSchema or a factory).
  const resolvedSchema = getComputedSchema(key, configuration.schema) as unknown as AbstractSchema<
    Form,
    Form
  >

  // One FormState per (app, formKey). Multiple useForm calls with the same
  // key resolve to the same instance — matches the pre-rewrite "shared
  // store" semantic that forms with the same key were intended to share.
  const registry = useRegistry()
  const existing = registry.forms.get(key) as FormState<Form> | undefined
  const state: FormState<Form> =
    existing ?? buildFreshState<Form>(key, resolvedSchema, configuration, registry)

  // Ref-count this consumer. When the component's effect scope tears down,
  // release the count; the registry evicts the FormState once the last
  // consumer disposes. Guarded on `getCurrentScope()` so callers without an
  // effect-scope context (defensive — setup() always provides one) don't
  // leak a pinned consumer. See registry.trackConsumer for the counter.
  if (getCurrentScope() !== undefined) {
    const releaseConsumer = registry.trackConsumer(key)
    onScopeDispose(releaseConsumer)
  }

  // Provide the FormState to descendants via `kFormContext` so
  // `useFormContext()` can resolve it without prop-threading. The key is
  // the already-canonicalised formKey; looking up a specific form by key
  // is possible via `useFormContext(key)` even without the ambient provide.
  provide(kFormContext, state as FormState<GenericForm>)

  // Only pass onInvalidSubmit when present — same exactOptionalPropertyTypes
  // pattern as inside buildFormApi.
  const apiOptions =
    configuration.onInvalidSubmit !== undefined
      ? { onInvalidSubmit: configuration.onInvalidSubmit }
      : {}
  return buildFormApi<Form, GetValueFormType>(state, apiOptions)
}

function buildFreshState<F extends GenericForm>(
  key: FormKey,
  schema: AbstractSchema<F, F>,
  configuration: UseFormConfiguration<F, F, AbstractSchema<F, F>, DeepPartial<F>>,
  registry: ReturnType<typeof useRegistry>
): FormState<F> {
  const pending = registry.pendingHydration.get(key)
  if (pending !== undefined) registry.pendingHydration.delete(key)
  const state = createFormState<F>({
    formKey: key,
    schema,
    initialState: configuration.initialState,
    validationMode: configuration.validationMode,
    hydration: pending,
  })
  // Storage type is FormState<GenericForm>; the lookup above narrows back to F
  // via the `existing as FormState<Form>` cast.
  ;(registry.forms as Map<FormKey, FormState<GenericForm>>).set(
    key,
    state as unknown as FormState<GenericForm>
  )
  return state
}

function requireFormKey(key: FormKey | undefined): FormKey {
  if (key === undefined || key === null || key === '') {
    throw new Error(
      '[@chemical-x/forms] useForm requires an explicit `key` option. ' +
        'Anonymous forms share state across unrelated components; pass a unique string per form.'
    )
  }
  return key
}

export type { FieldStateView }
