import esbuild from 'esbuild'
import { rollup } from 'rollup'
import dts from 'rollup-plugin-dts'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Self-host every dep that the in-page REPL imports, so the docs site
// has zero third-party CDN dependencies. Outputs land under
// apps/site/public/lib/ and are referenced by DemoRepl's import map.
//
// Two parallel pipelines, both watch-aware:
//
// 1. Runtime JS (esbuild) — bundles attaform + attaform/zod from src/
//    plus a fresh zod, and copies vue's prebuilt browser ESM. These
//    are what the REPL preview iframe actually executes. We bundle
//    attaform from src/ (not dist/) because dist/ in dev is jiti-
//    shimmed for Node consumers — those shims don't run in the
//    browser. esbuild handles TS natively, so source bundling is fast
//    and produces a real browser ESM.
//
// 2. Type bundles (rollup-plugin-dts) — single-file `.d.ts` per
//    package, served from `/lib/types/<pkg>/index.d.ts` and consumed
//    by the Monaco editor's Volar language service via @vue/repl's
//    `pkgFileTextUrl` hook. Bundling means the LSP fetches one file
//    per package instead of crawling 88 files for zod alone.

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const outDir = resolve(here, '../public/lib')
const typesDir = resolve(outDir, 'types')

// Resolve `@vue/runtime-dom`'s real on-disk path independent of the
// pnpm-store hash. Vue's published `dist/vue.d.ts` is a 7-line wrapper
// that re-exports from `@vue/runtime-dom`; bundling from that wrapper
// through pnpm's symlinked node_modules confuses the dts resolver
// (the @vue/runtime-dom symlink points outside vue's own store, and
// `respectExternal` won't follow it).
//
// Approach: read vue's own package.json (resolvable via createRequire)
// to find vue's version, then construct the pnpm-store path. pnpm
// installs each peer-dep variant under
// `.pnpm/@vue+runtime-dom@<vueVersion>/node_modules/@vue/runtime-dom`,
// so the version matches lockstep.
const requireFromHere = createRequire(import.meta.url)
const vuePkg = requireFromHere('vue/package.json')
const zodPkg = requireFromHere('zod/package.json')
// `zod-v3` is an npm-aliased package: pnpm installs zod@3.x under the
// directory name `zod-v3` so v3 and v4 can coexist. The package.json's
// own `name` field still says "zod", but `requireFromHere('zod-v3/...')`
// resolves to the v3 install via the alias.
const zodV3Pkg = requireFromHere('zod-v3/package.json')
// attaform's package.json sits at the monorepo root, not in
// node_modules — resolve it by absolute path so we don't rely on a
// hoisting layout that the workspace might restructure later.
const attaformPkg = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'))
const runtimeDomDts = resolve(
  repoRoot,
  `node_modules/.pnpm/@vue+runtime-dom@${vuePkg.version}/node_modules/@vue/runtime-dom/dist/runtime-dom.d.ts`
)

await mkdir(outDir, { recursive: true })
await mkdir(typesDir, { recursive: true })

const watch = process.argv.includes('--watch')

// `tsconfig` is set explicitly to the workspace-root config. Without
// this, esbuild auto-discovers `apps/site/tsconfig.json` (the cwd this
// script runs in), which extends `./.nuxt/tsconfig.json` — and `.nuxt/`
// hasn't been generated yet at this point in the build pipeline
// (bundle:repl runs BEFORE nuxi build). The auto-discovery path then
// emits "Cannot find base config file './.nuxt/tsconfig.json'" three
// times per build. Pointing at the library's own tsconfig sidesteps
// the unresolved extends and gives esbuild the right `paths` aliases
// for `attaform` / `attaform/zod` resolution against `src/`.
const sharedEsbuildOpts = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: 'linked',
  outdir: outDir,
  tsconfig: resolve(repoRoot, 'tsconfig.json'),
}

// Triggers an attaform .d.ts re-emit after every esbuild rebuild
// (post-initial). esbuild's watch mode keeps the runtime JS bundles
// fresh; without this hook the rolled-up declaration bundles would
// stay stuck at whatever shape src/ had when the script started, so
// the REPL's Volar serves stale types until the dev server is
// manually restarted. Fire-and-forget — we don't want a slow
// rollup-plugin-dts pass to stall esbuild's pipeline.
function attaformTypeWatchPlugin() {
  let initial = true
  return {
    name: 'attaform-type-watch',
    setup(build) {
      build.onEnd(() => {
        if (!watch) return
        if (initial) {
          initial = false
          return
        }
        emitAttaformTypeBundles()
          .then(() => console.log('[bundle-repl-deps] attaform .d.ts re-emitted'))
          .catch((err) => {
            console.error('[bundle-repl-deps] attaform .d.ts re-emit failed:', err)
          })
      })
    },
  }
}

