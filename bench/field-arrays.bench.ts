/**
 * Phase 9.10 bench: typed array helpers (`append` / `remove` / `swap`).
 *
 * `keystroke.bench.ts` covers single-leaf mutation on a deep object
 * tree. That's the primary form-interaction hot path, but arrays add
 * their own cost — each helper reads the array via the path-walker,
 * mutates, and writes back through `setValueAtPath`, which routes
 * through diff-apply. Regressions here would ship unnoticed otherwise.
 *
 * No old-vs-new ratio: before the rewrite there were no typed array
 * helpers. We report absolute ops/sec so `pnpm bench` surfaces deltas
 * across commits. `scripts/check-bench.mjs` only gates groups that
 * follow the `old: ... / new: ...` pairing convention, so these
 * benches are informational — a future commit can add a floor once a
 * stable baseline is recorded.
 */
import { bench, describe } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { z } from 'zod'
import { useForm } from '../src/runtime/adapters/zod-v4'
import { createChemicalXForms } from '../src/runtime/core/plugin'

type Post = { title: string; body: string; tags: string[] }
const schema = z.object({
  posts: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
      tags: z.array(z.string()),
    })
  ),
})

function newPost(i: number): Post {
  return { title: `post-${i}`, body: 'x', tags: [] }
}

/**
 * Mount a disposable SSR app so `useForm` can run inside a `setup()`
 * context, then expose the returned form handle to the bench. The
 * captured handle outlives the setup — its closures over `FormStore`
 * are what we're measuring.
 */
function mountAndCaptureForm(seedCount: number) {
  let captured: ReturnType<typeof useForm<typeof schema>> | undefined
  const App = defineComponent({
    setup() {
      captured = useForm({ schema, key: `bench-field-arrays-${seedCount}-${Math.random()}` })
      for (let i = 0; i < seedCount; i++) captured.append('posts', newPost(i))
      return () => h('div')
    },
  })
  const app = createSSRApp(App)
  app.use(createChemicalXForms({ override: true }))
  // renderToString drives setup(); we don't care about the HTML itself.
  void renderToString(app)
  if (captured === undefined) throw new Error('useForm setup did not run')
  return captured
}

describe('field-arrays: append on a 100-item array', () => {
  const form = mountAndCaptureForm(100)
  bench('append(posts, newPost)', () => {
    form.append('posts', newPost(Math.random()))
  })
})

describe('field-arrays: append on a 1000-item array', () => {
  const form = mountAndCaptureForm(1000)
  bench('append(posts, newPost)', () => {
    form.append('posts', newPost(Math.random()))
  })
})

describe('field-arrays: remove+append churn on a 500-item array', () => {
  const form = mountAndCaptureForm(500)
  bench('remove(50) + append(newPost) — sustained rotation', () => {
    form.remove('posts', 50)
    form.append('posts', newPost(Math.random()))
  })
})

describe('field-arrays: swap on a 500-item array', () => {
  const form = mountAndCaptureForm(500)
  bench('swap(posts, 0, 499)', () => {
    form.swap('posts', 0, 499)
  })
})
