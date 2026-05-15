<script setup lang="ts">
  import { onBeforeUnmount, ref } from 'vue'
  // Route runtime imports through the public `attaform` entry — see
  // `AttaformDevtoolsPanel.vue` for the full rationale.
  import { type AttaformDevtoolsBridge, DEVTOOLS_WINDOW_KEY } from 'attaform'
  import AttaformDevtoolsPanel from '../components/AttaformDevtoolsPanel.vue'

  defineOptions({ name: 'AttaformDevtoolsRoute' })

  // SSR: render the loading stub. The bridge only exists client-side
  // (`window` doesn't on the server), so SSR can't mount the real panel.
  // Vue's hydration replaces this with the live mount on the client.
  const bridge = ref<AttaformDevtoolsBridge | null>(null)
  const error = ref<string | null>(null)

  if (import.meta.client) {
    // The page may load before the host plugin has attached the bridge —
    // the panel iframe and the host page bootstrap in parallel. Poll for
    // up to 2s in 50ms ticks. In practice the host plugin runs at
    // `enforce: 'pre'` and is up well before the iframe finishes its
    // own boot; this is defense for cold-load timing edge cases.
    const start = Date.now()
    const POLL_TIMEOUT_MS = 2000
    const POLL_INTERVAL_MS = 50

    function pickup(): void {
      // Prefer the parent frame (we run inside the Nuxt DevTools iframe);
      // fall back to `window` itself for the case where the panel is
      // opened in a standalone browser tab (useful for debugging).
      const candidate =
        (typeof window.parent !== 'undefined' && window.parent !== window
          ? window.parent[DEVTOOLS_WINDOW_KEY]
          : undefined) ?? window[DEVTOOLS_WINDOW_KEY]
      if (candidate !== undefined) {
        bridge.value = candidate
        return
      }
      if (Date.now() - start >= POLL_TIMEOUT_MS) {
        error.value =
          'Attaform devtools bridge not found. The host app may not have the Nuxt module installed, or you are running this page outside the Nuxt DevTools overlay.'
        return
      }
      timer = window.setTimeout(pickup, POLL_INTERVAL_MS)
    }

    let timer: number | null = window.setTimeout(pickup, 0)

    onBeforeUnmount(() => {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    })
  }
</script>

<template>
  <ClientOnly>
    <div v-if="bridge !== null" class="atf-route">
      <AttaformDevtoolsPanel :bridge="bridge" />
    </div>
    <div v-else-if="error !== null" class="atf-route-error">
      <h1>Attaform DevTools</h1>
      <p>{{ error }}</p>
    </div>
    <div v-else class="atf-route-loading">
      <p>Loading Attaform DevTools…</p>
    </div>
    <template #fallback>
      <div class="atf-route-loading">
        <p>Loading Attaform DevTools…</p>
      </div>
    </template>
  </ClientOnly>
</template>

<style scoped>
  .atf-route,
  .atf-route-error,
  .atf-route-loading {
    height: 100vh;
    margin: 0;
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
  }
  .atf-route-error,
  .atf-route-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2rem;
    background: #0f172a;
    color: #e2e8f0;
  }
  .atf-route-error h1 {
    margin: 0 0 0.5rem;
    font-size: 16px;
  }
  .atf-route-error p,
  .atf-route-loading p {
    color: #94a3b8;
    font-size: 13px;
    max-width: 28rem;
  }
  @media (prefers-color-scheme: light) {
    .atf-route-error,
    .atf-route-loading {
      background: #ffffff;
      color: #0f172a;
    }
    .atf-route-error p,
    .atf-route-loading p {
      color: #64748b;
    }
  }
</style>
