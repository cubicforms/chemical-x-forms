import tailwindcss from '@tailwindcss/vite'
import { transformerTwoslash } from '@shikijs/twoslash'

export default defineNuxtConfig({
  modules: ['@nuxt/content', '@nuxt/fonts', '@nuxtjs/color-mode'],
  // @nuxt/content's Shiki integration. Pinning the themes and lang
  // set here is intentional — the default theme set is broad and
  // bundles ~50 grammars we don't need; whitelisting brings the
  // build smaller and faster. Light / dark theme pair flips with the
  // `.dark` selector through Shiki's css-variables theme mode.
  content: {
    build: {
      markdown: {
        highlight: {
          theme: {
            default: 'github-light',
            dark: 'github-dark',
          },
          langs: [
            'ts',
            'tsx',
            'js',
            'jsx',
            'json',
            'vue',
            'vue-html',
            'html',
            'css',
            'bash',
            'sh',
            'yaml',
            'md',
            'diff',
          ],
          // Twoslash adds inline TS type information to opt-in code
          // blocks (` ```ts twoslash` or ` ```vue twoslash`). With
          // explicitTrigger true, every other code block renders
          // unchanged — Twoslash only kicks in when a doc page asks
          // for it. The rich renderer gives popovers (the standard
          // Twoslash UI) instead of inline annotations.
          transformers: [
            transformerTwoslash({
              explicitTrigger: true,
              renderer: 'rich',
              throws: false,
            }),
          ],
        },
      },
    },
  },
  // Webfonts are downloaded from Google Fonts at build time and emitted
  // into the build output as woff2 + an inline @font-face block; pages
  // reference local URLs only, so visitors never reach out to Google.
  // We pin the families here (rather than relying on auto-detection
  // from `--font-sans` / `--font-mono` in tailwind.css) for two
  // reasons: 1) the auto-detector occasionally misses tokens behind
  // CSS variables in @theme blocks, 2) explicit weights keep the
  // bundle deterministic — Inter ships at 400/500/600/700 because
  // those are the only weights the design system actually uses.
  fonts: {
    families: [
      { name: 'Inter', provider: 'google', weights: [400, 500, 600, 700] },
      { name: 'JetBrains Mono', provider: 'google', weights: [400, 500, 600] },
    ],
    defaults: {
      subsets: ['latin', 'latin-ext'],
      styles: ['normal'],
    },
  },
  devtools: { enabled: true },
  compatibilityDate: '2025-01-28',
  // Bind to all interfaces so the docker-compose port mapping
  // (3000:3000) reaches the dev server. Local-only dev still works —
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
  // Nitropack's built-in /_vfs dev handler (powering Nuxt DevTools'
  // Virtual Files panel) hard-checks the request IP against ::1 / 127.*
  // and 403s anything else as "Forbidden IP". In Docker our requests
  // arrive from the bridge IP, so the panel breaks. There's no config
  // knob — register a dev pre-handler on the same /_vfs prefix that
  // shadows socket.remoteAddress to 127.0.0.1 and falls through (no
  // response) to the real VFS handler that runs after it. Dev-only via
  // devHandlers.
  nitro: {
    devHandlers: [
      {
        route: '/_vfs',
        handler: (event: { node?: { req?: { socket?: unknown } } }) => {
          const socket = event?.node?.req?.socket as { remoteAddress?: string } | undefined
          if (socket && socket.remoteAddress !== '127.0.0.1') {
            try {
              Object.defineProperty(socket, 'remoteAddress', {
                value: '127.0.0.1',
                configurable: true,
              })
            } catch {
              // Some Node versions expose remoteAddress as a non-configurable
              // getter; nothing we can do at this layer.
            }
          }
        },
      },
    ],
  },
  hooks: {
    // Strip the Shiki transformers from public runtimeConfig before
    // Nitro's serializer runs over it. @nuxt/content copies the whole
    // `content.build.markdown.highlight` block into
    // `runtimeConfig.public.mdc` so client-side MDC rendering can read
    // it — but our Twoslash transformer carries function callbacks
    // (`preprocess`, `tokens`, `pre`, `code`) that don't survive JSON
    // serialization, producing four "may not be able to be serialized"
    // warnings on every dev start.
    //
    // Build-time markdown parsing reads transformers directly from
    // `nuxt.options.content` (not from runtimeConfig), so removing
    // them here doesn't affect the rendered output — it just keeps
    // the functions out of the client-bound config payload, where
    // they'd be useless anyway since Twoslash runs only at parse time.
    'nitro:config'(nitroConfig) {
      const mdc = (nitroConfig.runtimeConfig as { public?: { mdc?: unknown } } | undefined)?.public
        ?.mdc as { highlight?: { transformers?: unknown[] } } | undefined
      if (mdc?.highlight?.transformers) {
        delete mdc.highlight.transformers
      }
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // Mirror Nuxt's devServer.host into Vite's server.host so
    // @vitejs/devtools (which reads viteDevServer.config.server.host
    // directly when picking its WebSocket bind) lands on 0.0.0.0
    // instead of localhost. Without this, devtools' RPC server binds
    // to ::1 inside the container and the docker port forward can't
    // reach it.
    server: { host: '0.0.0.0' },
    // Vite's startup crawl scans index.html + statically discoverable
    // imports; it misses imports inside `.client.vue` components (which
    // SSR skips) and inside Nuxt's lazy page chunks. When those land
    // mid-session, Vite re-bundles and broadcasts an "Outdated Optimize
    // Dep" 504 to in-flight requests — visible as the once-per-cold-
    // boot vue-router 504 that breaks the first navigation. Pre-
    // declaring the heavy site-only deps here makes the boot crawl
    // comprehensive, so first-paint requests resolve cleanly.
    optimizeDeps: {
      include: ['@vue/repl', '@vue/repl/codemirror-editor', 'lucide-vue-next'],
    },
  },
  css: ['@shikijs/twoslash/style-rich.css', '~/assets/css/tailwind.css'],
})
