import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  modules: ['@nuxt/content', '@nuxtjs/color-mode'],
  // The bundled @nuxt/devtools 3.2.4 in Nuxt 4.4.4 ships an RPC client
  // that fails its websocket handshake on boot — "Failed to retrieve
  // the current RPC session" — without affecting the site, just
  // spamming the console. Disable the in-browser panel; the Vue
  // DevTools extension is the better debugging surface anyway.
  devtools: { enabled: false },
  compatibilityDate: '2025-01-28',
  // Bind to all interfaces so the docker-compose port mapping
  // (3001:3000) reaches the dev server. Local-only dev still works —
  // 0.0.0.0 includes localhost.
  devServer: { host: '0.0.0.0' },
  // The module emits a blocking inline <script> in <head> that resolves
  // the user's preference (localStorage → system → fallback) and sets
  // <html class="…"> before first paint. classSuffix: '' makes the class
  // bare (`.dark` instead of `.dark-mode`), matching our @variant dark
  // selector in tailwind.css.
  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'light',
    storageKey: 'attaform-color-mode',
  },
  // Mount components/content/ without a path prefix so files in there
  // (e.g. ProseA.vue overriding the default <a> renderer in MDC content)
  // resolve under their bare names — the convention Nuxt Content's
  // prose-override system expects.
  components: [{ path: '~/components/content', pathPrefix: false, global: true }, '~/components'],
  vite: {
    plugins: [tailwindcss()],
  },
  css: ['~/assets/css/tailwind.css'],
})
