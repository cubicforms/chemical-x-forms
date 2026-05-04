import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  modules: ['@nuxt/content', '@nuxtjs/color-mode'],
  devtools: { enabled: true },
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
  vite: {
    plugins: [tailwindcss()],
  },
  css: ['~/assets/css/tailwind.css'],
})