const ctxs = await Promise.all([
  // attaform core — externalize vue + zod (loaded separately via import map)
  esbuild.context({
    ...sharedEsbuildOpts,
    entryPoints: { attaform: resolve(repoRoot, 'src/index.ts') },
    external: ['vue', 'zod'],
    plugins: [attaformTypeWatchPlugin()],
  }),
  // attaform/zod adapter — also externalize attaform itself so the import
  // map cross-resolves to the core bundle (single registry instance).
  // Only the core context owns the type-re-emit hook — both attaform
  // entries are bundled in a single emitAttaformTypeBundles() call,
  // so duplicating the trigger here would just double the work.
  esbuild.context({
    ...sharedEsbuildOpts,
    entryPoints: { 'attaform-zod': resolve(repoRoot, 'src/zod.ts') },
    external: ['vue', 'zod', 'attaform'],
  }),
  // zod v4 — bundled fresh because zod's subpath exports defeat raw copy
  esbuild.context({
    ...sharedEsbuildOpts,
    entryPoints: { zod: resolve(repoRoot, 'node_modules/zod/index.js') },
  }),
])

await Promise.all(ctxs.map((c) => c.rebuild()))

// Vue ships a ready-to-go browser ESM — copy it verbatim
await copyFile(
  resolve(repoRoot, 'node_modules/vue/dist/vue.esm-browser.prod.js'),
  resolve(outDir, 'vue.esm-browser.prod.js')
)

// ─── REPL worker assets ────────────────────────────────────────────
//
// @vue/repl's Monaco preset spawns workers via
// `new Worker(new URL("assets/<chunk>.js", import.meta.url), { type: 'module' })`.
// In dev, Vite serves those worker chunks but injects its `@vite/client`
// HMR bootstrap into them — and `@vite/client`'s module-level WebSocket
// setup fails to handshake from a worker context, killing the worker
// at startup ("Could not create web worker(s)" + "Uncaught Event …
// target: Worker"). Monaco then falls back to running the language
// service on the main thread, freezing the UI.
//
// Workaround: copy the worker chunks to `public/lib/repl-workers/`
// where Nitro's static file server emits them as-is (no Vite touch).
// DemoRepl overrides `self.MonacoEnvironment.getWorker` to construct
// workers from these clean URLs, sidestepping both the @vite/client
// injection and the path-fragility of `import.meta.url` in dev.
//
// Filenames are renamed to stable names — `editor.worker.js` and
// `vue.worker.js` — so DemoRepl doesn't have to track @vue/repl's
// content-hash names. The hash will rotate when @vue/repl publishes
// new versions; we just keep walking the assets/ directory by glob.
const workerOutDir = resolve(outDir, 'repl-workers')
await mkdir(workerOutDir, { recursive: true })
const replAssetsDir = resolve(
  repoRoot,
  `node_modules/.pnpm/@vue+repl@4.7.2/node_modules/@vue/repl/dist/assets`
)
// Volar's web build emits two `console.warn` notices on startup:
//   [service-emmet] this module is not yet supported for web.
//   [volar-service-pug] this module is not yet supported for web.
// They're advisory-only — neither service is meaningful in our REPL
// (no Emmet expansion, no Pug compile path) — and they pollute every
// page load with two yellow rows. Worker console output isn't
// reachable from the main thread, so we patch each worker at copy
// time: prepend a tiny `console.warn` shim that swallows messages
// containing the shared "not yet supported for web" phrase.
const SUPPRESS_PRELUDE =
  ';(function(){var w=console.warn;' +
  'console.warn=function(){' +
  'var a=arguments[0];' +
  'if(typeof a==="string"&&a.indexOf("not yet supported for web")!==-1)return;' +
  'return w.apply(console,arguments)' +
  '};})();\n'
