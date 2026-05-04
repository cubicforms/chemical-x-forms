import esbuild from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Self-host every dep that the in-page REPL imports, so the docs site
// has zero third-party CDN dependencies. Outputs land under
// apps/site/public/lib/ and are referenced by DemoRepl's import map.
//
// We bundle attaform from src/ (not dist/) because dist/ in dev is
// jiti-shimmed for Node consumers — those shims don't run in the
// browser. esbuild handles TS natively, so source bundling is fast
// and produces a real browser ESM.

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const outDir = resolve(here, '../public/lib')

await mkdir(outDir, { recursive: true })

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

if (watch) {
  await Promise.all(ctxs.map((c) => c.watch()))
  console.log('[bundle-repl-deps] watching src/ + zod for changes')
} else {
  await Promise.all(ctxs.map((c) => c.dispose()))
  console.log('[bundle-repl-deps] bundled to public/lib/')
}
