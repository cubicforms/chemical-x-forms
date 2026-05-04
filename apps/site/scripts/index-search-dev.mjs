/**
 * Dev-time Pagefind indexer.
 *
 * Production pipeline (`pnpm build`) runs `pagefind --site .output/public`
 * after `nuxi build`, indexing the rendered HTML for full fidelity.
 * That's slow (a full Nuxt build) and pointless during `nuxi dev` —
 * the dev server isn't statically rendered, no .output/public exists.
 *
 * This script walks `docs/` for raw markdown, lifts the title +
 * heading slugs, runs marked → HTML, and feeds each page to Pagefind's
 * Node API as if it were rendered HTML. Output lands at
 * `apps/site/public/_pagefind/` so Nuxt's dev server serves it as a
 * static asset just like prod. The DocsSearch component then loads
 * `/_pagefind/pagefind.js` and queries normally.
 *
 * Fidelity caveat: anchors point at slugs we generate locally via
 * github-slugger (the same slugger Nuxt Content's MDC parser uses),
 * so heading deep-links match production. Tables / inline MDC
 * components / Twoslash blocks render to plain HTML in the index —
 * search still finds them, the on-page presentation stays Nuxt's.
 */

import { createIndex } from 'pagefind'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked } from 'marked'
import GithubSlugger from 'github-slugger'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const docsRoot = resolve(repoRoot, 'docs')
const outDir = resolve(here, '../public/_pagefind')

async function* walkMarkdown(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkMarkdown(full)
    } else if (entry.name.endsWith('.md')) {
      yield full
    }
  }
}

function stripFrontmatter(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

function extractTitle(content) {
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  if (fm) {
    const titleMatch = fm[1].match(/^title:\s*(.+)$/m)
    if (titleMatch) return titleMatch[1].trim().replace(/^["']|["']$/g, '')
  }
  const h1 = content.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  return 'Documentation'
}

// `/repo/docs/recipes/transforms.md` → `/docs/recipes/transforms`.
// Matches Nuxt Content's `^\d+\.` ordering-prefix strip so dev anchors
// resolve to the same routes the catch-all renders. Without this, a
// search hit on `0.13-to-0.14.md` would point at
// `/docs/migration/0.13-to-0.14`, but Nuxt Content's runtime serves
// it at `/docs/migration/13-to-0.14`.
function fileToUrl(absPath) {
  const rel = absPath.slice(docsRoot.length).replace(/\.md$/, '')
  const segments = rel.split('/').map((s) => s.replace(/^\d+\./, ''))
  return '/docs' + segments.join('/')
}

// Per-page Marked instance with a heading renderer that emits `id`
// attributes via github-slugger — same slugger Nuxt Content's MDC
// pipeline uses, so dev `sub_results` URLs match what the production
// runtime exposes. New instance per page so the slugger resets
// (otherwise every "Setup" heading after the first becomes "setup-1",
// "setup-2", and dev anchors drift further from production each page).
function buildMarked() {
  const slugger = new GithubSlugger()
  const m = new Marked()
  m.use({
    renderer: {
      heading({ tokens, depth }) {
        // Concatenate the inline text from each token. Codespans
        // expose their unwrapped contents on `.text` (e.g.,
        // "attaform/zod" without backticks), which is exactly the
        // input github-slugger needs to match Nuxt Content's slug —
        // "attaform/zod" → "attaformzod" (slashes stripped).
        const text = tokens.map((t) => t.text ?? t.raw ?? '').join('')
        const id = slugger.slug(text)
        return `<h${depth} id="${id}">${escapeHtml(text)}</h${depth}>\n`
      },
    },
  })
  return m
}

async function indexAll() {
  const { index, errors: createErrors } = await createIndex()
  if (createErrors.length) {
    console.error('[index:search:dev] createIndex errors:', createErrors)
    process.exit(1)
  }

  let count = 0
  for await (const file of walkMarkdown(docsRoot)) {
    const raw = await readFile(file, 'utf8')
    const title = extractTitle(raw)
    const url = fileToUrl(file)
    const md = stripFrontmatter(raw)
    const m = buildMarked()
    const html = m.parse(md)
    const wrapped = `<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><main>${html}</main></body></html>`
    const { errors } = await index.addHTMLFile({ url, content: wrapped })
    if (errors.length) {
      console.warn(`[index:search:dev] warnings for ${file}:`, errors)
    }
    count++
  }

  // Also index the docs landing page directly — it's not a markdown
  // file but readers expect /docs to surface in search.
  await index.addCustomRecord({
    url: '/docs',
    content:
      'Documentation home. Getting started, API reference, recipes, troubleshooting, migration, performance.',
    language: 'en',
    meta: { title: 'Documentation' },
  })

  const { errors: writeErrors } = await index.writeFiles({ outputPath: outDir })
  if (writeErrors.length) {
    console.error('[index:search:dev] writeFiles errors:', writeErrors)
    process.exit(1)
  }
  console.log(`[index:search:dev] indexed ${count + 1} pages → ${outDir}`)
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

await indexAll()
