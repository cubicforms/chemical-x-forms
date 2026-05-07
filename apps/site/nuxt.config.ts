import { logger as nuxtKitLogger } from '@nuxt/kit'
import tailwindcss from '@tailwindcss/vite'
import { rendererRich, transformerTwoslash } from '@shikijs/twoslash'
import type { Logger, LogOptions } from 'vite'
import attaformPkg from '../../package.json'
import vuePkg from 'vue/package.json'
import zodPkg from 'zod/package.json'

// Two warning families fire on every build, are not ours to fix,
// and add nothing actionable for a maintainer reading the logs:
//
//   1. "Sourcemap is likely to be incorrect: a plugin (…) was used
//      to transform files, but didn't generate a sourcemap for the
//      transformation."
//      — Tailwind v4's vite plugin and Nuxt's module-preload-polyfill
//      transform without emitting sourcemaps. Rollup walks the chain
//      and warns ~17×/build that the resulting maps would be lossy.
//      We've disabled sourcemap output anyway (vite.build.sourcemap
//      = false), so the maps don't ship — the warnings are stale.
//
//   2. "new URL(\"assets/(editor|vue).worker-…\", import.meta.url)
//      doesn't exist at build time, it will remain unchanged to be
//      resolved at runtime."
//      — @vue/repl's Monaco preset constructs its worker URLs via
//      dynamic strings; Vite's static analyser can't resolve them
//      and warns. That warning is exactly the trigger condition for
//      the Worker-constructor Proxy in DemoReplEditor.client.vue,
//      which intercepts the runtime resolution and reroutes to
//      /lib/repl-workers/* (the static copies bundle:repl emits).
//      Filtered narrowly to the editor + vue worker filenames; any
//      other "URL doesn't exist at build time" warning still surfaces.
//
//   3. "Unresolvable optimizeDeps.include entries: @nuxtjs/mdc > …"
//      — @nuxtjs/mdc (pulled in transitively by @nuxt/content) declares
//      its own remark/rehype/unified sub-deps in its Vite optimizeDeps
//      manifest. Under pnpm's strict hoist, those sub-deps live deep
//      in the workspace store; Vite's resolver (rooted at apps/site)
//      can't reach them via the `parent > child` traversal because
//      @nuxtjs/mdc itself isn't surfaced at apps/site/node_modules.
//      The warning is harmless — Nuxt's own machinery re-resolves the
//      deps through @nuxt/content's pipeline at module-load time —
//      and listing the entries explicitly in our config doesn't help
//      (they'd just add their own unresolvable copies). Filtered
//      narrowly to the @nuxtjs/mdc prefix.
function isFilteredBuildWarning(msg: string): boolean {
  if (msg.includes('Sourcemap is likely to be incorrect')) return true
  if (
    msg.includes("doesn't exist at build time") &&
    /\bassets\/(editor|vue)\.worker-[A-Za-z0-9_-]+\.js\b/.test(msg)
  ) {
    return true
  }
  if (msg.includes('Unresolvable optimizeDeps.include entries') && msg.includes('@nuxtjs/mdc')) {
    return true
  }
  return false
}

