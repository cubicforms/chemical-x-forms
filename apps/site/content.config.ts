import { defineCollection, defineContentConfig } from '@nuxt/content'
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
    }),
  },
})
