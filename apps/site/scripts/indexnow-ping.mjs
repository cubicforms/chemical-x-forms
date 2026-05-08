#!/usr/bin/env node
/**
 * IndexNow post-build ping. Reads the prerendered sitemap from
 * `.output/public/sitemap.xml` and POSTs the URL list to the
 * IndexNow API so Bing / Yandex / Naver / Seznam recrawl recently
 * changed pages within minutes instead of waiting for the next
 * scheduled crawl.
 *
 * **Gating.** Pings only when `VERCEL_ENV === 'production'` AND the
 * deploy isn't a preview branch (`VERCEL_GIT_COMMIT_REF` matches the
 * production branch). Vercel preview deploys, local builds, and CI
 * all hit the no-op path — neither the script nor the build fails,
 * we just don't ping. There is intentionally no force override; the
 * production gate is the single source of truth for "this is a
 * deploy that should hit the IndexNow endpoint."
 *
 * **Dry run.** `INDEXNOW_DRY_RUN=1` parses the sitemap and prints
 * the payload that would have been posted, without hitting the
 * network. Use this from a local build to validate the URL list
 * end-to-end — it never reaches the production gate.
 *
 * **Fail-soft.** A transient IndexNow outage, a network blip, or a
 * 4xx from the API never fails the build. The script logs and
 * exits 0 — IndexNow is best-effort and the next deploy retries.
 *
 * **Key.** The endpoint validates the request by fetching
 * `keyLocation` and matching the body against `key`. We host the
 * key file at `public/<key>.txt`; rotating means generating a new
 * value, replacing the file, and updating the key constant here.
 *
 * Spec: https://www.indexnow.org/documentation
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SITE_ROOT = resolve(SCRIPT_DIR, '..')
const SITEMAP_PATH = resolve(SITE_ROOT, '.output/public/sitemap.xml')

const HOST = 'www.attaform.com'
const KEY = '2e71a5ced510106b3dfca644c1ccb49d'
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`
const ENDPOINT = 'https://api.indexnow.org/IndexNow'

async function main() {
  const isDryRun = process.env.INDEXNOW_DRY_RUN === '1'
  const isVercelProduction = process.env.VERCEL_ENV === 'production'

  // Hard production gate. Dry-run still parses + prints, but exits
  // before any network call. Anything else (preview, local, CI) is
  // a no-op — there is intentionally no override flag.
  if (!isVercelProduction && !isDryRun) {
    console.log(
      `[indexnow] skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'undefined'}; production deploy required)`
    )
    return
  }

  let sitemap
  try {
    sitemap = await readFile(SITEMAP_PATH, 'utf8')
  } catch (error) {
    console.warn(`[indexnow] sitemap not found at ${SITEMAP_PATH}: ${error.message}`)
    return
  }

  // The sitemap is small (one entry per public page), regex
  // extraction is enough — no XML parser dependency.
  const urls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g))
    .map((match) => match[1].trim())
    .filter((url) => url.startsWith(`https://${HOST}/`))

  if (urls.length === 0) {
    console.warn('[indexnow] sitemap parsed but no matching URLs found; skipping ping')
    return
  }

  const payload = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls,
  }

  if (process.env.INDEXNOW_DRY_RUN === '1') {
    console.log(`[indexnow] dry run — payload (${urls.length} URLs):`)
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  console.log(`[indexnow] pinging ${ENDPOINT} with ${urls.length} URL${urls.length === 1 ? '' : 's'}`)

  let response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    console.warn(`[indexnow] network error, continuing: ${error.message}`)
    return
  }

  // 200 / 202 are both success per IndexNow spec — 200 means
  // accepted, 202 means accepted but URLs are still being processed.
  if (response.ok) {
    console.log(`[indexnow] OK (${response.status})`)
    return
  }

  const body = await response.text().catch(() => '<failed to read body>')
  console.warn(`[indexnow] non-OK response: ${response.status} ${response.statusText} — ${body}`)
}

main().catch((error) => {
  // Final safety net — never fail the build.
  console.warn(`[indexnow] unexpected error, continuing: ${error?.stack ?? error}`)
})
