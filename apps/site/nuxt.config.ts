import tailwindcss from '@tailwindcss/vite'
import { rendererRich, transformerTwoslash } from '@shikijs/twoslash'
import attaformPkg from '../../package.json'
import vuePkg from 'vue/package.json'
import zodPkg from 'zod/package.json'

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
          // for it. `rendererRich()` returns the standard Twoslash
          // popover UI; passing the string `'rich'` (an older API
          // shape) silently breaks at runtime because the transformer
          // expects a renderer object.
          //
          // @ts-expect-error @nuxt/content v3.13's highlight type
          // omits `transformers` even though the runtime forwards
          // the array straight to Shiki, which does accept it. The
          // upstream type fix is tracked at
          // https://github.com/nuxt/content/issues — when @nuxt/content
          // tightens this, drop the directive.
          transformers: [
            transformerTwoslash({
              explicitTrigger: true,
              renderer: rendererRich(),
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
  // Public runtimeConfig values are read at build time from the actual
  // package.json files and surfaced to the client via
  // useRuntimeConfig(). One source of truth per concern — `pnpm
  // version` is the only place to bump.
  //
  //   - attaformVersion: shown in the homepage release pill and the
  //     footer brand block. Reads from attaform's root package.json.
  //   - replDependencyVersion: pinned on the @vue/repl store's
  //     dependencyVersion so Volar skips the (slow + unpkg-bound)
  //     latest-version lookup. Reads from each package's package.json.
  runtimeConfig: {
    public: {
      attaformVersion: attaformPkg.version,
      replDependencyVersion: {
        attaform: attaformPkg.version,
        vue: vuePkg.version,
        zod: zodPkg.version,
      },
    },
  },
  // Disable runtime payload extraction in dev only. Background:
  // Nitro's `payloadCache` (mounted under `cache:nuxt:payload` with
  // an fs base of `.nuxt/cache/nuxt/payload`) writes one cache entry
  // per rendered route. For the root route `/`, unstorage normalizes
  // the key down to an empty string, which the fs driver writes as
  // a bare `payload` *file* at the cache base — collision with the
  // directory it's supposed to be. Every subsequent route then 500s
  // with `ENOTDIR: ... payload/docs-<hash>` when its payload tries
  // to write to `payload/<safe-key>`.
  //
  // Production keeps payload extraction on: prerendering writes
  // `_payload.json` files directly to `.output/public/<route>/` via
  // a different code path that doesn't go through the dev cache, so
  // SPA-style hydration on the static build is unaffected.
  experimental: {
    payloadExtraction: process.env.NODE_ENV === 'production',
  },
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
    // Prerender every reachable route at build time so the production
    // output ships static HTML alongside the SSR runtime. The Pagefind
    // step (`pnpm index:search` after `nuxi build`) walks `.output/public`
    // for HTML files; without prerendering the directory holds only
    // assets and `_payload.json`, and Pagefind exits with "did not find
    // any html files."
    //
    // `crawlLinks: true` follows internal `<a href>` and NuxtLink
    // targets from the seed routes, so we only have to list the entry
    // points. `/docs` is the index page that links into every doc;
    // `/play` and `/` round out the rest of the public surface.
    // failOnError: false keeps a single broken anchor in markdown
    // from failing the whole build — Nuxt logs the misses to stderr.
    prerender: {
      crawlLinks: true,
      routes: ['/', '/docs', '/play'],
      failOnError: false,
    },
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
    // reach it. Nuxt's typing of `vite.server` Omits `host` (it
    // expects you to use the top-level `devServer.host`), but Vite
    // itself accepts the value and devtools needs it set on Vite's
    // own config, so we suppress the type error.
    // @ts-expect-error see comment above — Nuxt-typed Omit, Vite-accepted runtime field
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
      include: ['lucide-vue-next'],
      // Both @vue/repl entries are excluded from prebundling for two
      // reasons that interlock:
      //
      // 1. `@vue/repl/monaco-editor` references its bundled web
      //    workers via `new URL("assets/<worker>.js", import.meta.url)`.
      //    The worker chunks ship under
      //    `node_modules/@vue/repl/dist/assets/`. Prebundling
      //    relocates the entry to `node_modules/.cache/vite/...` but
      //    doesn't copy the assets siblings, so the worker URL 404s.
      //
      // 2. If we prebundle `@vue/repl` but not `@vue/repl/monaco-editor`,
      //    they end up resolving `vue` through different module graphs
      //    (Vite's prebundled vue chunk vs. raw node_modules vue) — the
      //    EditorContainer's `provide(propsKey, …)` and Monaco's
      //    `inject(propsKey)` then use different InjectionKey symbols,
      //    so Monaco's setup throws "injection Symbol(props) not
      //    found" and falls back to a render-less component.
      //
      // Excluding both keeps both entries served from their real
      // node_modules paths (assets/ neighbors resolve) and through the
      // same resolver (single vue copy across the @vue/repl tree).
      exclude: ['@vue/repl', '@vue/repl/monaco-editor'],
    },
  },
  css: ['@shikijs/twoslash/style-rich.css', '~/assets/css/tailwind.css'],
})
