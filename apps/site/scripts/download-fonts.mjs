#!/usr/bin/env node
/**
 * One-shot fetcher for the WOFF2 files we self-host.
 *
 * Pulls the latest @font-face declarations from Google Fonts (using a
 * Chrome User-Agent so the response is the modern WOFF2 + per-subset
 * variant, not a single TTF), parses out the (family, weight, subset)
 * triples we want to keep, downloads each WOFF2 to
 * `apps/site/public/fonts/`, and writes a sibling `fonts.css` with
 * the matching @font-face block (re-pointing src URLs at our own
 * `/fonts/<file>`).
 *
 * Run on demand — when bumping a weight, adding a subset, or
 * upgrading the upstream font version. The output (woff2 binaries +
 * fonts.css) is committed; the dev server and the build pipeline
 * never reach Google again.
 *
 * Why not let `@nuxt/fonts` do this at build time:
 *   - The dev-time proxy in @nuxt/fonts opens a real fetch to
 *     fonts.gstatic.com on every dev start. A Google CDN hiccup
 *     500s the dev server (the page renderer can't resolve fonts).
 *   - Build-time fetching has the same single-point-of-failure: a
 *     bad CI run on a busy day fails the deploy with a network
 *     timeout buried in the build log.
 *   - Self-hosting (this script's output) breaks the dependency
 *     entirely. Dev and build both read from the committed files.
 *
 * Subsets we keep: `latin`, `latin-ext`. Matches the previous
 * `defaults: { subsets: [...] }` configuration. Other subsets
 * (cyrillic, greek, vietnamese) are filtered out — the site is
 * English-only, those bytes were dead weight.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fontsDir = resolve(here, '../public/fonts')
const cssOutPath = resolve(here, '../assets/css/fonts.css')

// Each (family, weights) pair maps to one Google Fonts CSS API call.
// Splitting per-family keeps the parser simpler — each response only
// references one family, so we don't have to disambiguate which
// `@font-face` block belongs where.
const FAMILIES = [
  { name: 'Inter', weights: [400, 500, 600, 700] },
  { name: 'JetBrains Mono', weights: [400, 500, 600] },
]

// Same set @nuxt/fonts had configured. Subsets outside this list
// (cyrillic, greek, vietnamese) are dropped at parse time.
const KEEP_SUBSETS = new Set(['latin', 'latin-ext'])

// Modern Chrome UA — without it, Google returns a single legacy
// TTF per weight (no WOFF2, no subset variants). The exact UA
// doesn't matter as long as it advertises Chrome ≥ 60-ish.
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function googleFontsCssUrl(family, weights) {
  const familyPart = `${family.replace(/\s+/g, '+')}:wght@${weights.join(';')}`
  return `https://fonts.googleapis.com/css2?family=${familyPart}&display=swap`
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': CHROME_UA } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return res.text()
}

async function fetchBinary(url) {
  const res = await fetch(url, { headers: { 'User-Agent': CHROME_UA } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Parse Google Fonts CSS. Each `@font-face` block is preceded by a
 * `/* <subset> *​/` comment that we use to discriminate; per-block
 * src/weight/unicode-range come out of the body.
 *
 * Returns one record per @font-face block:
 *   { family, weight, subset, url, unicodeRange }
 */
function parseGoogleFontsCss(css) {
  const records = []
  // Split on the leading comment so we can read the subset label.
  // Each chunk starts with the subset name and contains exactly one
  // @font-face block (or starts before the first one, which yields
  // an empty parse — guarded below).
  const chunks = css.split(/\/\*\s*([\w-]+)\s*\*\//).slice(1)
  // After split: [subset0, css0, subset1, css1, ...]
  for (let i = 0; i < chunks.length; i += 2) {
    const subset = chunks[i]
    const block = chunks[i + 1]
    if (subset === undefined || block === undefined) continue

    const family = /font-family:\s*'([^']+)'/.exec(block)?.[1]
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1])
    const url = /src:\s*url\(([^)]+)\)/.exec(block)?.[1]
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim()
    if (!family || !weight || !url || !unicodeRange) continue
    records.push({ family, weight, subset, url, unicodeRange })
  }
  return records
}

function localFilename({ family, weight, subset }) {
  // `Inter-400-latin.woff2`, `JetBrains-Mono-500-latin-ext.woff2`.
  // Hyphens in the family name are preserved (JetBrains Mono → JetBrains-Mono),
  // which keeps the suffix split unambiguous (`-<weight>-<subset>`).
  const slug = family.replace(/\s+/g, '-')
  return `${slug}-${weight}-${subset}.woff2`
}

function emitFontFace({ family, weight, subset, unicodeRange }) {
  return [
    `/* ${subset} */`,
    `@font-face {`,
    `  font-family: '${family}';`,
    `  font-style: normal;`,
    `  font-weight: ${weight};`,
    `  font-display: swap;`,
    `  src: url(/fonts/${localFilename({ family, weight, subset })}) format('woff2');`,
    `  unicode-range: ${unicodeRange};`,
    `}`,
  ].join('\n')
}

async function main() {
  await mkdir(fontsDir, { recursive: true })

  const allRecords = []
  for (const { name, weights } of FAMILIES) {
    const cssUrl = googleFontsCssUrl(name, weights)
    console.log(`[fonts] fetching CSS for ${name}`)
    const css = await fetchText(cssUrl)
    const parsed = parseGoogleFontsCss(css)
    const filtered = parsed.filter((r) => KEEP_SUBSETS.has(r.subset))
    if (filtered.length === 0) {
      throw new Error(
        `[fonts] no kept subsets for ${name} — Google may have served a stripped CSS. ` +
          `Re-check the User-Agent and the subset filter.`
      )
    }
    allRecords.push(...filtered)
  }

  // Download each WOFF2 in parallel — the binaries are independent
  // and Google's CDN handles concurrent requests well. Errors fail
  // the script (Promise.all rejects on first reject).
  await Promise.all(
    allRecords.map(async (r) => {
      const filename = localFilename(r)
      console.log(`[fonts] ${filename}`)
      const bytes = await fetchBinary(r.url)
      await writeFile(resolve(fontsDir, filename), bytes)
    })
  )

  // Emit `fonts.css` with all the @font-face blocks. Lives in
  // `assets/css/` (not `public/fonts/` next to the binaries) so
  // tailwind.css can `@import './fonts.css'` and inline the rules
  // into the main bundle — one stylesheet request instead of two.
  // The .woff2 binaries stay in `public/fonts/` (served as static
  // assets) and the @font-face src URLs reference them as
  // `/fonts/<file>.woff2`.
  const header = [
    '/* Auto-generated by apps/site/scripts/download-fonts.mjs.',
    ' * Re-run on demand when adding/removing weights or upgrading',
    ' * the upstream font version. The .woff2 binaries that these',
    ' * @font-face rules point at live in apps/site/public/fonts/.',
    ' */',
    '',
  ].join('\n')
  const body = allRecords.map(emitFontFace).join('\n\n')
  await mkdir(dirname(cssOutPath), { recursive: true })
  await writeFile(cssOutPath, header + body + '\n')

  console.log(
    `[fonts] wrote ${allRecords.length} woff2 to ${fontsDir} + fonts.css to ${cssOutPath}`
  )
}

main().catch((error) => {
  console.error('[fonts] failed:', error?.stack ?? error)
  process.exit(1)
})
