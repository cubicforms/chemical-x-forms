import { getCurrentScope, inject, onScopeDispose } from 'vue'
import { buildFormApi } from '../core/build-form-api'
import type { FormState } from '../core/create-form-state'
import { kFormContext, useRegistry } from '../core/registry'
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

  let state: FormState<Form> | null = null
  if (key !== undefined) {
    const stored = registry.forms.get(key) as FormState<Form> | undefined
    if (stored === undefined) {
      throw new Error(
        `[@chemical-x/forms] useFormContext: no form registered under key '${key}'. ` +
          'Call useForm({ key }) in an ancestor component (or anywhere earlier in the render) first.'
      )
    }
    state = stored
  } else {
    const ambient = inject(kFormContext, null) as FormState<Form> | null
    if (ambient === null) {
      throw new Error(
        '[@chemical-x/forms] useFormContext: no ambient form context found. ' +
          'Either call useForm({...}) in an ancestor component, or pass an explicit form key.'
      )
    }
    state = ambient
  }

  // Ref-count this consumer so the FormState survives until every nested
  // component that reached it has torn down. Mirrors the behaviour in
  // useAbstractForm — see registry.trackConsumer for the counter semantics.
  if (getCurrentScope() !== undefined) {
    const releaseConsumer = registry.trackConsumer(state.formKey)
    onScopeDispose(releaseConsumer)
  }

  return buildFormApi<Form, GetValueFormType>(state)
}