async function copyWorkerWithSuppressedWarnings(srcPath, destPath) {
  const original = await readFile(srcPath, 'utf8')
  await writeFile(destPath, SUPPRESS_PRELUDE + original)
}
const workerEntries = await readdir(replAssetsDir)
for (const entry of workerEntries) {
  if (entry.startsWith('editor.worker')) {
    await copyWorkerWithSuppressedWarnings(
      resolve(replAssetsDir, entry),
      resolve(workerOutDir, 'editor.worker.js')
    )
  } else if (entry.startsWith('vue.worker')) {
    await copyWorkerWithSuppressedWarnings(
      resolve(replAssetsDir, entry),
      resolve(workerOutDir, 'vue.worker.js')
    )
  }
}

// ─── Type bundles (.d.ts) ──────────────────────────────────────────
//
// Each `bundleDts` call rolls up an entry's whole declaration graph
// into a single self-contained `.d.ts`. Volar (via @vue/repl) fetches
// these on demand when the user hovers / autocompletes — providing
// just one file per package means the LSP doesn't have to walk a tree
// of 88 zod declaration files at type-check time.
//
// `respectExternal` per-package: rollup-plugin-dts treats an import
// as "external" when it's bare-name (e.g., `import { Ref } from 'vue'`).
//
//   - For `attaform`/`attaform/zod`: keep vue + zod imports external.
//     We ship vue/zod separately, and inlining would create duplicate
//     `Ref` symbols (attaform-internal vs. vue-public) that the LSP
//     reports as incompatible.
//   - For `vue`/`zod`: inline external refs (@vue/runtime-dom,
//     @standard-schema/spec, etc.). We don't ship those separately,
//     so unresolved bare imports would surface as "Cannot find module"
//     errors in the editor.
//
// `tsconfig: false` keeps rollup-plugin-dts from inheriting the lib's
// strict `noImplicitAny` etc. — those rules don't apply when bundling
// already-emitted .d.ts (and they reject some patterns that are valid
// in declaration files).

async function bundleDts({ input, output, name, respectExternal = false, includeExternal = [] }) {
  const bundle = await rollup({
    input,
    plugins: [
      dts({
        respectExternal,
        // includeExternal: explicit allowlist of bare-name packages to
        // recursively pull into the bundle. Used for vue + zod where
        // we want the deep tree (`@vue/runtime-dom`, `@vue/runtime-core`,
        // zod's internal `./v4/...` path imports etc.) inlined into a
        // single self-contained file. attaform's own bundle leaves
        // these as externals — the LSP resolves them via separate
        // type bundles.
        includeExternal,
        tsconfig: false,
      }),
    ],
    onwarn: (warning) => {
      // Silence benign warnings: UNRESOLVED_IMPORT for type-only
      // externals we deliberately keep external (vue, zod from
      // attaform); CIRCULAR_DEPENDENCY from runtime-core's typed
      // back-references. Anything else we surface so a real type
      // resolution failure is visible.
      if (warning.code === 'UNRESOLVED_IMPORT') return
      if (warning.code === 'CIRCULAR_DEPENDENCY') return
      console.warn(`[bundle-repl-deps:dts:${name}]`, warning.message)
    },
  })
  await bundle.write({ file: output, format: 'es' })
  await bundle.close()
}

// Each package gets a virtual install at /lib/types/<pkg>/. The
// minimal package.json carries only the fields Volar's language
// service reads: name, version, types entry, main entry, and (for
// attaform) the `exports` map that resolves the `attaform/zod`
// subpath.
//
// We don't read these package.json values from the real lockfile —
// the REPL pins to the bundled-at-build-time version, and version
// drift in the type bundle is its own follow-up problem.
//
// Two non-obvious points about the manifest shape:
//
//   1. `exports` entries declare BOTH `types` and a runtime condition
//      (`import`). The @vue/repl Monaco preset uses TypeScript with
//      `moduleResolution: "Bundler"`, which under `exports` requires
//      a runtime resolution to consider the subpath valid — `types`
//      alone produces `Cannot find module 'attaform/zod'` (ts(2307))
//      even though the .d.ts is right there. We point `import` at a
//      stub `.js` (written below) just to satisfy the existence check;
//      the actual runtime code resolves through the iframe import map.
//
//   2. `typesVersions` is kept as belt-and-braces for resolvers that
//      run in legacy 'node' mode and ignore `exports` outright.
const packageManifests = {
  attaform: {
    name: 'attaform',
    version: attaformPkg.version,
    types: './index.d.ts',
    main: './index.js',
    exports: {
      '.': {
        types: './index.d.ts',
        import: './index.js',
      },
      './zod': {
        types: './zod.d.ts',
        import: './zod.js',
      },
    },
    typesVersions: {
      '*': {
        zod: ['./zod.d.ts'],
      },
    },
  },
  vue: {
    name: 'vue',
    version: vuePkg.version,
    types: './index.d.ts',
    main: './index.js',
  },
  zod: {
    name: 'zod',
    version: zodPkg.version,
    types: './index.d.ts',
    main: './index.js',
  },
  // `zod-v3` is consumed by the unified `attaform/zod` entry's type
  // bundle (the V3 overload references `z as zV3 from 'zod-v3'`).
  // Volar's LSP resolves that bare import against the package manifest
  // here — without this, the LSP falls back to fetching from unpkg
  // (which 404s + CORS-blocks the request, polluting the console).
  // The runtime side doesn't need a `/lib/zod-v3.js` because esbuild
  // inlines zod-v3 into `attaform-zod.js` (no external marker).
  'zod-v3': {
    name: 'zod-v3',
    version: zodV3Pkg.version,
    types: './index.d.ts',
    main: './index.js',
  },
}

