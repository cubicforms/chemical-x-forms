import { getCurrentScope, inject, onScopeDispose } from 'vue'
import { buildFormApi } from '../core/build-form-api'
import type { FormState } from '../core/create-form-state'
import type { HistoryModule } from '../core/history'
import { kFormContext, useRegistry, type ChemicalXRegistry } from '../core/registry'
import type { FormKey, UseAbstractFormReturnType } from '../types/types-api'
import type { GenericForm } from '../types/types-core'

/**
 * Access the ambient form's API from a descendant component without
 * prop-threading. Two resolution modes:
 *
 * - `useFormContext<Form>()` — resolves via `inject(kFormContext)`, the
 *   FormState that the nearest ancestor `useForm()` call provided.
 *   Throws a clear error if there's no ancestor form.
 *
 * - `useFormContext<Form>(key)` — looks the form up by its key in the
 *   app registry. Lets a distant component reach a specific form without
 *   being a descendant of its `useForm` owner. Throws if the key isn't
 *   registered.
 *
 * The consumer supplies the `Form` generic — Vue's InjectionKey erases
 * generics across the provide/inject boundary, so the library can't
 * recover the shape on the caller's behalf. The returned API is
 * type-identical to `useForm`'s return.
 *
 * Both resolution modes ref-count the consumer, so the FormState stays
 * alive for this component's effect scope and is released back to the
 * registry's eviction path on unmount. That means a form created by a
 * parent and accessed via this composable in a child component
 * survives until the LAST consumer unmounts, which is the correct
 * lifetime for shared forms.
 */
export function useFormContext<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
>(key?: FormKey): UseAbstractFormReturnType<Form, GetValueFormType> {
  const registry = useRegistry()

  const state: FormState<Form> = resolveState<Form>(key, registry)

  // Ref-count this consumer so the FormState survives until every nested
  // component that reached it has torn down. Mirrors the behaviour in
  // useAbstractForm — see registry.trackConsumer for the counter semantics.
  if (getCurrentScope() !== undefined) {
    const releaseConsumer = registry.trackConsumer(state.formKey)
    onScopeDispose(releaseConsumer)
  }

  // Pull the cached history module (if the owning `useForm` wired it)
  // so every consumer's API surface includes `undo` / `redo` / `canUndo`
  // / `canRedo` / `historySize`. Without this, consumers reached via
  // the context would receive inert stubs even when history is enabled
  // on the form.
  const apiOptions: Parameters<typeof buildFormApi<Form, GetValueFormType>>[1] = {}
  const history = state.modules.get('history') as HistoryModule | undefined
  if (history !== undefined) {
    apiOptions.history = history
  }
  return buildFormApi<Form, GetValueFormType>(state, apiOptions)
}

/**
 * Split out so each branch `return`s — lets the caller hold `state` as
 * a plain `const` and keeps ESLint's `no-useless-assignment` rule
 * happy (the prior shape declared `let state = null` and re-assigned
 * in both branches).
 */
function resolveState<Form extends GenericForm>(
  key: FormKey | undefined,
  registry: ChemicalXRegistry
): FormState<Form> {
  if (key !== undefined) {
    const stored = registry.forms.get(key) as FormState<Form> | undefined
    if (stored === undefined) {
      throw new Error(
        `[@chemical-x/forms] useFormContext: no form registered for key '${key}'. Call useForm({ key }) first.`
      )
    }
    return stored
  }
  const ambient = inject(kFormContext, null) as FormState<Form> | null
  if (ambient === null) {
    throw new Error(
      '[@chemical-x/forms] useFormContext: no ambient form context. Call useForm(...) in an ancestor or pass a key.'
    )
  }
  return ambient
}
