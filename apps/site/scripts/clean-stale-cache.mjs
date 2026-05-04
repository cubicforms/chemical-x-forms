/**
 * Clear stale Nitro payload caches before `nuxi dev` boots.
 *
 * Background: `nuxi build` writes `.nuxt/cache/nuxt/payload` as a
 * single file (a consolidated build-time payload), while `nuxi dev`'s
 * renderer expects `.nuxt/cache/nuxt/payload/<hash>` — i.e., `payload`
 * as a directory. If the user runs `pnpm build:site` and then
 * `pnpm dev` (common during local verification), Nitro's setItem call
 * fails with `ENOTDIR: not a directory` and the dev renderer surfaces
 * unhandled errors on every request that tries to write a payload
 * cache entry (`/_payload.json`, `/<route>/_payload.json`).
 *
 * Fix: remove the `payload` file at dev start. Nitro will recreate
 * the directory on first write. Cheap, idempotent, no-op if the path
 * is already a directory or absent.
 */
import { stat, rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const stalePath = resolve(here, '../.nuxt/cache/nuxt/payload')

try {
  const s = await stat(stalePath)
  if (s.isFile()) {
    await rm(stalePath)
    console.log('[clean-stale-cache] removed stale build payload cache')
  }
} catch (err) {
  // ENOENT (path absent) is the happy path for a fresh checkout.
  // Surface anything else so a real permission/IO bug doesn't hide.
  if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
    console.warn('[clean-stale-cache]', err)
  }
}
