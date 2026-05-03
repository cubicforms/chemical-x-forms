import type { App } from 'vue'
import type { FormKey } from '../types/types-api'
import { getRegistryFromApp, type SerializedFormData } from './registry'

/**
 * Serialised snapshot of every form in a Vue app, produced by
 * `renderDecantState` and consumed by `hydrateDecantState`.
 *
 * JSON-safe — pass to `JSON.stringify`, `devalue`, or any other
 * serialiser before embedding in your SSR payload.
 */
export type SerializedDecantState = {
  /** Tuples of `[formKey, snapshot]` for every form in the app. */
  readonly forms: ReadonlyArray<readonly [FormKey, SerializedFormData]>
}

/**
 * Snapshot every form on a Vue app for SSR. Call from your server
 * entry after rendering the app:
 *
 * ```ts
 * import { renderToString } from '@vue/server-renderer'
 * import { renderDecantState, escapeForInlineScript } from 'decant'
 *
 * const html = await renderToString(app)
 * const state = renderDecantState(app)
 * const payload = escapeForInlineScript(JSON.stringify(state))
 *
 * return `
 *   ${html}
 *   <script>window.__CX_STATE__ = ${payload}</script>
 * `
 * ```
 *
 * Pair with `hydrateDecantState` on the client to restore the
 * forms in their server-rendered state. Nuxt users don't need this —
 * `decant/nuxt` wires SSR automatically.
 */
export function renderDecantState(app: App): SerializedDecantState {
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
 * import { createDecant, hydrateDecantState } from 'decant'
 *
 * const app = createApp(App).use(createDecant())
 * hydrateDecantState(app, window.__CX_STATE__)
 * app.mount('#app')
 * ```
 *
 * The next `useForm({ key })` call for each serialised form picks up
 * the snapshot transparently — no further action is required.
 */
export function hydrateDecantState(app: App, payload: SerializedDecantState): void {
  const registry = getRegistryFromApp(app)
  for (const [key, data] of payload.forms) {
    registry.pendingHydration.set(key, data)
  }
}