// Just attaform's two .d.ts entry points. Re-run on every src/ change
// during watch mode so the REPL's Volar always sees the latest types.
// vue + zod aren't included here because they come from node_modules
// and don't change while the dev server is running.
async function emitAttaformTypeBundles() {
  await mkdir(resolve(typesDir, 'attaform'), { recursive: true })
  await Promise.all([
    bundleDts({
      input: resolve(repoRoot, 'src/index.ts'),
      output: resolve(typesDir, 'attaform/index.d.ts'),
      name: 'attaform',
      // Default respectExternal: false — keep `vue` / `zod` imports as
      // bare imports so the LSP resolves them through our separate
      // type bundles. Inlining would create duplicate `Ref` symbols.
    }),
    bundleDts({
      input: resolve(repoRoot, 'src/zod.ts'),
      output: resolve(typesDir, 'attaform/zod.d.ts'),
      name: 'attaform-zod',
    }),
  ])
}

async function emitTypeBundles() {
  await Promise.all([
    mkdir(resolve(typesDir, 'attaform'), { recursive: true }),
    mkdir(resolve(typesDir, 'vue'), { recursive: true }),
    mkdir(resolve(typesDir, 'zod'), { recursive: true }),
    mkdir(resolve(typesDir, 'zod-v3'), { recursive: true }),
  ])
  await Promise.all([
    emitAttaformTypeBundles(),
    bundleDts({
      input: runtimeDomDts,
      output: resolve(typesDir, 'vue/index.d.ts'),
      name: 'vue',
      respectExternal: true,
    }),
    bundleDts({
      input: resolve(repoRoot, 'node_modules/zod/index.d.ts'),
      output: resolve(typesDir, 'zod/index.d.ts'),
      name: 'zod',
      respectExternal: true,
    }),
    bundleDts({
      // zod-v3's root `index.d.ts` re-exports through an `import * as
      // z` / `export { z }` namespace shape that rollup-plugin-dts
      // chokes on (it emits getter syntax in its namespace fixer that
      // its own parser can't re-parse — UnsupportedSyntaxError). The
      // `v3/external.d.ts` sub-entry has the same surface (everything
      // the public `z` namespace contains) via plain `export *`
      // statements, which bundles cleanly. We then rewrite a fresh
      // `index.d.ts` below that re-exports the bundle as the `z`
      // namespace, matching the consumer-facing shape
      // `import { z } from 'zod-v3'`.
      input: resolve(repoRoot, 'node_modules/zod-v3/v3/external.d.ts'),
      output: resolve(typesDir, 'zod-v3/external.d.ts'),
      name: 'zod-v3',
      respectExternal: true,
    }),
  ])
  await Promise.all(
    Object.entries(packageManifests).map(([pkg, manifest]) =>
      writeFile(
        resolve(typesDir, pkg, 'package.json'),
        JSON.stringify(manifest, null, 2) + '\n'
      )
    )
  )
  // Stub runtime entries. Volar 404s harmlessly when these are missing,
  // but the LSP also performs a "module exists" probe on the `import`
  // path declared in `exports`/`main` before it accepts the package as
  // resolvable. An empty file is enough — the actual code that runs in
  // the preview iframe comes from the `/lib/<pkg>.js` esbuild bundles
  // mapped via the import map, not from these stubs.
  await Promise.all([
    writeFile(resolve(typesDir, 'attaform/index.js'), ''),
    writeFile(resolve(typesDir, 'attaform/zod.js'), ''),
    writeFile(resolve(typesDir, 'vue/index.js'), ''),
    writeFile(resolve(typesDir, 'zod/index.js'), ''),
    writeFile(resolve(typesDir, 'zod-v3/index.js'), ''),
    // zod-v3 root entry: re-exports the bundled v3 surface as both
    // the `z` namespace (matching `import { z } from 'zod-v3'`) and
    // as plain named re-exports (matching `import { ZodObject } from
    // 'zod-v3'`). Mirrors the shape zod-v3's published `index.d.ts`
    // exposes, minus the namespace-fixer syntax that rollup-plugin-dts
    // can't handle (see the bundleDts call above for context).
    writeFile(
      resolve(typesDir, 'zod-v3/index.d.ts'),
      `import * as z from './external'\nexport * from './external'\nexport { z }\nexport default z\n`
    ),
  ])
  // Sidecar `.d.ts` next to each `.js` runtime bundle so Nuxt/IDE
  // tooling (vue-tsc, Volar, vtsls) sees types when resolving an
  // import like `~/public/lib/attaform-zod` from a Vue component
  // file. Without these, the import resolves to the JS bundle alone
  // and TypeScript falls back to JS-inference (which sees the
  // exported function returning a `Proxy({}, …)` and types it as
  // `() => {}`). The shim re-exports from the rolled-up type bundle
  // so both surfaces (in-page Volar and host-side IDE) share one
  // source of truth.
  await Promise.all([
    writeFile(
      resolve(outDir, 'attaform.d.ts'),
      `export * from './types/attaform/index'\n`
    ),
    writeFile(
      resolve(outDir, 'attaform-zod.d.ts'),
      `export * from './types/attaform/zod'\n`
    ),
  ])
  // Directory listing JSON per package, mimicking unpkg's `?meta`
  // endpoint shape: `{ files: [{ path, type }] }`. Volar's worker
  // (`createNpmFileSystem` in @vue/repl's vue.worker) calls our
  // pkgDirUrl callback for *every* file existence check — `_stat`
  // for `<pkg>/<file>` doesn't fetch the file directly, it lists the
  // package directory and looks for the entry by name. Without this
  // listing the LSP can't confirm that `attaform/zod.d.ts` exists,
  // so module resolution returns "Cannot find module" even though
  // the file is right there. Default behaviour is to query
  // unpkg.com — which doesn't have our pre-release `attaform@0.14`,
  // so the listing comes back empty.
  //
  // Volar filters this list against the requested pkgPath (root vs.
  // subdir), so we can serve the same flat list for any pkgPath:
  // entries with leading slash are skipped when pkgPath is non-empty,
  // which is what we want for our flat type bundles.
  const dirMeta = (entries) => ({
    type: 'directory',
    path: '/',
    files: entries.map((e) => ({ type: 'file', path: `/${e}` })),
  })
  await Promise.all([
    writeFile(
      resolve(typesDir, 'attaform/meta.json'),
      JSON.stringify(
        dirMeta(['package.json', 'index.d.ts', 'index.js', 'zod.d.ts', 'zod.js']),
        null,
        2
      )
    ),
    writeFile(
      resolve(typesDir, 'vue/meta.json'),
      JSON.stringify(dirMeta(['package.json', 'index.d.ts', 'index.js']), null, 2)
    ),
    writeFile(
      resolve(typesDir, 'zod/meta.json'),
      JSON.stringify(dirMeta(['package.json', 'index.d.ts', 'index.js']), null, 2)
    ),
    writeFile(
      resolve(typesDir, 'zod-v3/meta.json'),
      JSON.stringify(
        dirMeta(['package.json', 'index.d.ts', 'index.js', 'external.d.ts']),
        null,
        2
      )
    ),
  ])
}

await emitTypeBundles()

if (watch) {
  await Promise.all(ctxs.map((c) => c.watch()))
  // esbuild's watch keeps the runtime JS bundles fresh incrementally;
  // the attaform .d.ts re-emit fires from the `attaform-type-watch`
  // esbuild plugin (above) on each post-initial rebuild. vue + zod
  // type bundles are static — they come from node_modules and only
  // need to rebuild when this script is re-run (e.g. after a deps
  // upgrade).
  console.log('[bundle-repl-deps] watching src/ for runtime + type changes')
} else {
  await Promise.all(ctxs.map((c) => c.dispose()))
  console.log('[bundle-repl-deps] bundled to public/lib/ (runtime + types)')
}
