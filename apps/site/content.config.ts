import { defineCollection, defineContentConfig, z } from '@nuxt/content'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineContentConfig({
  collections: {
    docs: defineCollection({
      type: 'page',
      source: {
        cwd: resolve(here, '../../docs'),
        include: '**/*.md',
        prefix: '/docs',
      },
      // Frontmatter contract for every doc page. The `description`
      // field flows into <meta name="description"> + og:description +
      // twitter:description through the docs/[...slug] page (which
      // reads `page.description` and threads it into useSeoMeta).
      // Empty descriptions ship empty meta tags; Google then
      // auto-generates SERP snippets from page body, often poorly.
      // Keeping the field required (and minimum-length) means the
      // build fails the moment a new doc lands without an SEO blurb,
      // before that empty snippet ever reaches a user.
      //
      // Bounds:
      //   - 80 char min keeps the description from collapsing to a
      //     headline; Google's snippet display starts around 110.
      //   - 200 char max gives a soft cap before truncation. The
      //     classic "160" cutoff is desktop-SERP-only — mobile +
      //     featured snippets show more, and over-budget is just
      //     cosmetic.
      //
      // `title` is optional: by default the page title comes from the
      // markdown H1. Override only when the H1 isn't a great <title>
      // (contains backticks rendered as <code>, em-dashes that look
      // weird in a browser tab, or is too cryptic for a SERP entry).
      schema: z.object({
        title: z.string().optional(),
        description: z
          .string()
          .min(80, 'description must be at least 80 characters for a useful SERP snippet')
          .max(200, 'description over 200 characters will get truncated in most SERPs'),
      }),
    }),
  },
})
