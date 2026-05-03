import type { App } from 'vue'
import type { FormKey } from '../types/types-api'
import { getRegistryFromApp, type SerializedFormData } from './registry'

/**
 * Serialised snapshot of every form in a Vue app, produced by
 * `renderAttaformState` and consumed by `hydrateAttaformState`.
 *
 * JSON-safe — pass to `JSON.stringify`, `devalue`, or any other
 * serialiser before embedding in your SSR payload.
 */
export type SerializedAttaformState = {
  /** Tuples of `[formKey, snapshot]` for every form in the app. */
  readonly forms: ReadonlyArray<readonly [FormKey, SerializedFormData]>
}

/**
 * Snapshot every form on a Vue app for SSR. Call from your server
 * entry after rendering the app:
 *
 * ```ts
 * import { renderToString } from '@vue/server-renderer'
 * import { renderAttaformState, escapeForInlineScript } from 'attaform'
 *
 * const html = await renderToString(app)
 * const state = renderAttaformState(app)
 * const payload = escapeForInlineScript(JSON.stringify(state))
 *
 * return `
 *   ${html}
 *   <script>window.__ATTAFORM_STATE__ = ${payload}</script>
 * `
 * ```
 *
 * Pair with `hydrateAttaformState` on the client to restore the
 * forms in their server-rendered state. Nuxt users don't need this —
 * `attaform/nuxt` wires SSR automatically.
 */
export function renderAttaformState(app: App): SerializedAttaformState {
  const registry = getRegistryFromApp(app)
  const forms: Array<readonly [FormKey, SerializedFormData]> = []
  for (const [key, state] of registry.forms) {
    // Skip the blank field when the set is empty so the
    // wire payload stays minimal for forms that don't use it. The
    // optional shape on the consuming side handles the absence
    // cleanly (defaults to "no blank paths").
    const transientList = Array.from(state.blankPaths)
    forms.push([
      key,
      {
        form: state.form.value,
        schemaErrors: Array.from(state.schemaErrors.entries()),
        userErrors: Array.from(state.userErrors.entries()),
        fields: Array.from(state.fields.entries()),
        ...(transientList.length > 0 ? { blankPaths: transientList } : {}),
      },
    ])
  }
  return { forms }
}

/**
 * Restore forms from a server-rendered snapshot on the client. Call
 * from your client entry before mounting:
 *
 * ```ts
 * import { createApp } from 'vue'
 * import { createAttaform, hydrateAttaformState } from 'attaform'
 *
 * const app = createApp(App).use(createAttaform())
 * hydrateAttaformState(app, window.__ATTAFORM_STATE__)
 * app.mount('#app')
 * ```
 *
 * The next `useForm({ key })` call for each serialised form picks up
 * the snapshot transparently — no further action is required.
 */
export function hydrateAttaformState(app: App, payload: SerializedAttaformState): void {
  const registry = getRegistryFromApp(app)
  for (const [key, data] of payload.forms) {
    registry.pendingHydration.set(key, data)
  }
}
