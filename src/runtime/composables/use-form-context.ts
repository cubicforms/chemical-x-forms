import { getCurrentInstance, getCurrentScope, inject, onScopeDispose } from 'vue'
import { buildFormApi } from '../core/build-form-api'
import type { FormStore } from '../core/create-form-store'
import { __DEV__ } from '../core/dev'
import type { HistoryModule } from '../core/history'
import { kFormContext, useRegistry, type ChemicalXRegistry } from '../core/registry'
import type { FormKey, UseAbstractFormReturnType } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import { ambientProvideHistory } from './use-abstract-form'

/**
 * Access the ambient form's API from a descendant component without
 * prop-threading. Two resolution modes:
 *
 * - `useFormContext<Form>()` — resolves via `inject(kFormContext)`, the
 *   FormStore that the nearest ancestor `useForm()` call provided.
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
 * Both resolution modes ref-count the consumer, so the FormStore stays
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

  const state: FormStore<Form> = resolveState<Form>(key, registry)

  // Ref-count this consumer so the FormStore survives until every nested
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
): FormStore<Form> {
  if (key !== undefined) {
    const stored = registry.forms.get(key) as FormStore<Form> | undefined
    if (stored === undefined) {
      throw new Error(
        `[@chemical-x/forms] useFormContext: no form registered for key '${key}'. Call useForm({ key }) first.`
      )
    }
    return stored
  }
  const ambient = inject(kFormContext, null) as FormStore<Form> | null
  if (ambient === null) {
    throw new Error(
      '[@chemical-x/forms] useFormContext: no ambient form context. Call useForm(...) in an ancestor or pass a key.'
    )
  }
  warnIfAmbientProviderHadDuplicates()
  return ambient
}

/**
 * Walk up from the current component to the nearest ancestor that
 * registered an ambient provide (tracked in `ambientProvideHistory`).
 * If that ancestor recorded more than one form, a descendant reaching
 * for the ambient slot only sees the last one — warn so the author
 * picks between explicit keys and splitting the component.
 *
 * The eager version of this check lived at the `useForm()` call site
 * and fired once per extra form regardless of whether any descendant
 * actually used the ambient slot. That made spike / test pages wall-
 * warn for a non-problem; this version fires at most once per
 * `useFormContext()` consumer that genuinely collides.
 *
 * Message format: one bullet per `useForm()` call on the offending
 * ancestor, showing the captured source frame (click-through in
 * DevTools) and, for calls that passed an explicit key, the key
 * itself — because `useFormContext('that-key')` is the escape hatch
 * for named forms. Synthetic `cx:anon:<id>` keys are deliberately
 * omitted; they're positional and carry no signal for the author.
 */
function warnIfAmbientProviderHadDuplicates(): void {
  if (!__DEV__ || ambientProvideHistory === null) return
  let ancestor = getCurrentInstance()?.parent ?? null
  while (ancestor !== null) {
    const history = ambientProvideHistory.get(ancestor as unknown as object)
    if (history !== undefined) {
      if (history.length > 1) {
        const lines = history.map((entry) => {
          const source = entry.source ?? '<unknown location>'
          return entry.namedKey !== undefined
            ? `  - ${source}  [key: "${entry.namedKey}"]`
            : `  - ${source}`
        })
        console.warn(
          '[@chemical-x/forms] useFormContext<F>() (no key) resolved against ' +
            'an ancestor that called useForm() multiple times; descendants ' +
            'only see the last-provided form. useForm() was called at:\n' +
            lines.join('\n') +
            '\nFix: pass a key to useFormContext<F>(key) to target a specific ' +
            'form (named entries above are already addressable by key), or ' +
            'split the forms across separate components.'
        )
      }
      return
    }
    ancestor = ancestor.parent
  }
}
