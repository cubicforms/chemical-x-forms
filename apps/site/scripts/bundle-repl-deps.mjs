import esbuild from 'esbuild'
import { rollup } from 'rollup'
import dts from 'rollup-plugin-dts'
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
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
const runtimeDomDts = resolve(
  repoRoot,
  `node_modules/.pnpm/@vue+runtime-dom@${vuePkg.version}/node_modules/@vue/runtime-dom/dist/runtime-dom.d.ts`
)

await mkdir(outDir, { recursive: true })
await mkdir(typesDir, { recursive: true })

const watch = process.argv.includes('--watch')

const sharedEsbuildOpts = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: 'linked',
  outdir: outDir,
}

const ctxs = await Promise.all([
  // attaform core — externalize vue + zod (loaded separately via import map)
  esbuild.context({
    ...sharedEsbuildOpts,
    entryPoints: { attaform: resolve(repoRoot, 'src/index.ts') },
    external: ['vue', 'zod'],
  }),
  // attaform/zod adapter — also externalize attaform itself so the import
  // map cross-resolves to the core bundle (single registry instance)
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
const workerEntries = await readdir(replAssetsDir)
for (const entry of workerEntries) {
  if (entry.startsWith('editor.worker')) {
    await copyFile(resolve(replAssetsDir, entry), resolve(workerOutDir, 'editor.worker.js'))
  } else if (entry.startsWith('vue.worker')) {
    await copyFile(resolve(replAssetsDir, entry), resolve(workerOutDir, 'vue.worker.js'))
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
    version: '0.14.0-rc.0',
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
    version: '3.5.0',
    types: './index.d.ts',
    main: './index.js',
  },
  zod: {
    name: 'zod',
    version: '4.4.2',
    types: './index.d.ts',
    main: './index.js',
  },
}

async function emitTypeBundles() {
  await Promise.all([
    mkdir(resolve(typesDir, 'attaform'), { recursive: true }),
    mkdir(resolve(typesDir, 'vue'), { recursive: true }),
    mkdir(resolve(typesDir, 'zod'), { recursive: true }),
  ])
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
  ])
}

await emitTypeBundles()

if (watch) {
  await Promise.all(ctxs.map((c) => c.watch()))
  // esbuild's watch is incremental and fast; rolling up .d.ts costs
  // a few hundred ms per package, so we trigger a full type-rebuild
  // at fixed intervals only when src/ changes. We piggyback on
  // esbuild's rebuild via the `onRebuild`-style hook implemented as
  // a watch plugin below — but for simplicity in a small dev script,
  // re-emit types whenever this script is re-run (host saves trigger
  // the docker volume sync, the watch process picks them up).
  console.log('[bundle-repl-deps] watching src/ for runtime + type changes')
} else {
  await Promise.all(ctxs.map((c) => c.dispose()))
  console.log('[bundle-repl-deps] bundled to public/lib/ (runtime + types)')
}
