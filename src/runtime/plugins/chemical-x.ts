/**
 * Nuxt plugin: installs the framework-agnostic createChemicalXForms Vue
 * plugin on nuxtApp.vueApp and wires the Nuxt payload mechanism to the
 * registry's SSR serialization helpers. Replaces the old split of
 * register.ts (client-only) + register-stub.ts (server-only).
 *
 * Runs on BOTH server and client — Vue's SSR renderer is a natural no-op
 * for directive lifecycle hooks, so the same plugin works on both sides
 * without a stub.
 */
import { defineNuxtPlugin } from 'nuxt/app'
import { createChemicalXForms } from '../core/plugin'
import { hydrateChemicalXState, renderChemicalXState } from '../core/serialize'
import type { SerializedChemicalXState } from '../core/serialize'

export default defineNuxtPlugin((nuxtApp) => {
  const isServer = import.meta.server
  nuxtApp.vueApp.use(createChemicalXForms({ override: isServer }))

  if (isServer) {
    // After the app renders, capture every FormState into the Nuxt payload
    // so the client can hydrate with matching form values and errors.
    nuxtApp.hook('app:rendered', () => {
      const state = renderChemicalXState(nuxtApp.vueApp)
      ;(nuxtApp.payload as unknown as { chemicalX?: SerializedChemicalXState }).chemicalX = state
    })
  } else {
    // Before any component's setup() runs (guaranteed by Nuxt's plugin
    // ordering since this plugin is installed first), stage the payload
    // into pendingHydration so `useForm` finds it.
    const serialized = (nuxtApp.payload as unknown as { chemicalX?: SerializedChemicalXState })
      .chemicalX
    if (serialized !== undefined) {
      hydrateChemicalXState(nuxtApp.vueApp, serialized)
    }
  }
})
