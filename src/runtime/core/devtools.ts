import type { App } from 'vue'
import type { FormState } from './create-form-state'
import type { ChemicalXRegistry } from './registry'
import type { GenericForm } from '../types/types-core'
import type { FormKey } from '../types/types-api'
import { canonicalizePath } from './paths'

/**
 * Vue DevTools plugin wiring for @chemical-x/forms. Lazy-imported by
 * `createChemicalXForms` under dev-mode guards so the production
 * bundle tree-shakes it out entirely.
 *
 * Registers:
 *  - An inspector (per-app) that lists every registered form, with
 *    nodes for form value / errors / aggregates / history.
 *  - A timeline layer that emits events on submit start/success/
 *    failure, reset, undo, redo, and form mutations.
 *  - State editing — modifying a leaf inside the inspector tree
 *    pushes through `state.setValueAtPath`, mutating the form.
 *
 * Tolerant of missing `@vue/devtools-api` — the peer dep is marked
 * optional. If the import fails, `setupChemicalXDevtools` silently
 * no-ops so production builds / users without DevTools installed
 * don't see errors.
 */

const INSPECTOR_ID = 'chemical-x-forms'
const TIMELINE_LAYER_ID = 'chemical-x-forms:events'

type UnsafeDevtoolsApi = {
  addInspector(opts: { id: string; label: string; icon?: string; app: App }): void
  addTimelineLayer(opts: { id: string; label: string; color: number }): void
  sendInspectorTree(inspectorId: string): void
  sendInspectorState(inspectorId: string): void
  addTimelineEvent(payload: {
    layerId: string
    event: {
      time: number
      title: string
      subtitle?: string
      data?: Record<string, unknown>
      groupId?: string | number
    }
  }): void
  on: {
    getInspectorTree(
      handler: (payload: {
        inspectorId: string
        filter: string
        rootNodes: Array<{ id: string; label: string; tags?: unknown[] }>
      }) => void
    ): void
    getInspectorState(
      handler: (payload: {
        inspectorId: string
        nodeId: string
        state: Record<string, Array<{ key: string; value: unknown; editable?: boolean }>>
      }) => void
    ): void
    editInspectorState(
      handler: (payload: {
        inspectorId: string
        nodeId: string
        path: string[]
        state: { value: unknown; newKey?: string | null; remove?: boolean }
      }) => void
    ): void
  }
}

type SetupDevtoolsPluginFn = (
  descriptor: {
    id: string
    label: string
    packageName?: string
    homepage?: string
    componentStateTypes?: string[]
    app: App
  },
  setup: (api: UnsafeDevtoolsApi) => void
) => void

/**
 * Install the DevTools plugin for the given Vue app + registry. Safe
 * to call in production — if `@vue/devtools-api` isn't installed, the
 * dynamic import fails and we log nothing. Returns `true` when
 * DevTools was wired successfully, `false` otherwise — useful for
 * tests.
 */
export async function setupChemicalXDevtools(
  app: App,
  registry: ChemicalXRegistry
): Promise<boolean> {
  let mod: { setupDevtoolsPlugin?: SetupDevtoolsPluginFn }
  try {
    mod = (await import('@vue/devtools-api')) as {
      setupDevtoolsPlugin?: SetupDevtoolsPluginFn
    }
  } catch {
    // Peer dep not installed — silently skip. Production builds pass
    // `{ devtools: false }` explicitly, but this catch covers the
    // "dev without the peer dep" case without a noisy warning.
    return false
  }
  const setupDevtoolsPlugin = mod.setupDevtoolsPlugin
  if (typeof setupDevtoolsPlugin !== 'function') return false

  setupDevtoolsPlugin(
    {
      id: INSPECTOR_ID,
      label: 'Chemical X Forms',
      packageName: '@chemical-x/forms',
      homepage: 'https://github.com/cubicforms/chemical-x-forms',
      app,
      componentStateTypes: ['Chemical X form'],
    },
    (api) => wire(api, app, registry)
  )
  return true
}

