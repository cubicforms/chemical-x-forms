import type { App } from 'vue'
import type { FormStore } from './create-form-store'
import type { DecantRegistry } from './registry'
import type { GenericForm } from '../types/types-core'
import type { FormKey } from '../types/types-api'
import { canonicalizePath } from './paths'
import { isSensitivePath } from './persistence/sensitive-names'

/**
 * Vue DevTools plugin wiring for decant. Lazy-imported by
 * `createDecant` under dev-mode guards so the production
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
 * optional. If the import fails, `setupDecantDevtools` silently
 * no-ops so production builds / users without DevTools installed
 * don't see errors.
 */

const INSPECTOR_ID = 'decant'
const TIMELINE_LAYER_ID = 'decant:events'

const REDACTED = '[redacted]'

/**
 * Walk `value` and replace any leaf whose enclosing path matches the
 * sensitive-name heuristic with the string `'[redacted]'`. Returns a
 * new tree (no mutation of the input). Object keys + array indices
 * are preserved; only the leaf payloads change.
 *
 * Applied to BOTH the DevTools timeline events and the inspector
 * `Form value` panel — leaks via either surface are treatable as
 * "any developer with the panel open during user testing can read
 * a customer's password," which is exactly the failure mode the
 * sensitive-name guard exists to prevent on the storage side.
 *
 * Leaves whose path doesn't match a pattern pass through untouched.
 * `acknowledgeSensitive: true` on persistence does NOT bypass this —
 * if the consumer opted into persisting the value, they still
 * shouldn't see it in DevTools timelines that grow unbounded.
 */
function redactSensitiveLeaves(
  value: unknown,
  pathSoFar: ReadonlyArray<string | number> = []
): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') {
    // Primitive leaf — redact if the enclosing path is sensitive.
    return isSensitivePath([...pathSoFar]) ? REDACTED : value
  }
  if (Array.isArray(value)) {
    return value.map((item, idx) => redactSensitiveLeaves(item, [...pathSoFar, idx]))
  }
  // Plain object (Map / Set / Date / etc. fall through to "treat as
  // primitive" — DevTools rendering of those is already heuristic).
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return isSensitivePath([...pathSoFar]) ? REDACTED : value
  }
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = redactSensitiveLeaves((value as Record<string, unknown>)[key], [...pathSoFar, key])
  }
  return out
}

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
export async function setupDecantDevtools(app: App, registry: DecantRegistry): Promise<boolean> {
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
      label: 'Decant',
      packageName: 'decant',
      homepage: 'https://github.com/decantjs/forms',
      app,
      componentStateTypes: ['Decant form'],
    },
    (api) => wire(api, app, registry)
  )
  return true
}

function wire(api: UnsafeDevtoolsApi, app: App, registry: DecantRegistry): void {
  // Per-form subscriber bookkeeping — we keep the unsubscribers so
  // the registry's eviction path can detach them when a form is
  // disposed. Using a Map keyed by FormKey mirrors the registry.
  const subscriberUnsubs = new Map<FormKey, () => void>()

  api.addInspector({ id: INSPECTOR_ID, label: 'Decant', app })
  api.addTimelineLayer({ id: TIMELINE_LAYER_ID, label: 'Decant', color: 0x5b8def })

  function refreshTree(): void {
    api.sendInspectorTree(INSPECTOR_ID)
  }

  function refreshState(): void {
    api.sendInspectorState(INSPECTOR_ID)
  }

  function subscribeForm(state: FormStore<GenericForm>): void {
    if (subscriberUnsubs.has(state.formKey)) return
    const unsubChange = state.onFormChange(() => {
      refreshState()
      api.addTimelineEvent({
        layerId: TIMELINE_LAYER_ID,
        event: {
          time: Date.now(),
          title: 'form.change',
          subtitle: state.formKey,
          // Redact sensitive-named leaves before they land in the
          // timeline event log — events accumulate for the whole
          // session and a screen-share / paired-debugging session
          // would otherwise expose any password / token / etc. the
          // user typed since DevTools was opened.
          data: { form: redactSensitiveLeaves(state.form.value) as Record<string, unknown> },
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
          data: { form: redactSensitiveLeaves(state.form.value) as Record<string, unknown> },
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
    // Redact sensitive-named leaves in the inspector panel for the
    // same reason as the timeline events: a screen-share with an
    // open DevTools panel shouldn't expose passwords / tokens.
    // Editing stays enabled at the section level — the editInspector
    // handler refuses sensitive-path edits at write time so a dev
    // can't accidentally write the literal string `'[redacted]'` over
    // a real value.
    payload.state['Form value'] = [
      { key: 'form', value: redactSensitiveLeaves(state.form.value), editable: true },
    ]
    // Schema-driven and user-injected errors land in separate inspector
    // sections so devs can see the source distinction at a glance — a
    // user-injected entry surviving a successful submit, or a schema
    // entry that should have cleared after a value fix, are immediately
    // visible without cross-referencing call sites.
    payload.state['Schema Errors'] = [
      ...[...state.schemaErrors.entries()].map(([k, v]) => ({
        key: String(k),
        value: v as unknown,
      })),
    ]
    payload.state['User Errors'] = [
      ...[...state.userErrors.entries()].map(([k, v]) => ({
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
    // the target form path the user edited. Pass the segment array
    // directly to `canonicalizePath`: join('.') would collapse a
    // literal-dot field key (`{"user.email": ...}`) into two segments,
    // writing to the wrong leaf.
    if (payload.path.length < 3) return
    const section = payload.path[0]
    if (section !== 'Form value') return
    const segments = payload.path.slice(2)
    const { segments: canonicalPath, key: canonicalKey } = canonicalizePath(segments)
    // Refuse edits on sensitive-named paths. The inspector renders
    // them as `'[redacted]'`, so a dev who confirms the field would
    // overwrite the real value with the literal masked string. Edits
    // to sensitive paths must go through the bound input element.
    if (isSensitivePath([...canonicalPath])) return
    // A devtools edit on a path that any element has opted in to should
    // persist (matches the user's expectation: editing via the inspector
    // should be indistinguishable from typing into the bound input).
    // No opt-in for this path → no write.
    state.setValueAtPath(canonicalPath, payload.state.value, {
      persist: state.persistOptIns.hasAnyOptInForPath(canonicalKey),
    })
    refreshState()
  })

  // Initial sync so existing forms show up.
  syncForms()
  refreshTree()
}
