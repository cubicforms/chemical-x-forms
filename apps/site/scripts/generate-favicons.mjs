#!/usr/bin/env node
/**
 * One-shot generator for the raster favicons that browsers and
 * search-engine SERPs expect alongside our SVG mark.
 *
 * Why a script instead of build-time emit:
 *   - The favicons are stable artifacts of `public/favicon.svg`.
 *     They change only when the logo changes, so committing them
 *     keeps every build fast and the repo self-contained.
 *   - Run `node scripts/generate-favicons.mjs` after editing the
 *     SVG; the outputs land in `public/` ready to commit.
 *
 * Why the legacy formats matter even though the SVG link is set:
 *   - Bing's SERP favicon pipeline fetches `/favicon.ico` and won't
 *     fall back to SVG. Without a real ICO, Bing renders the default
 *     globe in search results.
 *   - Older Chromium/Edge/Firefox follow the explicit <link> chain,
 *     but iOS Safari prefers `apple-touch-icon.png` for home-screen
 *     bookmarks regardless of the SVG mark.
 *
 * Output:
 *   - public/favicon.ico            (multi-size: 16, 32, 48 px PNG-in-ICO)
 *   - public/favicon-32.png         (32×32 standalone PNG)
 *   - public/apple-touch-icon.png   (180×180 iOS home-screen icon)
 */

import { readFile, writeFile } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SITE_ROOT = resolve(SCRIPT_DIR, '..')
const PUBLIC_DIR = resolve(SITE_ROOT, 'public')
const SVG_PATH = resolve(PUBLIC_DIR, 'favicon.svg')

async function renderPng(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  })
  return resvg.render().asPng()
}

/**
 * Build a PNG-embedded ICO from one or more PNG buffers.
 * Format: 6-byte ICONDIR + N×16-byte ICONDIRENTRY + concatenated PNG payloads.
 * PNG-in-ICO is supported by every browser made since Vista (2007) and by
 * Bing's favicon fetcher.
 */
function buildIco(images) {
  const HEADER_SIZE = 6
  const ENTRY_SIZE = 16
  const dataOffset = HEADER_SIZE + ENTRY_SIZE * images.length

  const header = Buffer.alloc(HEADER_SIZE)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = ICO
  header.writeUInt16LE(images.length, 4)

  const entries = Buffer.alloc(ENTRY_SIZE * images.length)
  let offset = dataOffset
  images.forEach((img, i) => {
    const base = i * ENTRY_SIZE
    // ICONDIRENTRY width/height of 0 means 256 — we never go that big.
    entries.writeUInt8(img.size === 256 ? 0 : img.size, base + 0)
    entries.writeUInt8(img.size === 256 ? 0 : img.size, base + 1)
    entries.writeUInt8(0, base + 2) // color count (0 for >= 8 bpp)
    entries.writeUInt8(0, base + 3) // reserved
    entries.writeUInt16LE(1, base + 4) // color planes
    entries.writeUInt16LE(32, base + 6) // bits per pixel
    entries.writeUInt32LE(img.data.length, base + 8)
    entries.writeUInt32LE(offset, base + 12)
    offset += img.data.length
  })

  return Buffer.concat([header, entries, ...images.map((img) => img.data)])
}

async function main() {
  const svg = await readFile(SVG_PATH, 'utf8')

  const png16 = await renderPng(svg, 16)
  const png32 = await renderPng(svg, 32)
  const png48 = await renderPng(svg, 48)
  const png180 = await renderPng(svg, 180)

  const ico = buildIco([
    { size: 16, data: png16 },
    { size: 32, data: png32 },
    { size: 48, data: png48 },
  ])

  await writeFile(resolve(PUBLIC_DIR, 'favicon.ico'), ico)
  await writeFile(resolve(PUBLIC_DIR, 'favicon-32.png'), png32)
  await writeFile(resolve(PUBLIC_DIR, 'apple-touch-icon.png'), png180)

  console.log('[favicons] wrote favicon.ico, favicon-32.png, apple-touch-icon.png')
}

main().catch((error) => {
  console.error('[favicons] failed:', error?.stack ?? error)
  process.exit(1)
})
