import { getCurrentInstance, getCurrentScope, inject, onScopeDispose, useId } from 'vue'
import { buildFormApi } from '../core/build-form-api'
import type { FormStore } from '../core/create-form-store'
import { __DEV__ } from '../core/dev'
import { captureUserCallSite } from '../core/dev-stack-trace'
import type { HistoryModule } from '../core/history'
import { kFormContext, kFormInstanceId, useRegistry, type DecantRegistry } from '../core/registry'
import type { FormKey, UseFormReturnType } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import { ambientProvideHistory } from './use-abstract-form'

/**
 * Module-local counter for the test/ad-hoc fallback when neither an
 * ambient `kFormInstanceId` provide nor a Vue instance is available.
 * Uniqueness is sufficient — these consumers don't share an
 * `instanceId` with anything else in the tree by definition.
 */
let injectedInstanceCounter = 0

/**
 * Access an existing form from a descendant component without passing
 * it through props. Counterpart to `useForm` — `useForm` creates and
 * provides; `injectForm` looks up via Vue's inject mechanism.
 *
 * Two ways to call it:
 *
 * ```ts
 * // Reach the nearest ancestor's anonymous useForm() call.
 * const form = injectForm<SignupShape>()
 *
 * // Reach a specific form by its key — works from anywhere in the app.
 * const cart = injectForm<CartShape>('cart')
 * ```
 *
 * Resolution rules (no-key form):
 * - Closest ambient ancestor wins.
 * - Only anonymous `useForm()` (no `key`) fills the ambient slot;
 *   keyed forms are reachable only via `injectForm(key)`.
 * - Inherits the resolved ancestor's `formInstanceId`.
 *
 * Resolution rules (keyed form): registry lookup by string key,
 * independent of component-tree position.
 *
 * Returns `null` when no matching form exists (no ambient ancestor, or
 * the named key isn't registered). A dev-mode warning points at the
 * call site to help diagnose typos. Always narrow before using:
 *
 * ```ts
 * const form = injectForm<Shape>('signup')
 * if (!form) return
 * form.register('email')
 * ```
 *
 * Pass the `Form` generic explicitly — Vue's provide/inject erases
 * generics, so the library can't recover the shape automatically.
 *
 * The form is kept alive for this component's lifetime; once every
 * consumer unmounts, the form is cleaned up automatically.
 */
export function injectForm<Form extends GenericForm, GetValueFormType extends GenericForm = Form>(
  key?: FormKey
): UseFormReturnType<Form, GetValueFormType> | null {
  const registry = useRegistry()

  const state = resolveState<Form>(key, registry)
  if (state === null) return null

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
  const apiOptions: Parameters<typeof buildFormApi<Form, GetValueFormType>>[2] = {}
  const history = state.modules.get('history') as HistoryModule | undefined
  if (history !== undefined) {
    apiOptions.history = history
  }
  // Inherit the ancestor `useForm()`'s instanceId when one is provided.
  // Keeps parent-submit-focus working for inputs registered by deep
  // children using `injectForm()` + their own local `register()` calls
  // — both sides tag against the SAME instance.
  //
  // Falls back to a fresh ID when:
  //   - `injectForm('cart')` reaches a form by key from a tree branch
  //     that has no ambient provide chain to it (cross-tree access);
  //   - or no Vue instance is available (test / ad-hoc usage).
  // In those cases the consumer's local registrations are isolated —
  // the original `useForm()` callsite's `focusFirstError` won't see
  // them, but the consumer's own focus calls work locally.
  const ambientInstanceId = getCurrentInstance() !== null ? inject(kFormInstanceId, null) : null
  const formInstanceId =
    ambientInstanceId ??
    (getCurrentInstance() !== null
      ? useId()
      : `cx:form-instance-injected:${injectedInstanceCounter++}`)
  return buildFormApi<Form, GetValueFormType>(state, formInstanceId, apiOptions)
}

/**
 * Resolves the FormStore for the requested key (or the ambient slot
 * when no key was passed). Returns `null` on miss; the caller propagates
 * that null straight out to the consumer.
 *
 * Both miss modes log a dev-mode warning carrying the user's call-site
 * frame — a typo'd key reads as "[cx] injectForm: no form registered
 * for key 'userz'. Returning null. (pages/profile.vue:42)" rather than
 * as a stack trace from inside cx internals.
 */
function resolveState<Form extends GenericForm>(
  key: FormKey | undefined,
  registry: DecantRegistry
): FormStore<Form> | null {
  if (key !== undefined) {
    const stored = registry.forms.get(key) as FormStore<Form> | undefined
    if (stored === undefined) {
      warnMiss(`no form registered for key '${key}'`, registry.isSSR)
      return null
    }
    return stored
  }
  const ambient = inject(kFormContext, null) as FormStore<Form> | null
  if (ambient === null) {
    warnMiss('no ambient form context', registry.isSSR)
    return null
  }
  warnIfAmbientProviderHadDuplicates()
  return ambient
}

/**
 * Skipped on SSR — Nuxt's `dev:ssr-logs` hook forwards server warns to
 * the browser console alongside the client-side warn that fires from
 * the hydration setup, so the same miss would surface twice per page
 * load. The signal is identical on both passes (registry state is
 * deterministic across SSR/client), so emitting only on the client is
 * lossless and halves dev-mode noise. Production stays silent on both.
 */
function warnMiss(detail: string, isSSR: boolean): void {
  if (!__DEV__ || isSSR) return
  const frame = captureUserCallSite()
  console.warn(
    `[decant] injectForm: ${detail}. Returning null.` + (frame !== undefined ? ` ${frame}` : '')
  )
}

/**
 * Walk up from the current component to the nearest ancestor that
 * registered an ambient provide (tracked in `ambientProvideHistory`).
 * If that ancestor recorded more than one ANONYMOUS `useForm()` call,
 * a descendant reaching for the ambient slot only sees the last one
 * — warn so the author picks between adding a key and splitting the
 * component.
 *
 * The eager version of this check lived at the `useForm()` call site
 * and fired once per extra form regardless of whether any descendant
 * actually used the ambient slot. That made spike / test pages wall-
 * warn for a non-problem; this version fires at most once per
 * `injectForm()` consumer that genuinely collides.
 *
 * Keyed `useForm()` calls don't appear here — they don't fill the
 * ambient slot at all (they're addressable explicitly via
 * `injectForm<F>(key)`), so they can't collide with each other
 * or with anonymous siblings on this axis.
 */
function warnIfAmbientProviderHadDuplicates(): void {
  if (!__DEV__ || ambientProvideHistory === null) return
  let ancestor = getCurrentInstance()?.parent ?? null
  while (ancestor !== null) {
    const history = ambientProvideHistory.get(ancestor as unknown as object)
    if (history !== undefined) {
      if (history.length > 1) {
        const lines = history.map((entry) => `  - ${entry.source ?? '<unknown location>'}`)
        console.warn(
          '[decant] injectForm<F>() (no key) resolved against ' +
            'an ancestor with multiple anonymous useForm() calls; descendants ' +
            'only see the last-provided form. Anonymous useForm() calls were:\n' +
            lines.join('\n') +
            '\nFix: pass a key to each call (e.g. useForm({ schema, key: "x" })) ' +
            'and reach them via injectForm<F>("x"), or split the forms ' +
            'across separate components.'
        )
      }
      return
    }
    ancestor = ancestor.parent
  }
}
