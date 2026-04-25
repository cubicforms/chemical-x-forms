import type { App } from 'vue'
import type { FormKey } from '../types/types-api'
import { getRegistryFromApp, type SerializedFormData } from './registry'

/**
 * SSR serialization for bare Vue 3 + `@vue/server-renderer`. Nuxt's
 * built-in payload mechanism is wired to call these in the Nuxt-module
 * plugin (Phase 4); bare-Vue consumers call them explicitly in their
 * entry-server.ts / entry-client.ts scripts.
 *
 * Payload shape is JSON-safe tuples so consumers can pick their own
 * stringifier (JSON.stringify, devalue, whatever). `originals` and
 * `elements` are intentionally omitted: originals are derivable from
 * schema.getInitialState on the client; elements are DOM references that
 * can't round-trip anyway.
 */

export type SerializedChemicalXState = {
  readonly forms: ReadonlyArray<readonly [FormKey, SerializedFormData]>
}

export function renderChemicalXState(app: App): SerializedChemicalXState {
  const registry = getRegistryFromApp(app)
  const forms: Array<readonly [FormKey, SerializedFormData]> = []
  for (const [key, state] of registry.forms) {
    forms.push([
      key,
      {
        form: state.form.value,
        errors: Array.from(state.errors.entries()),
        fields: Array.from(state.fields.entries()),
      },
    ])
  }
  return { forms }
}

export function hydrateChemicalXState(app: App, payload: SerializedChemicalXState): void {
  const registry = getRegistryFromApp(app)
  // Stage the data as pending hydration. Each useForm call will consume
  // this entry when constructing its FormStore so the client starts with
  // the same form value, fields, and errors that the server rendered.
  for (const [key, data] of payload.forms) {
    registry.pendingHydration.set(key, data)
  }
}