// Wrap @nuxt/kit's Consola logger at config-evaluation time so the
// Nuxt vite-builder's "Unresolvable optimizeDeps.include entries"
// warning (emitted via `logger.warn(...)` from inside the optimizer
// poll) flows through our filter. The Vite-side `customLogger` wrap
// further down doesn't catch this — vite-builder constructs a fresh
// Vite logger AND also calls into the kit Consola directly for the
// optimize-deps callback, so we need both layers.
{
  const origWarn = nuxtKitLogger.warn.bind(nuxtKitLogger)
  nuxtKitLogger.warn = ((...args: unknown[]) => {
    const head = args[0]
    if (typeof head === 'string' && isFilteredBuildWarning(head)) return
    return origWarn(...(args as [unknown, ...unknown[]]))
  }) as typeof nuxtKitLogger.warn
}

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
    // Pure SSG. The `static` preset tells Nitro to emit only
    // prerendered HTML + assets — no serverless runtime, no Node
    // server. Vercel deploys the result as a CDN-only site (zero
    // serverless function quota used). Same effect as `nuxi
    // generate`; declaring it here means `nuxi build`, `nuxi
    // generate`, and Vercel's auto-detected build path all produce
    // the same static output.
    //
    // The Pagefind step (`pnpm index:search` after build) walks
    // `.output/public` for HTML files; without prerendering the
    // directory holds only assets and `_payload.json`, and
    // Pagefind exits with "did not find any html files." With the
    // static preset, every reachable route lands as HTML.
    //
    // `crawlLinks: true` follows internal `<a href>` and NuxtLink
    // targets from the seed routes, so we only have to list the
    // entry points. `/docs` is the index page that links into every
    // doc; `/play` and `/` round out the rest of the public
    // surface.
    //
    // `failOnError: true` gates the build on prerender errors. A 500
    // on any prerendered route (e.g. a Vue mustache leaking through
    // a markdown code fence and binding to an undefined variable —
    // see the post-mortem on the {{{ payload }}} ssr-hydration bug)
    // exits the build non-zero so CI can red-flag it. The trade-off:
    // typo'd internal links (a `[label](does-not-exist.md)` whose
    // target the crawler can't render) ALSO fail the build — but
    // those are real bugs too, and catching them in CI beats finding
    // them in production from a user filing an issue.
    preset: 'static',
    prerender: {
      crawlLinks: true,
      routes: ['/', '/docs', '/play'],
      failOnError: true,
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
    build: {
      // Production sourcemaps are pure overhead for a docs site —
      // every chunk would ship a .map sidecar, and several plugins
      // in the build chain (Tailwind v4's vite plugin, the
      // module-preload-polyfill) don't emit accurate maps anyway.
      sourcemap: false,
      // The @vue/repl Monaco preset bundles Monaco + the Vue/TS
      // language services into one chunk weighing ~5.4 MB minified
      // (~1.3 MB gzipped). Vite's default 500 KB threshold flags it
      // every build with no actionable remediation — the chunk is
      // already dynamically loaded behind `<DemoReplEditor>` (a
      // `.client.vue` component) so it never blocks first paint, and
      // splitting it further isn't possible without forking
      // @vue/repl. Bumping the threshold to 6000 (6 MB) silences
      // the existing warning while still catching any unrelated
      // chunk that grows past Monaco's size.
      chunkSizeWarningLimit: 6000,
    },
  },
  hooks: {
    // Strip the Shiki/Twoslash transformers from public runtimeConfig
    // before Nitro's serializer runs. @nuxt/content copies the whole
    // `content.build.markdown.highlight` block into
    // `runtimeConfig.public.mdc` so client-side MDC rendering can
    // read it — but the Twoslash transformer carries function
    // callbacks (`preprocess`, `tokens`, `pre`, `code`) that don't
    // survive JSON serialization, producing "may not be able to be
    // serialized" warnings during build. Build-time markdown parsing
    // reads transformers directly from `nuxt.options.content` (not
    // from runtimeConfig), so removing them here is harmless — the
    // functions only run during prerender anyway.
    'nitro:config'(nitroConfig) {
      const mdc = (nitroConfig.runtimeConfig as { public?: { mdc?: unknown } } | undefined)?.public
        ?.mdc as { highlight?: { transformers?: unknown[] } } | undefined
      if (mdc?.highlight?.transformers) {
        delete mdc.highlight.transformers
      }

      // Allow `.d.ts` / `.d.cts` / `.d.mts` files in public/ to ship
      // in the static output. Nuxt's `@nuxt/schema` ships
      // `**/*.d.{cts,mts,ts}` in the default `ignore` array on the
      // assumption that declaration files aren't meant for the
      // browser; Nitro inherits this and applies it to the
      // public-assets globby pass, stripping our REPL type bundles
      // from `.output/public/lib/types/`. Without those files, Volar
      // (via @vue/repl's `pkgFileTextUrl` callback) 404s on
      // `attaform`/`attaform/zod`/`vue`/`zod` declaration fetches and
      // intellisense degrades to "any" in production.
      //
      // We strip the .d.ts ignore pattern from Nitro's options only.
      // Nuxt's own component / layout scanners read from
      // `nuxt.options.ignore` directly (not `nitroConfig.ignore`), so
      // their behaviour is unaffected — they keep skipping ambient
      // `.d.ts` files outside `public/` exactly as before.
      const declRe = /\bd\.\{?(cts|mts|ts|c|m)/
      if (Array.isArray(nitroConfig.ignore)) {
        nitroConfig.ignore = nitroConfig.ignore.filter(
          (p): p is string => typeof p === 'string' && !declRe.test(p)
        )
      }
    },
    // Wrap Vite's logger to filter the two warning families documented
    // at the top of the file. Nuxt's vite-builder installs its own
    // `customLogger` (which forwards to Consola); user-supplied
    // `vite.customLogger` gets clobbered during the Nuxt config
    // merge. By the time `vite:configResolved` fires, Nuxt's logger
    // is on the resolved config as `customLogger` — wrap its `warn` /
    // `warnOnce` in place so every Vite-emitted warning passes
    // through our filter before reaching Consola. Fires twice (once
    // per Vite build: client + server); both loggers get wrapped.
    'vite:configResolved'(config) {
      const lg = (config as { customLogger?: Logger }).customLogger
      if (!lg) return
      const origWarn = lg.warn.bind(lg)
      const origWarnOnce = lg.warnOnce.bind(lg)
      lg.warn = (msg: string, opts?: LogOptions) => {
        if (isFilteredBuildWarning(msg)) return
        origWarn(msg, opts)
      }
      lg.warnOnce = (msg: string, opts?: LogOptions) => {
        if (isFilteredBuildWarning(msg)) return
        origWarnOnce(msg, opts)
      }
    },
  },
  css: ['@shikijs/twoslash/style-rich.css', '~/assets/css/tailwind.css'],
})
