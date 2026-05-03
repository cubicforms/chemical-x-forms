/**
 * Nuxt plugin: installs the framework-agnostic createAttaform Vue
 * plugin on nuxtApp.vueApp and wires the Nuxt payload mechanism to the
 * registry's SSR serialization helpers. Replaces the old split of
 * register.ts (client-only) + register-stub.ts (server-only).
 *
 * Runs on BOTH server and client — Vue's SSR renderer is a natural no-op
 * for directive lifecycle hooks, so the same plugin works on both sides
 * without a stub.
 */
import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app'
import { createAttaform } from '../core/plugin'
import { hydrateAttaformState, renderAttaformState } from '../core/serialize'
import type { SerializedAttaformState } from '../core/serialize'
import type { AttaformDefaults } from '../types/types-api'

export default defineNuxtPlugin({
  // `enforce: 'pre'` makes the "we run before any component's setup" claim
  // explicit. Combined with `prepend: true` on the addPlugin call in
  // src/nuxt.ts, this guarantees hydration is staged into pendingHydration
  // before any user plugin or page can call `useForm`. Without it, a user
  // plugin running first would observe an empty registry and skip hydration.
  enforce: 'pre',
  setup(nuxtApp) {
    const isServer = import.meta.server

    // Read app-level defaults from the Nuxt module's runtime-config slot
    // (populated in src/nuxt.ts). The module ships in the same package
    // as this plugin, so the slot is always present and well-typed.
    const { defaults } = (useRuntimeConfig().public as { attaform: { defaults: AttaformDefaults } })
      .attaform

    nuxtApp.vueApp.use(createAttaform({ override: isServer, defaults }))

    if (isServer) {
      // After the app renders, capture every FormStore into the Nuxt payload
      // so the client can hydrate with matching form values and errors.
      nuxtApp.hook('app:rendered', () => {
        const state = renderAttaformState(nuxtApp.vueApp)
        ;(nuxtApp.payload as unknown as { attaform?: SerializedAttaformState }).attaform = state
      })
    } else {
      // Stage the payload into pendingHydration so `useForm` finds it. The
      // `enforce: 'pre'` + `prepend: true` pair above is what makes it safe
      // to assume this runs before any user setup.
      const serialized = (nuxtApp.payload as unknown as { attaform?: SerializedAttaformState })
        .attaform
      if (serialized !== undefined) {
        hydrateAttaformState(nuxtApp.vueApp, serialized)
      }
    }
  },
})