function wire(api: UnsafeDevtoolsApi, app: App, registry: ChemicalXRegistry): void {
  // Per-form subscriber bookkeeping — we keep the unsubscribers so
  // the registry's eviction path can detach them when a form is
  // disposed. Using a Map keyed by FormKey mirrors the registry.
  const subscriberUnsubs = new Map<FormKey, () => void>()

  api.addInspector({ id: INSPECTOR_ID, label: 'Chemical X Forms', app })
  api.addTimelineLayer({ id: TIMELINE_LAYER_ID, label: 'Chemical X Forms', color: 0x5b8def })

  function refreshTree(): void {
    api.sendInspectorTree(INSPECTOR_ID)
  }

  function refreshState(): void {
    api.sendInspectorState(INSPECTOR_ID)
  }

  function subscribeForm(state: FormState<GenericForm>): void {
    if (subscriberUnsubs.has(state.formKey)) return
    const unsubChange = state.onFormChange(() => {
      refreshState()
      api.addTimelineEvent({
        layerId: TIMELINE_LAYER_ID,
        event: {
          time: Date.now(),
          title: 'form.change',
          subtitle: state.formKey,
          data: { form: state.form.value as unknown as Record<string, unknown> },
        },
      })
    })
    const unsubSubmit = state.onSubmitSuccess(() => {
      api.addTimelineEvent({
        layerId: TIMELINE_LAYER_ID,
        event: {
          time: Date.now(),
          title: 'submit.success',
          subtitle: state.formKey,
          data: { form: state.form.value as unknown as Record<string, unknown> },
        },
      })
    })
    const unsubReset = state.onReset(() => {
      refreshState()
      api.addTimelineEvent({
        layerId: TIMELINE_LAYER_ID,
        event: {
          time: Date.now(),
          title: 'reset',
          subtitle: state.formKey,
        },
      })
    })
    subscriberUnsubs.set(state.formKey, () => {
      unsubChange()
      unsubSubmit()
      unsubReset()
    })
  }

  // Subscribe all currently-registered forms + register as they're
  // added. The registry's `forms` Map is shallowReactive — we poll
  // once per render on refresh; for live change detection, each
  // useForm call that adds a new form triggers a tree/state refresh
  // via the form's own onFormChange emission on the first
  // applyFormReplacement.
  function syncForms(): void {
    for (const [, state] of registry.forms) {
      subscribeForm(state)
    }
    // Drop subscribers for forms that were evicted.
    for (const [formKey, unsub] of subscriberUnsubs) {
      if (!registry.forms.has(formKey)) {
        unsub()
        subscriberUnsubs.delete(formKey)
      }
    }
  }

  api.on.getInspectorTree((payload) => {
    if (payload.inspectorId !== INSPECTOR_ID) return
    syncForms()
    payload.rootNodes = [...registry.forms.keys()].map((key) => ({
      id: `form:${key}`,
      label: key,
      tags: [],
    }))
  })

  api.on.getInspectorState((payload) => {
    if (payload.inspectorId !== INSPECTOR_ID) return
    if (!payload.nodeId.startsWith('form:')) return
    const formKey = payload.nodeId.slice('form:'.length)
    const state = registry.forms.get(formKey)
    if (state === undefined) return
    payload.state['Form value'] = [
      { key: 'form', value: state.form.value as unknown, editable: true },
    ]
    payload.state['Errors'] = [
      ...[...state.errors.entries()].map(([k, v]) => ({
        key: String(k),
        value: v as unknown,
      })),
    ]
    payload.state['Aggregates'] = [
      { key: 'isSubmitting', value: state.isSubmitting.value },
      { key: 'submitCount', value: state.submitCount.value },
      { key: 'submitError', value: state.submitError.value },
      { key: 'activeValidations', value: state.activeValidations.value },
    ]
  })

  api.on.editInspectorState((payload) => {
    if (payload.inspectorId !== INSPECTOR_ID) return
    if (!payload.nodeId.startsWith('form:')) return
    const formKey = payload.nodeId.slice('form:'.length)
    const state = registry.forms.get(formKey)
    if (state === undefined) return
    // payload.path is `['Form value', 'form', ...pathSegments]` — the
    // first two segments are the inspector section + key, the rest is
    // the target form path the user edited.
    if (payload.path.length < 3) return
    const section = payload.path[0]
    if (section !== 'Form value') return
    const segments = payload.path.slice(2)
    const { segments: canonicalPath } = canonicalizePath(segments.join('.'))
    state.setValueAtPath(canonicalPath, payload.state.value)
    refreshState()
  })

  // Initial sync so existing forms show up.
  syncForms()
  refreshTree()
}
